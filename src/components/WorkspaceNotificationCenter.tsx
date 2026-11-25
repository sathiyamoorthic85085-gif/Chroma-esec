import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  MessageSquare,
  ShieldAlert,
  Target,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ROLE_LABELS,
  type ChatMessageItem,
  type FacultyDelayAlertItem,
  type OdLeaveRequestItem,
  type UserProfile,
  type UserRole,
} from '../types';

export type NotificationChannel =
  | 'chat'
  | 'power_boost'
  | 'faculty_delay'
  | 'attendance_alert'
  | 'goal_nudge';

export interface LiveNotificationEntry {
  id: string;
  channel: NotificationChannel;
  title: string;
  subtitle: string;
  body: string;
  createdAt: string;
  read: boolean;
  groupId?: number;
  facultyDelayId?: number;
  isOdLeave?: boolean;
  targetSection?: 'attendance' | 'overview';
}

interface WorkspaceNotificationCenterProps {
  token: string;
  user: UserProfile;
  activeSection: string;
  onOpenChat: (groupId?: number) => void;
  onOpenTimetable: () => void;
  onOpenOdLeave?: () => void;
  onOpenAttendance?: () => void;
  onOpenOverview?: () => void;
  onFacultyDelayCountChange?: (count: number) => void;
  refreshSignal?: number;
}

function playChannelChime(channel: NotificationChannel) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Distinct acoustic profiles per notification channel
    const pattern =
      channel === 'chat'
        ? [{ freq: 659.25, delay: 0, dur: 0.14, gain: 0.08 }] // Soft single E5 ping for regular chat
        : channel === 'power_boost'
        ? [
            { freq: 880, delay: 0, dur: 0.18, gain: 0.14 },
            { freq: 1174.66, delay: 0.15, dur: 0.24, gain: 0.14 },
          ] // Urgent rising A5 -> D6 chime for Power Boost
        : [
            { freq: 740, delay: 0, dur: 0.14, gain: 0.15 },
            { freq: 987.77, delay: 0.14, dur: 0.14, gain: 0.15 },
            { freq: 740, delay: 0.28, dur: 0.2, gain: 0.15 },
          ]; // Triple-pulse F#5 -> B5 -> F#5 alert for Faculty Delay

    pattern.forEach((step) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = channel === 'faculty_delay' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(step.freq, now + step.delay);
      gain.gain.setValueAtTime(0.0001, now + step.delay);
      gain.gain.exponentialRampToValueAtTime(step.gain, now + step.delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + step.delay + step.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + step.delay);
      osc.stop(now + step.delay + step.dur + 0.02);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // Ignore browser autoplay restrictions
  }
}

function sendWebNotification(params: {
  channel: NotificationChannel;
  title: string;
  body: string;
  tag: string;
  onClick?: () => void;
}) {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !== 'granted'
  ) {
    return;
  }
  try {
    const n = new Notification(params.title, {
      body: params.body.slice(0, 160),
      tag: params.tag,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      requireInteraction: params.channel !== 'chat',
    });
    n.onclick = () => {
      window.focus();
      params.onClick?.();
      n.close();
    };
  } catch {
    // Fallback to Service Worker registration notification if direct Notification constructor is blocked
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        reg
          ?.showNotification(params.title, {
            body: params.body.slice(0, 160),
            tag: params.tag,
            icon: '/pwa-192x192.png',
          })
          .catch(() => {});
      });
    }
  }
}

function isTargetedForFacultyDelay(alert: FacultyDelayAlertItem, user: UserProfile): boolean {
  if (user.role === 'hod' || user.role === 'class_advisor') return true;
  if (user.role === 'dept_staff' || user.role === 'other_dept_staff') {
    const normUser = user.fullName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normFaculty = alert.facultyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return Boolean(
      normUser && normFaculty && (normUser.includes(normFaculty) || normFaculty.includes(normUser))
    );
  }
  return false;
}

