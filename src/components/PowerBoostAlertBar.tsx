import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABELS, type ActivePowerBoostAlert, type UserProfile, type UserRole } from '../types';

interface PowerBoostAlertBarProps {
  token: string;
  user: UserProfile;
  refreshSignal: number;
  onOpenChat: (groupId?: number) => void;
  onAcknowledged?: (messageId: number) => void;
  onActiveCountChange?: (count: number) => void;
}

function getSafeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function playPowerBoostChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const notes = [880, 1174.66]; // Crisp A5 -> D6 chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.14 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.26);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 800);
  } catch {
    // Ignore browser autoplay restrictions
  }
}

export function PowerBoostAlertBar({
  token,
  user,
  refreshSignal,
  onOpenChat,
  onAcknowledged,
  onActiveCountChange,
}: PowerBoostAlertBarProps) {
  const [alerts, setAlerts] = useState<ActivePowerBoostAlert[]>([]);
  const [noteByMsg, setNoteByMsg] = useState<Record<number, string>>({});
  const [ackingId, setAckingId] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [pulseMsgId, setPulseMsgId] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    () =>
      typeof window !== 'undefined' && 'Notification' in window
        ? Notification.permission
        : 'unsupported'
  );

  // Track last reminder timestamp per boosted messageId
  const lastNotifiedRef = useRef<Map<number, number>>(new Map());
  const seenIdsRef = useRef<Set<number>>(new Set());

  const loadActiveAlerts = useCallback(async () => {
    try {
      const res = await api.getActivePowerBoostAlerts(token);
      setAlerts(res.alerts);

      const now = Date.now();
      for (const alert of res.alerts) {
        if (!seenIdsRef.current.has(alert.messageId)) {
          seenIdsRef.current.add(alert.messageId);
          lastNotifiedRef.current.set(alert.messageId, now);
          setPulseMsgId(alert.messageId);
        }
      }
    } catch {
      // Ignore transient network errors
    }
  }, [token]);

  useEffect(() => {
    loadActiveAlerts();
  }, [loadActiveAlerts, refreshSignal]);

  useEffect(() => {
    onActiveCountChange?.(alerts.length);
  }, [alerts.length, onActiveCountChange]);

  // Lightweight background WebSocket listener so Power Boost alerts arrive & clear on ANY tab
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
          if (
            (data.type === 'message:created' && data.message?.powerBoostEnabled) ||
            data.type === 'power_boost:stopped' ||
            (data.type === 'power_boost:acknowledged' &&
              data.acknowledgement?.userId === user.id)
          ) {
            loadActiveAlerts();
          }
        } catch {
          // Ignore invalid frames
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
  }, [token, user.id, loadActiveAlerts]);

  // Repeating reminder engine: ticks every second for live countdown & fires reminders per interval
  useEffect(() => {
    if (alerts.length === 0) return;

    const interval = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);

      for (const alert of alerts) {
        const repeatMs = Math.max(1, alert.powerBoostIntervalMinutes) * 60_000;
        const last = lastNotifiedRef.current.get(alert.messageId) ?? current;
        if (current - last >= repeatMs) {
          lastNotifiedRef.current.set(alert.messageId, current);
          setPulseMsgId(alert.messageId);
          if (soundEnabled) {
            playPowerBoostChime();
          }
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            try {
              new Notification(`Reminder · ${alert.senderName} (${alert.groupName})`, {
                body: `${alert.content.slice(0, 140)} — Respond to turn off alerts.`,
                tag: `power-boost-${alert.messageId}`,
              });
            } catch {
              // Ignore notification error
            }
          }
        }
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [alerts, soundEnabled]);

  useEffect(() => {
    if (pulseMsgId === null) return;
    const t = window.setTimeout(() => setPulseMsgId(null), 4000);
    return () => window.clearTimeout(t);
  }, [pulseMsgId]);

  const handleRequestNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
    } catch {
      // Ignore permission errors
    }
  };

  const handleAcknowledge = async (alert: ActivePowerBoostAlert, defaultNote?: string) => {
    setAckingId(alert.messageId);
    try {
      const note = (noteByMsg[alert.messageId] ?? defaultNote ?? '').trim();
      await api.acknowledgePowerBoost(token, alert.messageId, note);
      setAlerts((prev) => prev.filter((a) => a.messageId !== alert.messageId));
      lastNotifiedRef.current.delete(alert.messageId);
      onAcknowledged?.(alert.messageId);
    } catch {
      // Handled gracefully
    } finally {
      setAckingId(null);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-300 px-4 sm:px-8 py-3 space-y-2.5">
      <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
          <Zap className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            Power Boost Action Required ({alerts.length}{' '}
            {alerts.length === 1 ? 'message' : 'messages'}) — Repeating alerts stay ON until you respond
          </span>
        </div>

        <div className="flex items-center gap-2">
          {notifPermission === 'default' && (
            <button
              type="button"
              onClick={handleRequestNotifications}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-md whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5" />
              Enable Device Notifications
            </button>
          )}
          <button
            type="button"
            onClick={() => setSoundEnabled((prev) => !prev)}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded-md whitespace-nowrap"
          >
            {soundEnabled ? (
              <>
                <Volume2 className="w-3.5 h-3.5" />
                Chime On
              </>
            ) : (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                Chime Muted
              </>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto space-y-2">
        {alerts.map((alert) => {
          const safeUrl = getSafeExternalUrl(alert.powerBoostActionUrl);
          const repeatMs = Math.max(1, alert.powerBoostIntervalMinutes) * 60_000;
          const last = lastNotifiedRef.current.get(alert.messageId) ?? nowMs;
          const secsLeft = Math.max(0, Math.ceil((repeatMs - (nowMs - last)) / 1000));
          const minsLeft = Math.floor(secsLeft / 60);
          const remSecs = secsLeft % 60;
          const isPulsing = pulseMsgId === alert.messageId;

          return (
            <div
              key={alert.messageId}
              className={`bg-white border rounded-lg p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                isPulsing ? 'border-amber-500 ring-2 ring-amber-400/50' : 'border-amber-200'
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <BellRing
                    className={`w-3.5 h-3.5 text-amber-600 shrink-0 ${
                      isPulsing ? 'animate-bounce' : ''
                    }`}
                  />
                  <span className="font-semibold text-slate-900">{alert.senderName}</span>
                  <span className="text-slate-500">
                    ({ROLE_LABELS[alert.senderRole as UserRole] ?? alert.senderRole})
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-medium text-indigo-700">{alert.groupName}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-[11px] tabular-nums text-amber-800">
                    Repeats every {alert.powerBoostIntervalMinutes}m · Next ping in{' '}
                    {String(minsLeft).padStart(2, '0')}:{String(remSecs).padStart(2, '0')}
                  </span>
                </div>
                <p className="text-xs text-slate-800 leading-relaxed break-words">
                  {alert.content}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={noteByMsg[alert.messageId] ?? ''}
                  onChange={(e) =>
                    setNoteByMsg((prev) => ({ ...prev, [alert.messageId]: e.target.value }))
                  }
                  placeholder="Optional note (e.g. Form filled)"
                  maxLength={120}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-44 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />

                {safeUrl && (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-md whitespace-nowrap"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Link / Form
                  </a>
                )}

                <button
                  type="button"
                  disabled={ackingId === alert.messageId}
                  onClick={() =>
                    handleAcknowledge(
                      alert,
                      safeUrl ? 'Completed form / link action' : 'Acknowledged'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {ackingId === alert.messageId
                    ? 'Confirming...'
                    : 'Responded — Turn Off Alerts'}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenChat(alert.groupId)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Open Chat
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