export function WorkspaceNotificationCenter({
  token,
  user,
  onOpenChat,
  onOpenTimetable,
  onOpenOdLeave,
  onOpenAttendance,
  onOpenOverview,
  onFacultyDelayCountChange,
  refreshSignal = 0,
}: WorkspaceNotificationCenterProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | NotificationChannel>('all');
  const [notifications, setNotifications] = useState<LiveNotificationEntry[]>([]);
  const [toasts, setToasts] = useState<LiveNotificationEntry[]>([]);
  const [facultyDelays, setFacultyDelays] = useState<FacultyDelayAlertItem[]>([]);
  const [updatingDelayId, setUpdatingDelayId] = useState<number | null>(null);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('chromagrade_notif_sound') !== 'off';
    } catch {
      return true;
    }
  });

  const [webPermission, setWebPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );

  const soundRef = useRef(soundEnabled);
  useEffect(() => {
    soundRef.current = soundEnabled;
    try {
      localStorage.setItem('chromagrade_notif_sound', soundEnabled ? 'on' : 'off');
    } catch {
      // Ignore storage errors
    }
  }, [soundEnabled]);

  const seenNotifIds = useRef<Set<string>>(new Set());

  const pushLiveNotification = useCallback(
    (entry: LiveNotificationEntry, triggerBrowser: boolean) => {
      if (seenNotifIds.current.has(entry.id)) return;
      seenNotifIds.current.add(entry.id);

      setNotifications((prev) => [entry, ...prev].slice(0, 40));
      setToasts((prev) => [entry, ...prev].slice(0, 3));

      if (soundRef.current) {
        playChannelChime(entry.channel);
      }

      if (triggerBrowser) {
        sendWebNotification({
          channel: entry.channel,
          title: entry.title,
          body: `${entry.subtitle ? `${entry.subtitle} — ` : ''}${entry.body}`,
          tag: entry.id,
          onClick: () => {
            if (entry.isOdLeave) {
              onOpenOdLeave?.();
            } else if (entry.targetSection === 'attendance') {
              onOpenAttendance?.();
            } else if (entry.targetSection === 'overview' || entry.channel === 'goal_nudge') {
              onOpenOverview?.();
            } else if (entry.channel === 'faculty_delay') {
              onOpenTimetable();
            } else {
              onOpenChat(entry.groupId);
            }
          },
        });
      }

      // Auto-dismiss regular chat/goal toasts after 5.5s; urgent alerts stay 9.5s
      const dismissMs = entry.channel === 'chat' || entry.channel === 'goal_nudge' ? 6500 : 9500;
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== entry.id));
      }, dismissMs);
    },
    [onOpenChat, onOpenTimetable, onOpenOdLeave, onOpenAttendance, onOpenOverview]
  );

  const loadFacultyDelays = useCallback(async () => {
    try {
      const res = await api.getFacultyDelays(token);
      setFacultyDelays(res.alerts);
    } catch {
      // Ignore transient errors
    }
  }, [token]);

  useEffect(() => {
    loadFacultyDelays();
  }, [loadFacultyDelays, refreshSignal]);

  // Daily push notification nudge if a student has not checked in to Academic Goal Tracker today
  useEffect(() => {
    if (user.role !== 'student' && user.role !== 'class_rep') return;
    let cancelled = false;
    api
      .getMyAcademicGoal(token)
      .then((res) => {
        if (cancelled) return;
        if (!res.goal.checkedInToday) {
          pushLiveNotification(
            {
              id: `goal-nudge-${res.goal.todayIsoDate}-${user.id}`,
              channel: 'goal_nudge',
              title: 'Daily Academic Goal Reminder',
              subtitle: `Target: ${res.goal.weeklyAttendanceTarget}% attendance · ${res.goal.weeklyEngagementTarget} engagement`,
              body: 'You have not updated your Academic Goal Tracker activity today. Open Overview to log your daily check-in.',
              createdAt: res.goal.todayIsoDate,
              read: false,
              targetSection: 'overview',
            },
            true
          );
        }
      })
      .catch(() => {
        // Non-blocking
      });
    return () => {
      cancelled = true;
    };
  }, [token, user.id, user.role, pushLiveNotification]);

  const activeFacultyDelays = useMemo(
    () => facultyDelays.filter((a) => a.status === 'active'),
    [facultyDelays]
  );

  useEffect(() => {
    onFacultyDelayCountChange?.(activeFacultyDelays.length);
  }, [activeFacultyDelays.length, onFacultyDelayCountChange]);

  // Persistent WebSocket listener across ALL web app tabs for:
  // 1) All Regular Chat Messages (distinct chat notification)
  // 2) Power Boost Urgent Messages (distinct urgent notification)
  // 3) Faculty Delay Alerts (distinct alert for Respected Hour Faculty, HOD, and Class Advisor)
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;
    let ws: WebSocket | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'auth', token }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'message:created' && data.message) {
            const msg = data.message as ChatMessageItem;
            // Don't notify the sender for their own message
            if (msg.senderUserId === user.id) return;

            const groupLabel = data.groupName
              ? data.communityName
                ? `${data.communityName} / ${data.groupName}`
                : String(data.groupName)
              : 'Department Chat';

            const previewBody =
              msg.content?.trim() ||
              (msg.attachmentType !== 'none'
                ? `Shared a ${msg.attachmentType.replace('_', ' ')}`
                : 'New message');

            if (msg.powerBoostEnabled) {
              // Distinct POWER BOOST Urgent Notification
              pushLiveNotification(
                {
                  id: `pb-msg-${msg.id}`,
                  channel: 'power_boost',
                  title: `Power Boost Alert · ${msg.senderName}`,
                  subtitle: `${groupLabel} · Repeats every ${msg.powerBoostIntervalMinutes}m`,
                  body: previewBody,
                  createdAt: msg.createdAt,
                  read: false,
                  groupId: msg.groupId,
                },
                true
              );
            } else {
              // Distinct REGULAR CHAT Notification
              pushLiveNotification(
                {
                  id: `chat-msg-${msg.id}`,
                  channel: 'chat',
                  title: `New Chat · ${msg.senderName}`,
                  subtitle: groupLabel,
                  body: previewBody,
                  createdAt: msg.createdAt,
                  read: false,
                  groupId: msg.groupId,
                },
                true
              );
            }
          } else if (data.type === 'faculty_delay:created' && data.alert) {
            const alert = data.alert as FacultyDelayAlertItem;
            const isRecipient = isTargetedForFacultyDelay(alert, user);
            const isReporter = alert.reportedByUserId === user.id;

            if (isRecipient || isReporter) {
              setFacultyDelays((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)]);
            }

            if (isRecipient && !isReporter) {
              pushLiveNotification(
                {
                  id: `delay-${alert.id}`,
                  channel: 'faculty_delay',
                  title: `Faculty Delay · P${alert.periodNumber} ${alert.subjectCode}`,
                  subtitle: `Faculty: ${alert.facultyName} · ${alert.yearOfStudy} Sec ${alert.section} (${alert.delayMinutes}+ min)`,
                  body:
                    alert.note ||
                    `Reported by ${alert.reportedByName} (${ROLE_LABELS[alert.reportedByRole as UserRole] ?? alert.reportedByRole}) for Room ${alert.roomNo || 'Classroom'}.`,
                  createdAt: alert.createdAt,
                  read: false,
                  facultyDelayId: alert.id,
                },
                true
              );
            }
          } else if (data.type === 'faculty_delay:updated' && data.alert) {
            const alert = data.alert as FacultyDelayAlertItem;
            setFacultyDelays((prev) =>
              prev.map((item) => (item.id === alert.id ? alert : item))
            );
          } else if (data.type === 'od_leave:created' && data.request) {
            const req = data.request as OdLeaveRequestItem;
            if (req.applicantUserId === user.id) return;
            const shouldNotify =
              (user.role === 'class_advisor' && req.status === 'pending_advisor') ||
              (user.role === 'hod' && req.status === 'pending_hod');
            if (shouldNotify) {
              const typeLabel = req.requestType === 'od' ? 'On-Duty (OD)' : 'Leave';
              pushLiveNotification(
                {
                  id: `od-leave-new-${req.id}`,
                  channel: 'power_boost',
                  title: `New ${typeLabel} Request · ${req.applicantName}`,
                  subtitle: `${req.rollOrEmployeeId} · ${req.fromDate} to ${req.toDate} (${req.totalDays}d)`,
                  body: req.reason,
                  createdAt: req.createdAt,
                  read: false,
                  isOdLeave: true,
                },
                true
              );
            }
          } else if (data.type === 'od_leave:updated' && data.request) {
            const req = data.request as OdLeaveRequestItem;
            const typeLabel = req.requestType === 'od' ? 'On-Duty (OD)' : 'Leave';
            if (req.applicantUserId === user.id) {
              const statusSummary =
                req.status === 'approved'
                  ? `Approved by HOD · Attendance auto-marked as ${req.requestType === 'od' ? 'OD' : 'Absent'} (${req.fromDate} to ${req.toDate})`
                  : req.status === 'pending_hod'
                  ? 'Recommended by Class Advisor · Forwarded to HOD for final approval'
                  : 'Request rejected — tap to review remarks';
              pushLiveNotification(
                {
                  id: `od-leave-upd-${req.id}-${req.status}-${req.updatedAt}`,
                  channel: req.status === 'approved' ? 'power_boost' : 'chat',
                  title: `${typeLabel} Update · ${req.status.replace('_', ' ').toUpperCase()}`,
                  subtitle: `${req.fromDate} to ${req.toDate} (${req.totalDays}d)`,
                  body: statusSummary,
                  createdAt: req.updatedAt,
                  read: false,
                  isOdLeave: true,
                },
                true
              );
            } else if (
              user.role === 'hod' &&
              req.status === 'pending_hod' &&
              req.advisorStatus === 'approved'
            ) {
              pushLiveNotification(
                {
                  id: `od-leave-hod-${req.id}-${req.updatedAt}`,
                  channel: 'power_boost',
                  title: `${typeLabel} Forwarded to HOD · ${req.applicantName}`,
                  subtitle: `Advisor recommended · ${req.fromDate} to ${req.toDate} (${req.totalDays}d)`,
                  body: req.reason,
                  createdAt: req.updatedAt,
                  read: false,
                  isOdLeave: true,
                },
                true
              );
            }
          } else if (data.type === 'attendance:session_alert' && data.alert) {
            const alert = data.alert as {
              subjectCode: string;
              subjectName: string;
              yearOfStudy: string;
              section: string;
              periodNumber: number;
              presentCount: number;
              expectedCount: number;
              ratePct: number;
              createdAt: string;
            };
            const isStudentInSession =
              (user.role === 'student' || user.role === 'class_rep') &&
              (!alert.yearOfStudy || user.yearOfStudy === alert.yearOfStudy) &&
              (!alert.section || user.section === alert.section);
            const isStaffOrAdvisor =
              user.role === 'hod' || user.role === 'class_advisor' || user.role === 'dept_staff';

            if (isStudentInSession || isStaffOrAdvisor) {
              pushLiveNotification(
                {
                  id: `sess-alert-${alert.subjectCode}-p${alert.periodNumber}-${alert.presentCount}`,
                  channel: 'attendance_alert',
                  title: `Attendance Alert (<75%) · ${alert.subjectCode} P${alert.periodNumber}`,
                  subtitle: `${alert.yearOfStudy} Sec ${alert.section} · ${alert.ratePct}% present (${alert.presentCount}/${alert.expectedCount})`,
                  body: `Session attendance for ${alert.subjectName} dropped below 75%. Review dual-camera attendance logs.`,
                  createdAt: alert.createdAt,
                  read: false,
                  targetSection: 'attendance',
                },
                true
              );
            }
          } else if (data.type === 'attendance:low_risk' && data.risk) {
            const risk = data.risk as {
              rollNo: string;
              studentName: string;
              yearOfStudy: string;
              section: string;
              cumulativeRate: number;
              presentCount: number;
              totalSessions: number;
              notifiedAt: string;
            };
            const isTargetStudent =
              (user.role === 'student' || user.role === 'class_rep') &&
              user.staffOrRollId.toUpperCase() === risk.rollNo.toUpperCase();
            const isAdvisorOrHod =
              user.role === 'hod' || user.role === 'class_advisor' || user.role === 'dept_staff';

            if (isTargetStudent || isAdvisorOrHod) {
              pushLiveNotification(
                {
                  id: `low-risk-${risk.rollNo}-${risk.notifiedAt.slice(0, 10)}`,
                  channel: 'attendance_alert',
                  title: isTargetStudent
                    ? `Low Attendance Risk Warning (${risk.cumulativeRate}%)`
                    : `Low Attendance Risk · ${risk.studentName} (${risk.cumulativeRate}%)`,
                  subtitle: `${risk.rollNo} · ${risk.yearOfStudy} Sec ${risk.section} · ${risk.presentCount}/${risk.totalSessions} sessions`,
                  body: isTargetStudent
                    ? 'Your cumulative attendance has fallen below 75%. Please attend upcoming periods to avoid shortage.'
                    : `Class Advisor alert: ${risk.studentName}'s cumulative attendance is below the 75% threshold.`,
                  createdAt: risk.notifiedAt,
                  read: false,
                  targetSection: 'attendance',
                },
                true
              );
            }
          } else if (data.type === 'goal:daily_nudge') {
            pushLiveNotification(
              {
                id: `ws-goal-nudge-${String(data.isoDate ?? '')}`,
                channel: 'goal_nudge',
                title: String(data.title || 'Academic Goal Tracker Check-in'),
                subtitle: 'Weekly Target Progress',
                body: String(
                  data.body ||
                    'Log today’s Academic Goal Tracker activity to keep your semester streak on track.'
                ),
                createdAt: String(data.isoDate ?? ''),
                read: false,
                targetSection: 'overview',
              },
              true
            );
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 4000);
        }
      };
    };

    connect();
    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [token, user, pushLiveNotification]);

  const handleEnableWebNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setWebPermission(perm);
      if (perm === 'granted') {
        sendWebNotification({
          channel: 'chat',
          title: 'ChromaGrade Web Notifications Active',
          body: 'You will now receive distinct alerts for chats, Power Boost messages, and Faculty Delays.',
          tag: 'chromagrade-notif-enabled',
        });
      }
    } catch {
      // Permission prompt blocked
    }
  };

  const handleUpdateDelay = async (id: number, status: 'acknowledged' | 'resolved') => {
    setUpdatingDelayId(id);
    try {
      const res = await api.updateFacultyDelayStatus(token, id, status);
      setFacultyDelays((prev) => prev.map((a) => (a.id === id ? res.alert : a)));
    } catch {
      // Handled gracefully
    } finally {
      setUpdatingDelayId(null);
    }
  };

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length + activeFacultyDelays.length,
    [notifications, activeFacultyDelays.length]
  );

  const visibleNotifications = useMemo(() => {
    if (filterTab === 'all') return notifications;
    return notifications.filter((n) => n.channel === filterTab);
  }, [notifications, filterTab]);

  const canActionDelay =
    user.role === 'hod' ||
    user.role === 'class_advisor' ||
    user.role === 'dept_staff' ||
    user.role === 'other_dept_staff';

  return (
    <>
      {/* Top Bar Notification Bell Trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setDrawerOpen((prev) => !prev)}
          aria-label="Open notifications center"
          className="relative inline-flex items-center justify-center gap-1.5 px-2.5 py-2 min-h-[40px] min-w-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          {webPermission === 'denied' ? (
            <BellOff className="w-4 h-4 text-slate-400" />
          ) : (
            <Bell className="w-4 h-4 text-slate-700" />
          )}
          {unreadCount > 0 && (
            <span className="font-mono text-[11px] font-semibold tabular-nums text-rose-700">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Notification Center Popover */}
        {drawerOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setDrawerOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed sm:absolute right-3 sm:right-0 top-16 sm:top-12 z-50 w-[calc(100vw-24px)] sm:w-96 max-h-[80vh] bg-white border border-slate-200 rounded-xl shadow-xl flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">
                    Web App Notifications
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Separate channels for Chats, Power Boost, and Faculty Delays
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSoundEnabled((prev) => !prev)}
                    aria-label={soundEnabled ? 'Mute notification chimes' : 'Unmute notification chimes'}
                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-md"
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Close notifications"
                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Browser Push Permission Prompt Banner inside Web App */}
              {webPermission !== 'granted' && webPermission !== 'unsupported' && (
                <div className="px-4 py-2.5 bg-indigo-50 border-b border-indigo-100 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-indigo-950">
                    {webPermission === 'denied'
                      ? 'Browser alerts blocked in site settings. In-app alerts remain active.'
                      : 'Enable desktop & mobile web notifications for background alerts.'}
                  </span>
                  {webPermission === 'default' && (
                    <button
                      type="button"
                      onClick={handleEnableWebNotifications}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-md whitespace-nowrap shrink-0"
                    >
                      Enable
                    </button>
                  )}
                </div>
              )}

              {/* Channel Filter Tabs */}
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'attendance_alert', label: 'Attendance' },
                      { id: 'goal_nudge', label: 'Goals' },
                      { id: 'faculty_delay', label: 'Delays' },
                      { id: 'power_boost', label: 'Boost' },
                      { id: 'chat', label: 'Chats' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFilterTab(t.id)}
                      className={`px-2 py-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
                        filterTab === t.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {notifications.some((n) => !n.read) && (
                  <button
                    type="button"
                    onClick={() =>
                      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
                    }
                    className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
                  >
                    Mark read
                  </button>
                )}
              </div>

              <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
                {/* Active Faculty Delay Alerts pinned at top */}
                {(filterTab === 'all' || filterTab === 'faculty_delay') &&
                  facultyDelays.slice(0, 6).map((alert) => (
                    <div
                      key={`delay-row-${alert.id}`}
                      className={`px-4 py-3 space-y-1.5 ${
                        alert.status === 'active' ? 'bg-rose-50/50' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-900">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                          <span>
                            Faculty Delay · P{alert.periodNumber} {alert.subjectCode}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-medium ${
                            alert.status === 'active'
                              ? 'text-rose-700'
                              : alert.status === 'acknowledged'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {alert.status === 'active'
                            ? `${alert.delayMinutes}+ min delay`
                            : alert.status === 'acknowledged'
                            ? `Ack by ${alert.acknowledgedByName}`
                            : 'Resolved'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700">
                        Faculty: <strong>{alert.facultyName}</strong> · {alert.yearOfStudy} Sec{' '}
                        {alert.section} · Room {alert.roomNo || 'TBA'}
                      </div>
                      {alert.note && (
                        <p className="text-[11px] text-slate-600">{alert.note}</p>
                      )}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-[10px] text-slate-500">
                          Reported by {alert.reportedByName}
                        </span>
                        {canActionDelay && alert.status !== 'resolved' && (
                          <div className="flex items-center gap-1.5">
                            {alert.status === 'active' && (
                              <button
                                type="button"
                                disabled={updatingDelayId === alert.id}
                                onClick={() => handleUpdateDelay(alert.id, 'acknowledged')}
                                className="px-2 py-1 text-[11px] font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 rounded"
                              >
                                On My Way
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={updatingDelayId === alert.id}
                              onClick={() => handleUpdateDelay(alert.id, 'resolved')}
                              className="px-2 py-1 text-[11px] font-medium text-emerald-900 bg-emerald-100 hover:bg-emerald-200 rounded"
                            >
                              Resolve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                {/* Live Chat & Power Boost Notifications */}
                {visibleNotifications.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setNotifications((prev) =>
                        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
                      );
                      setDrawerOpen(false);
                      if (item.isOdLeave) {
                        onOpenOdLeave?.();
                      } else if (item.targetSection === 'attendance') {
                        onOpenAttendance?.();
                      } else if (item.targetSection === 'overview' || item.channel === 'goal_nudge') {
                        onOpenOverview?.();
                      } else if (item.channel === 'faculty_delay') {
                        onOpenTimetable();
                      } else {
                        onOpenChat(item.groupId);
                      }
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors space-y-1 ${
                      !item.read
                        ? item.channel === 'power_boost'
                          ? 'bg-amber-50/60'
                          : item.channel === 'faculty_delay' || item.channel === 'attendance_alert'
                          ? 'bg-rose-50/50'
                          : 'bg-indigo-50/40'
                        : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 truncate">
                        {item.channel === 'power_boost' ? (
                          <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        ) : item.channel === 'faculty_delay' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        ) : item.channel === 'attendance_alert' ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                        ) : item.channel === 'goal_nudge' ? (
                          <Target className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        )}
                        <span className="truncate">{item.title}</span>
                      </span>
                      <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                        {item.isOdLeave
                          ? 'OD / Leave'
                          : item.channel === 'attendance_alert'
                          ? 'Attendance Risk'
                          : item.channel === 'goal_nudge'
                          ? 'Goal Tracker'
                          : item.channel === 'power_boost'
                          ? 'Power Boost'
                          : item.channel === 'faculty_delay'
                          ? 'Delay Alert'
                          : 'Chat'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{item.subtitle}</div>
                    <div className="text-xs text-slate-700 line-clamp-2">{item.body}</div>
                  </button>
                ))}

                {visibleNotifications.length === 0 &&
                  (filterTab !== 'all' && filterTab !== 'faculty_delay'
                    ? true
                    : facultyDelays.length === 0) && (
                    <div className="px-4 py-8 text-center text-xs text-slate-500">
                      No notifications in this channel yet. Incoming chats, Power Boost messages, and Faculty Delays appear live here.
                    </div>
                  )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Live Distinct In-App Toast Stack (top-right, non-blocking) */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed top-18 right-3 sm:right-6 z-50 w-[calc(100vw-24px)] sm:w-96 space-y-2 pointer-events-none"
        >
          {toasts.map((toast) => {
            const isBoost = toast.channel === 'power_boost';
            const isDelay =
              toast.channel === 'faculty_delay' || toast.channel === 'attendance_alert';
            return (
              <div
                key={toast.id}
                className={`pointer-events-auto rounded-xl border shadow-lg p-3.5 flex items-start gap-3 transition-all ${
                  isDelay
                    ? 'bg-rose-950 text-white border-rose-700'
                    : isBoost
                    ? 'bg-amber-50 text-amber-950 border-amber-400'
                    : 'bg-white text-slate-900 border-slate-200'
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {toast.channel === 'attendance_alert' ? (
                    <ShieldAlert className="w-4 h-4 text-rose-300" />
                  ) : toast.channel === 'faculty_delay' ? (
                    <AlertTriangle className="w-4 h-4 text-rose-300" />
                  ) : toast.channel === 'goal_nudge' ? (
                    <Target className="w-4 h-4 text-indigo-700" />
                  ) : isBoost ? (
                    <Zap className="w-4 h-4 text-amber-600" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-indigo-700" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                    if (toast.isOdLeave) onOpenOdLeave?.();
                    else if (toast.targetSection === 'attendance') onOpenAttendance?.();
                    else if (toast.targetSection === 'overview' || toast.channel === 'goal_nudge')
                      onOpenOverview?.();
                    else if (toast.channel === 'faculty_delay') onOpenTimetable();
                    else onOpenChat(toast.groupId);
                  }}
                  className="flex-1 min-w-0 text-left space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{toast.title}</span>
                    <span
                      className={`text-[10px] font-medium whitespace-nowrap ${
                        isDelay
                          ? 'text-rose-200'
                          : isBoost
                          ? 'text-amber-800'
                          : 'text-indigo-700'
                      }`}
                    >
                      {toast.isOdLeave
                        ? 'OD / Leave'
                        : toast.channel === 'attendance_alert'
                        ? 'Attendance Alert'
                        : toast.channel === 'goal_nudge'
                        ? 'Goal Tracker'
                        : toast.channel === 'faculty_delay'
                        ? 'Faculty Delay'
                        : isBoost
                        ? 'Power Boost'
                        : 'Chat'}
                    </span>
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      isDelay ? 'text-rose-200' : isBoost ? 'text-amber-800' : 'text-slate-500'
                    }`}
                  >
                    {toast.subtitle}
                  </div>
                  <div
                    className={`text-xs line-clamp-2 ${
                      isDelay ? 'text-white/95' : isBoost ? 'text-amber-950' : 'text-slate-700'
                    }`}
                  >
                    {toast.body}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  aria-label="Dismiss toast"
                  className={`p-1 rounded ${
                    isDelay
                      ? 'text-rose-300 hover:text-white'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Persistent Active Faculty Delay Banner for Targeted Faculty / HOD / Class Advisor */}
      {activeFacultyDelays.length > 0 && canActionDelay && (
        <div className="fixed bottom-16 lg:bottom-4 left-3 sm:left-auto sm:right-6 z-40 max-w-md bg-rose-950 text-white border border-rose-700 rounded-xl shadow-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0" />
              Active Faculty Delay Alert ({activeFacultyDelays.length})
            </span>
          </div>
          {activeFacultyDelays.slice(0, 2).map((alert) => (
            <div
              key={alert.id}
              className="pt-2 border-t border-rose-800/80 space-y-1.5 text-xs"
            >
              <div className="font-medium text-white">
                P{alert.periodNumber} {alert.subjectCode} · {alert.facultyName} ({alert.delayMinutes}+ min delay)
              </div>
              <div className="text-[11px] text-rose-200">
                {alert.yearOfStudy} Sec {alert.section} · Room {alert.roomNo || 'TBA'} · Reported by{' '}
                {alert.reportedByName}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={updatingDelayId === alert.id}
                  onClick={() => handleUpdateDelay(alert.id, 'acknowledged')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold bg-white text-rose-950 hover:bg-rose-50 rounded-md"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Acknowledge / On Way
                </button>
                <button
                  type="button"
                  disabled={updatingDelayId === alert.id}
                  onClick={() => handleUpdateDelay(alert.id, 'resolved')}
                  className="px-2.5 py-1.5 text-[11px] font-medium text-rose-100 border border-rose-600 hover:bg-rose-900 rounded-md"
                >
                  Mark Arrived
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
