import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Contact,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  FolderPlus,
  Image as ImageIcon,
  Link2,
  MapPin,
  Megaphone,
  MessageSquare,
  Mic,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Share2,
  Square,
  Trash2,
  Users,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ROLE_LABELS,
  type CallParticipantInfo,
  type ChatAttachmentPayload,
  type ChatAttachmentType,
  type ChatMessageItem,
  type CommunityCategory,
  type CommunityGroupItem,
  type CommunityItem,
  type DepartmentStaff,
  type DepartmentStudent,
  type OtherDepartmentStaff,
  type PowerBoostAcknowledgementItem,
  type PowerBoostEngagementSummary as PowerBoostEngagementSummaryData,
  type SharedContentPayload,
  type UserProfile,
  type UserRole,
} from '../types';
import { ClassroomMapPicker } from './ClassroomMapPicker';
import { CommunityCallRoom, type CallSignalFrame } from './CommunityCallRoom';
import { PowerBoostEngagementSummary } from './PowerBoostEngagementSummary';
import { RecordProfileModal, type RecordShowcasePerson } from './RecordProfileModal';

interface WhatsAppCommunityViewProps {
  token: string;
  user: UserProfile;
  students?: DepartmentStudent[];
  deptStaff?: DepartmentStaff[];
  otherStaff?: OtherDepartmentStaff[];
  initialGroupId?: number | null;
  initialSubTab?: 'chat' | 'analytics';
  incomingShare?: SharedContentPayload | null;
  onClearIncomingShare?: () => void;
  onPowerBoostChanged?: () => void;
}

interface OnlineUser {
  id: number;
  fullName: string;
  role: string;
  groupId: number | null;
}

const CATEGORY_LABELS: Record<CommunityCategory, string> = {
  department: 'Department Hub',
  academic_class: 'Academic Class',
  faculty_council: 'Faculty Council',
  announcement: 'Official Broadcast',
  general: 'General Group',
};

const POWER_BOOST_ROLES = new Set<UserRole>(['hod', 'class_advisor', 'class_rep']);

function getSafeExternalUrl(raw?: string): string | null {
  if (!raw) return null;
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

function detectSourceApp(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host.includes('instagram.com')) return 'Instagram';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'YouTube';
    if (host.includes('docs.google.com') && url.includes('/forms')) return 'Google Forms';
    if (host.includes('forms.gle')) return 'Google Forms';
    if (host.includes('drive.google.com')) return 'Google Drive';
    if (host.includes('docs.google.com')) return 'Google Docs';
    if (host.includes('meet.google.com')) return 'Google Meet';
    if (host.includes('github.com')) return 'GitHub';
    if (host.includes('linkedin.com')) return 'LinkedIn';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'X / Twitter';
    return host;
  } catch {
    return 'Shared Link';
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(sec?: number): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function AuthenticatedPhoto({
  token,
  fileKey,
  fileName,
  onExpand,
}: {
  token: string;
  fileKey: string;
  fileName: string;
  onExpand: (blobUrl: string, fileName: string, fileKey: string) => void;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    api
      .fetchChatAttachmentBlobUrl(token, fileKey, fileName)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [token, fileKey, fileName]);

  if (failed) {
    return (
      <div className="p-3 rounded-md bg-slate-100 text-xs text-slate-500">
        Unable to preview image ({fileName})
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div className="w-56 h-36 rounded-md bg-slate-100 animate-pulse flex items-center justify-center text-xs text-slate-400">
        Loading photo...
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onExpand(blobUrl, fileName, fileKey)}
      className="block rounded-md overflow-hidden border border-slate-200 hover:opacity-95 transition-opacity text-left"
    >
      <img
        src={blobUrl}
        alt={fileName}
        className="max-h-64 max-w-full object-cover block"
      />
    </button>
  );
}

function AuthenticatedAudio({
  token,
  fileKey,
  fileName,
  durationSec,
}: {
  token: string;
  fileKey: string;
  fileName: string;
  durationSec?: number;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    api
      .fetchChatAttachmentBlobUrl(token, fileKey, fileName)
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobUrl(url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [token, fileKey, fileName]);

  return (
    <div className="p-2.5 rounded-lg bg-slate-100/90 border border-slate-200 space-y-1.5 min-w-[230px]">
      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
          <Mic className="w-3.5 h-3.5 text-emerald-700" />
          Voice Note
        </span>
        {durationSec !== undefined && durationSec > 0 && (
          <span className="font-mono tabular-nums">{formatSeconds(durationSec)}</span>
        )}
      </div>
      {failed ? (
        <div className="text-[11px] text-red-600">Audio unavailable</div>
      ) : blobUrl ? (
        <audio src={blobUrl} controls className="w-full h-8" />
      ) : (
        <div className="text-[11px] text-slate-400">Loading audio...</div>
      )}
    </div>
  );
}

export function WhatsAppCommunityView({
  token,
  user,
  students = [],
  deptStaff = [],
  otherStaff = [],
  initialGroupId = null,
  initialSubTab = 'chat',
  incomingShare = null,
  onClearIncomingShare,
  onPowerBoostChanged,
}: WhatsAppCommunityViewProps) {
  const [communities, setCommunities] = useState<CommunityItem[]>([]);
  const [canCreateCommunity, setCanCreateCommunity] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [communityTab, setCommunityTab] = useState<'chat' | 'analytics'>(initialSubTab);
  const [statsRefreshTick, setStatsRefreshTick] = useState(0);
  const [quickBoostStats, setQuickBoostStats] =
    useState<PowerBoostEngagementSummaryData | null>(null);

  useEffect(() => {
    setCommunityTab(initialSubTab);
  }, [initialSubTab]);

  // Real-time WebSocket presence, typing, & call signaling
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [mySocketId, setMySocketId] = useState<string | null>(null);
  const [activeCalls, setActiveCalls] = useState<Record<string, CallParticipantInfo[]>>({});
  const [activeCallRoom, setActiveCallRoom] = useState<{
    groupId: number;
    groupName: string;
    communityName: string;
    mode: 'audio' | 'video';
  } | null>(null);
  const [callSignalQueue, setCallSignalQueue] = useState<CallSignalFrame[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedGroupIdRef = useRef<number | null>(null);
  selectedGroupIdRef.current = selectedGroupId;

  // Composer state
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessageItem | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessageItem | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{
    type: ChatAttachmentType;
    payload: ChatAttachmentPayload;
  } | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  // Hidden file inputs for Document & Photo
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  // Voice Note recording state
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);
  const voiceSecondsRef = useRef(0);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceCancelledRef = useRef(false);

  // Power Boost composer controls (HOD / Class Advisor / Class Rep)
  const canUsePowerBoost = POWER_BOOST_ROLES.has(user.role);
  const [powerBoostOn, setPowerBoostOn] = useState(false);
  const [powerBoostInterval, setPowerBoostInterval] = useState(5);
  const [powerBoostDurationHours, setPowerBoostDurationHours] = useState(24);
  const [powerBoostActionUrl, setPowerBoostActionUrl] = useState('');

  // Power Boost inline response UI state
  const [ackNotes, setAckNotes] = useState<Record<number, string>>({});
  const [ackingMsgId, setAckingMsgId] = useState<number | null>(null);
  const [expandedAckMsgId, setExpandedAckMsgId] = useState<number | null>(null);

  // Modals: Community/Group CRUD + Contact Picker + Location + Share Link + Forward + Incoming Share + Lightbox
  const [modalMode, setModalMode] = useState<
    null | 'create_comm' | 'edit_comm' | 'create_group' | 'edit_group'
  >(null);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formCategory, setFormCategory] = useState<CommunityCategory>('department');
  const [formFlag, setFormFlag] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);

  // Contact Picker Modal
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactTab, setContactTab] = useState<'directory' | 'custom'>('directory');
  const [contactSearch, setContactSearch] = useState('');
  const [customContact, setCustomContact] = useState({
    name: '',
    role: '',
    department: user.department,
    phone: '',
    email: '',
  });

  // Live Location Modal
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locLat, setLocLat] = useState('');
  const [locLng, setLocLng] = useState('');
  const [locAccuracy, setLocAccuracy] = useState<number | undefined>(undefined);
  const [locLabel, setLocLabel] = useState('');
  const [locIsLive, setLocIsLive] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);

  // Share External Link Modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkCaption, setLinkCaption] = useState('');

  // Forward / Incoming External Share Destination Modal
  const [sharePicker, setSharePicker] = useState<{
    mode: 'incoming_external' | 'forward_message';
    title: string;
    url: string;
    caption: string;
    attachmentType?: ChatAttachmentType;
    attachment?: ChatAttachmentPayload | null;
  } | null>(null);
  const [shareTargetGroupId, setShareTargetGroupId] = useState<number | null>(null);
  const [sharePowerBoost, setSharePowerBoost] = useState(false);
  const [sharePowerInterval, setSharePowerInterval] = useState(5);
  const [shareSending, setShareSending] = useState(false);

  // Photo Lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    blobUrl: string;
    fileName: string;
    fileKey: string;
  } | null>(null);

  // Read-only Sender Profile & Wake-Up Page-Call Modal
  const [profileModalTarget, setProfileModalTarget] = useState<RecordShowcasePerson | null>(null);

  const openSenderProfile = useCallback(
    (msg: ChatMessageItem) => {
      const normalizedName = msg.senderName.trim().toLowerCase();
      const matchedStudent = students.find(
        (s) =>
          (msg.senderStaffOrRollId &&
            s.rollNo.toLowerCase() === msg.senderStaffOrRollId.toLowerCase()) ||
          s.fullName.toLowerCase() === normalizedName
      );
      const matchedDeptStaff = deptStaff.find(
        (f) =>
          (msg.senderStaffOrRollId &&
            f.employeeId.toLowerCase() === msg.senderStaffOrRollId.toLowerCase()) ||
          f.fullName.toLowerCase() === normalizedName
      );
      const matchedOtherStaff = otherStaff.find(
        (f) =>
          (msg.senderStaffOrRollId &&
            f.employeeId.toLowerCase() === msg.senderStaffOrRollId.toLowerCase()) ||
          f.fullName.toLowerCase() === normalizedName
      );

      setProfileModalTarget({
        userId: msg.senderUserId ?? null,
        fullName: msg.senderName,
        roleLabel: ROLE_LABELS[msg.senderRole as UserRole] ?? msg.senderRole,
        roleKey: msg.senderRole,
        identifier:
          msg.senderStaffOrRollId ||
          matchedStudent?.rollNo ||
          matchedDeptStaff?.employeeId ||
          matchedOtherStaff?.employeeId ||
          '',
        email:
          msg.senderEmail ||
          matchedStudent?.email ||
          matchedDeptStaff?.email ||
          matchedOtherStaff?.email ||
          '',
        phone:
          msg.senderPhone ||
          matchedStudent?.phone ||
          matchedDeptStaff?.phone ||
          matchedOtherStaff?.phone ||
          '',
        department:
          msg.senderDepartment ||
          matchedStudent?.department ||
          matchedDeptStaff?.department ||
          matchedOtherStaff?.homeDepartment ||
          user.department,
        yearSectionOrSpec:
          msg.senderYearSection ||
          (matchedStudent
            ? `${matchedStudent.yearOfStudy} · Sec ${matchedStudent.section}`
            : matchedDeptStaff?.specialization || matchedOtherStaff?.handlingSubject || ''),
        designationOrSubLabel:
          matchedDeptStaff?.designation || matchedOtherStaff?.designation || undefined,
        photoData:
          msg.senderPhotoData ||
          matchedStudent?.photoData ||
          matchedDeptStaff?.photoData ||
          matchedOtherStaff?.photoData ||
          '',
        faceRegisteredLocked: Boolean(
          matchedStudent?.faceRegisteredLocked ||
            matchedDeptStaff?.faceRegisteredLocked ||
            matchedOtherStaff?.faceRegisteredLocked
        ),
      });
    },
    [students, deptStaff, otherStaff, user.department]
  );

  const canPostInGroup = useCallback(
    (comm: CommunityItem | undefined, grp: CommunityGroupItem | undefined) => {
      if (!comm || !grp) return false;
      if (!grp.onlyAdminsCanPost) return true;
      return comm.canManage || user.role === 'class_advisor';
    },
    [user.role]
  );

  const pickPreferredGroup = useCallback(
    (comm: CommunityItem | undefined): CommunityGroupItem | undefined => {
      if (!comm || comm.groups.length === 0) return undefined;
      return comm.groups.find((g) => canPostInGroup(comm, g)) ?? comm.groups[0];
    },
    [canPostInGroup]
  );

  const loadCommunities = useCallback(async () => {
    try {
      const res = await api.getCommunities(token);
      setCommunities(res.communities);
      setCanCreateCommunity(res.canCreateCommunity);
      const allGroups = res.communities.flatMap((c) => c.groups);
      const defaultComm = res.communities[0];
      const preferredGroup = pickPreferredGroup(defaultComm);

      setSelectedCommunityId((prevComm) => {
        if (prevComm && res.communities.some((c) => c.id === prevComm)) return prevComm;
        return defaultComm?.id ?? null;
      });
      setSelectedGroupId((prevGroup) => {
        if (prevGroup && allGroups.some((g) => g.id === prevGroup)) return prevGroup;
        return preferredGroup?.id ?? null;
      });
      setShareTargetGroupId((prev) => {
        if (prev && allGroups.some((g) => g.id === prev)) return prev;
        return preferredGroup?.id ?? null;
      });
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load communities.');
    } finally {
      setLoading(false);
    }
  }, [token, pickPreferredGroup]);

  const loadMessages = useCallback(
    async (groupId: number) => {
      try {
        const res = await api.getGroupMessages(token, groupId);
        setMessages(res.messages);
        setErrorMsg(null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load messages.');
      }
    },
    [token]
  );

  useEffect(() => {
    loadCommunities();
    api
      .getActiveCalls(token)
      .then((r) => setActiveCalls(r.activeCalls))
      .catch(() => {});
  }, [loadCommunities, token]);

  useEffect(() => {
    api
      .getPowerBoostStats(token)
      .then((data) => setQuickBoostStats(data))
      .catch(() => {});
  }, [token, statsRefreshTick]);

  // Jump to specific group when requested (e.g. from PowerBoostAlertBar "Open Chat")
  useEffect(() => {
    if (!initialGroupId || communities.length === 0) return;
    for (const c of communities) {
      const grp = c.groups.find((g) => g.id === initialGroupId);
      if (grp) {
        setSelectedCommunityId(c.id);
        setSelectedGroupId(grp.id);
        setCommunityTab('chat');
        break;
      }
    }
  }, [initialGroupId, communities]);

  // Open WhatsApp-style destination picker when external site shares to PWA
  useEffect(() => {
    if (!incomingShare) return;
    setCommunityTab('chat');
    setSharePicker({
      mode: 'incoming_external',
      title: incomingShare.title || (incomingShare.url ? detectSourceApp(incomingShare.url) : 'Shared Content'),
      url: incomingShare.url || '',
      caption: incomingShare.text || '',
    });
    setSharePowerBoost(false);
  }, [incomingShare]);

  useEffect(() => {
    if (selectedGroupId) {
      loadMessages(selectedGroupId);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'join:group', groupId: selectedGroupId }));
      }
    } else {
      setMessages([]);
    }
  }, [selectedGroupId, loadMessages]);

  // Real-time WebSocket connection for messaging, Power Boost sync, & WebRTC call signaling
  useEffect(() => {
    let closedByUser = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/chat`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth',
            token,
            groupId: selectedGroupIdRef.current ?? undefined,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'auth:ok') {
            if (typeof data.socketId === 'string') setMySocketId(data.socketId);
            if (data.activeCalls && typeof data.activeCalls === 'object') {
              setActiveCalls(data.activeCalls);
            }
          } else if (data.type === 'message:created' && data.message) {
            const incoming = data.message as ChatMessageItem;
            setMessages((prev) => {
              if (incoming.groupId !== selectedGroupIdRef.current) return prev;
              if (prev.some((m) => m.id === incoming.id)) return prev;
              return [...prev, incoming];
            });
            loadCommunities();
            if (incoming.powerBoostEnabled) {
              setStatsRefreshTick((t) => t + 1);
              onPowerBoostChanged?.();
            }
          } else if (data.type === 'message:updated' && data.message) {
            const updated = data.message as ChatMessageItem;
            setMessages((prev) =>
              prev.map((m) => (m.id === updated.id ? updated : m))
            );
          } else if (data.type === 'message:deleted') {
            setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
            setStatsRefreshTick((t) => t + 1);
          } else if (
            data.type === 'power_boost:acknowledged' &&
            data.acknowledgement
          ) {
            const ack = data.acknowledgement as PowerBoostAcknowledgementItem;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== data.messageId) return m;
                const filtered = m.acknowledgements.filter((a) => a.userId !== ack.userId);
                return {
                  ...m,
                  acknowledgements: [...filtered, ack],
                  acknowledgedByMe: m.acknowledgedByMe || ack.userId === user.id,
                };
              })
            );
            setStatsRefreshTick((t) => t + 1);
            if (ack.userId === user.id) {
              onPowerBoostChanged?.();
            }
          } else if (data.type === 'power_boost:stopped') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === data.messageId ? { ...m, powerBoostEnabled: false } : m
              )
            );
            setStatsRefreshTick((t) => t + 1);
            onPowerBoostChanged?.();
          } else if (data.type === 'community:changed') {
            loadCommunities();
          } else if (data.type === 'presence:update' && Array.isArray(data.onlineUsers)) {
            setOnlineUsers(data.onlineUsers);
          } else if (
            data.type === 'typing' &&
            data.groupId === selectedGroupIdRef.current &&
            data.userId !== user.id
          ) {
            setTypingUser(String(data.userName || 'Someone'));
            if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = window.setTimeout(() => setTypingUser(null), 2500);
          } else if (data.type === 'call:room_update' && typeof data.groupId === 'number') {
            setActiveCalls((prev) => ({
              ...prev,
              [String(data.groupId)]: Array.isArray(data.participants)
                ? data.participants
                : [],
            }));
          } else if (
            data.type === 'call:joined' ||
            data.type === 'call:offer' ||
            data.type === 'call:answer' ||
            data.type === 'call:ice' ||
            data.type === 'call:peer_left'
          ) {
            setCallSignalQueue((prev) => [...prev, data as CallSignalFrame]);
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!closedByUser) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();
    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [token, user.id, loadCommunities, onPowerBoostChanged]);

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const activeCommunity = useMemo(
    () => communities.find((c) => c.id === selectedCommunityId) ?? null,
    [communities, selectedCommunityId]
  );

  const activeGroup: CommunityGroupItem | null = useMemo(() => {
    for (const c of communities) {
      const found = c.groups.find((g) => g.id === selectedGroupId);
      if (found) return found;
    }
    return null;
  }, [communities, selectedGroupId]);

  const canPostInActiveGroup = useMemo(() => {
    if (!activeGroup || !activeCommunity) return false;
    if (!activeGroup.onlyAdminsCanPost) return true;
    return activeCommunity.canManage || user.role === 'class_advisor';
  }, [activeGroup, activeCommunity, user.role]);

  const filteredCommunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return communities;
    return communities
      .map((c) => ({
        ...c,
        groups: c.groups.filter(
          (g) =>
            g.name.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            g.description.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.name.toLowerCase().includes(q) || c.groups.length > 0);
  }, [communities, searchQuery]);

  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.isPinned),
    [messages]
  );

  const directoryContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const list: {
      key: string;
      name: string;
      role: string;
      department: string;
      id: string;
      email: string;
      phone: string;
    }[] = [
      ...students.map((s) => ({
        key: `st-${s.id}`,
        name: s.fullName,
        role: s.isClassRep ? `Class Rep (${s.yearOfStudy} ${s.section})` : `Student (${s.yearOfStudy} ${s.section})`,
        department: s.department,
        id: s.rollNo,
        email: s.email,
        phone: s.phone,
      })),
      ...deptStaff.map((f) => ({
        key: `ds-${f.id}`,
        name: f.fullName,
        role: f.isClassAdvisor ? `Class Advisor · ${f.designation}` : f.designation,
        department: f.department,
        id: f.employeeId,
        email: f.email,
        phone: f.phone,
      })),
      ...otherStaff.map((o) => ({
        key: `os-${o.id}`,
        name: o.fullName,
        role: `${o.designation} (${o.handlingSubject})`,
        department: o.homeDepartment,
        id: o.employeeId,
        email: o.email,
        phone: o.phone,
      })),
    ];
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.department.toLowerCase().includes(q) ||
          c.role.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [students, deptStaff, otherStaff, contactSearch]);

  // Community / Group Modal Handlers
  const openCreateCommunity = () => {
    setFormName('');
    setFormDesc('');
    setFormCategory('department');
    setFormFlag(false);
    setModalMode('create_comm');
  };

  const openEditCommunity = (comm: CommunityItem) => {
    setSelectedCommunityId(comm.id);
    setFormName(comm.name);
    setFormDesc(comm.description);
    setFormCategory(comm.category);
    setFormFlag(comm.announcementOnly);
    setModalMode('edit_comm');
  };

  const openCreateGroup = (comm: CommunityItem) => {
    setSelectedCommunityId(comm.id);
    setFormName('');
    setFormDesc('');
    setFormFlag(false);
    setModalMode('create_group');
  };

  const openEditGroup = (group: CommunityGroupItem) => {
    setFormName(group.name);
    setFormDesc(group.description);
    setFormFlag(group.onlyAdminsCanPost);
    setModalMode('edit_group');
  };

  const handleModalSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setModalSaving(true);
    setErrorMsg(null);
    try {
      if (modalMode === 'create_comm') {
        const res = await api.createCommunity(token, {
          name: formName,
          description: formDesc,
          category: formCategory,
          announcementOnly: formFlag,
        });
        await loadCommunities();
        setSelectedCommunityId(res.community.id);
        setSelectedGroupId(res.community.groups[0]?.id ?? null);
      } else if (modalMode === 'edit_comm' && activeCommunity) {
        await api.updateCommunity(token, activeCommunity.id, {
          name: formName,
          description: formDesc,
          category: formCategory,
          announcementOnly: formFlag,
        });
        await loadCommunities();
      } else if (modalMode === 'create_group' && activeCommunity) {
        await api.createCommunityGroup(token, activeCommunity.id, {
          name: formName,
          description: formDesc,
          groupType: formFlag ? 'announcements' : 'group',
          onlyAdminsCanPost: formFlag,
        });
        await loadCommunities();
      } else if (modalMode === 'edit_group' && activeGroup) {
        await api.updateCommunityGroup(token, activeGroup.id, {
          name: formName,
          description: formDesc,
          onlyAdminsCanPost: formFlag,
        });
        await loadCommunities();
      }
      setModalMode(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save community changes.');
    } finally {
      setModalSaving(false);
    }
  };

  const handleDeleteCommunity = async () => {
    if (!activeCommunity) return;
    setModalSaving(true);
    try {
      await api.deleteCommunity(token, activeCommunity.id);
      setModalMode(null);
      setSelectedCommunityId(null);
      setSelectedGroupId(null);
      await loadCommunities();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete community.');
    } finally {
      setModalSaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!activeGroup) return;
    setModalSaving(true);
    try {
      await api.deleteCommunityGroup(token, activeGroup.id);
      setModalMode(null);
      setSelectedGroupId(null);
      await loadCommunities();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete group.');
    } finally {
      setModalSaving(false);
    }
  };

  // Document & Photo File Upload
  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeGroup) return;
    setAttachMenuOpen(false);
    setUploadingFile(true);
    setErrorMsg(null);
    try {
      const uploaded = await api.uploadChatAttachment(token, activeGroup.id, file);
      setPendingAttachment({
        type: uploaded.attachmentType,
        payload: uploaded.attachment,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to upload file.');
    } finally {
      setUploadingFile(false);
    }
  };

  // Voice Note Recording (Real MediaRecorder)
  const startVoiceRecording = async () => {
    if (!activeGroup || recordingVoice) return;
    setErrorMsg(null);
    setAttachMenuOpen(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorMsg('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      voiceChunksRef.current = [];
      voiceCancelledRef.current = false;
      voiceSecondsRef.current = 0;
      setVoiceSeconds(0);

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        if (voiceTimerRef.current) {
          window.clearInterval(voiceTimerRef.current);
          voiceTimerRef.current = null;
        }
        setRecordingVoice(false);

        if (voiceCancelledRef.current || voiceChunksRef.current.length === 0) {
          return;
        }
        const finalType = recorder.mimeType || 'audio/webm';
        const ext = finalType.includes('mp4')
          ? 'm4a'
          : finalType.includes('ogg')
          ? 'ogg'
          : 'webm';
        const blob = new Blob(voiceChunksRef.current, { type: finalType });
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: finalType,
        });
        const duration = Math.max(1, voiceSecondsRef.current);

        setUploadingFile(true);
        try {
          const uploaded = await api.uploadChatAttachment(token, activeGroup.id, file);
          setPendingAttachment({
            type: 'voice',
            payload: { ...uploaded.attachment, durationSec: duration },
          });
        } catch (err) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to upload voice note.');
        } finally {
          setUploadingFile(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingVoice(true);
      voiceTimerRef.current = window.setInterval(() => {
        voiceSecondsRef.current += 1;
        setVoiceSeconds(voiceSecondsRef.current);
      }, 1000);
    } catch {
      setErrorMsg('Microphone permission denied. Allow microphone access to record voice notes.');
    }
  };

  const stopVoiceRecording = (cancel: boolean) => {
    voiceCancelledRef.current = cancel;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
      voiceStreamRef.current = null;
      if (voiceTimerRef.current) {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
      }
      setRecordingVoice(false);
    }
  };

  // Live Location Picker
  const openLocationModal = () => {
    setAttachMenuOpen(false);
    setLocationModalOpen(true);
    setLocError(null);
    setLocLabel('');
    setLocIsLive(true);

    if (navigator.geolocation) {
      setLocLoading(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocLat(pos.coords.latitude.toFixed(6));
          setLocLng(pos.coords.longitude.toFixed(6));
          setLocAccuracy(Math.round(pos.coords.accuracy));
          setLocLoading(false);
        },
        (err) => {
          setLocLoading(false);
          setLocError(
            err.message ||
              'Could not auto-detect GPS location. You may enter coordinates manually below.'
          );
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocError('Browser geolocation unavailable. Enter latitude and longitude manually.');
    }
  };

  const handleAttachLocation = (e: FormEvent) => {
    e.preventDefault();
    const lat = Number(locLat);
    const lng = Number(locLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocError('Enter valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    setPendingAttachment({
      type: 'location',
      payload: {
        latitude: lat,
        longitude: lng,
        accuracyMeters: locAccuracy,
        locationLabel: locLabel.trim() || 'Campus Live Location',
        isLiveLocation: locIsLive,
      },
    });
    setLocationModalOpen(false);
  };

  // Contact Share
  const handleSelectDirectoryContact = (c: {
    name: string;
    role: string;
    department: string;
    id: string;
    email: string;
    phone: string;
  }) => {
    setPendingAttachment({
      type: 'contact',
      payload: {
        contactName: c.name,
        contactRole: c.role,
        contactDepartment: c.department,
        contactId: c.id,
        contactEmail: c.email,
        contactPhone: c.phone,
      },
    });
    setContactModalOpen(false);
  };

  const handleCustomContactSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!customContact.name.trim()) return;
    setPendingAttachment({
      type: 'contact',
      payload: {
        contactName: customContact.name.trim(),
        contactRole: customContact.role.trim() || 'Contact',
        contactDepartment: customContact.department.trim(),
        contactPhone: customContact.phone.trim(),
        contactEmail: customContact.email.trim(),
      },
    });
    setContactModalOpen(false);
    setCustomContact({ name: '', role: '', department: user.department, phone: '', email: '' });
  };

  // Share External Link (Instagram Reel, YouTube, Google Form, Website)
  const handleAttachLink = (e: FormEvent) => {
    e.preventDefault();
    const safeUrl = getSafeExternalUrl(linkUrl);
    if (!safeUrl) {
      setErrorMsg('Enter a valid http:// or https:// link URL.');
      return;
    }
    setPendingAttachment({
      type: 'shared_link',
      payload: {
        url: safeUrl,
        title: linkTitle.trim() || detectSourceApp(safeUrl),
        sourceApp: detectSourceApp(safeUrl),
      },
    });
    if (linkCaption.trim() && !draft.trim()) {
      setDraft(linkCaption.trim());
    }
    setLinkModalOpen(false);
    setLinkUrl('');
    setLinkTitle('');
    setLinkCaption('');
  };

  // Start Audio or Group Video Call (Google Meet Style)
  const handleStartCall = async (mode: 'audio' | 'video') => {
    if (!activeGroup || !activeCommunity) return;
    setErrorMsg(null);
    if (canPostInActiveGroup) {
      try {
        const res = await api.sendGroupMessage(token, activeGroup.id, {
          content:
            mode === 'video'
              ? `${user.fullName} started a Group Video Meet in ${activeGroup.name}`
              : `${user.fullName} started a Group Voice Call in ${activeGroup.name}`,
          attachmentType: 'call_invite',
          attachment: {
            callMode: mode,
            callRoomId: `group-${activeGroup.id}`,
          },
        });
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
        );
      } catch {
        // Still allow joining the live room
      }
    }
    setActiveCallRoom({
      groupId: activeGroup.id,
      groupName: activeGroup.name,
      communityName: activeCommunity.name,
      mode,
    });
  };

  const handleJoinCall = (mode: 'audio' | 'video') => {
    if (!activeGroup || !activeCommunity) return;
    setActiveCallRoom({
      groupId: activeGroup.id,
      groupName: activeGroup.name,
      communityName: activeCommunity.name,
      mode,
    });
  };

  // Send Message (Text, Attachment, Power Boost)
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeGroup) return;
    const trimmed = draft.trim();
    if (!trimmed && !pendingAttachment) return;

    setSending(true);
    setErrorMsg(null);
    try {
      if (editingMsg) {
        const res = await api.updateChatMessage(token, editingMsg.id, { content: trimmed });
        setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
        setEditingMsg(null);
      } else {
        const res = await api.sendGroupMessage(token, activeGroup.id, {
          content: trimmed,
          replyToId: replyTarget?.id ?? null,
          attachmentType: pendingAttachment?.type ?? 'none',
          attachment: pendingAttachment?.payload ?? null,
          powerBoostEnabled: canUsePowerBoost && powerBoostOn,
          powerBoostIntervalMinutes: powerBoostInterval,
          powerBoostDurationHours: powerBoostDurationHours,
          powerBoostActionUrl: powerBoostActionUrl.trim(),
        });
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
        );
        // If replying to a Power Boost message, mark it acknowledged locally as well
        if (replyTarget?.powerBoostEnabled) {
          onPowerBoostChanged?.();
          loadMessages(activeGroup.id);
        }
        setReplyTarget(null);
        setPendingAttachment(null);
        if (powerBoostOn) {
          setPowerBoostOn(false);
          setPowerBoostActionUrl('');
          onPowerBoostChanged?.();
        }
      }
      setDraft('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  // Send Incoming External Share or Forwarded Message to Selected Group
  const handleShareToSelectedGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!sharePicker || !shareTargetGroupId) return;
    setShareSending(true);
    setErrorMsg(null);
    try {
      const safeUrl = getSafeExternalUrl(sharePicker.url);
      let attachmentType: ChatAttachmentType = sharePicker.attachmentType ?? 'none';
      let attachment: ChatAttachmentPayload | null = sharePicker.attachment ?? null;

      if (sharePicker.mode === 'incoming_external' && safeUrl) {
        attachmentType = 'shared_link';
        attachment = {
          url: safeUrl,
          title: sharePicker.title.trim() || detectSourceApp(safeUrl),
          sourceApp: detectSourceApp(safeUrl),
        };
      }

      const contentText =
        sharePicker.caption.trim() ||
        (safeUrl ? `Shared from ${detectSourceApp(safeUrl)}: ${sharePicker.title || safeUrl}` : sharePicker.title);

      await api.sendGroupMessage(token, shareTargetGroupId, {
        content: contentText,
        attachmentType,
        attachment,
        powerBoostEnabled: canUsePowerBoost && sharePowerBoost,
        powerBoostIntervalMinutes: sharePowerInterval,
        powerBoostDurationHours: 24,
        powerBoostActionUrl: safeUrl ?? '',
      });

      // Switch to target group so user immediately sees the shared post
      for (const c of communities) {
        if (c.groups.some((g) => g.id === shareTargetGroupId)) {
          setSelectedCommunityId(c.id);
          setSelectedGroupId(shareTargetGroupId);
          break;
        }
      }
      await loadMessages(shareTargetGroupId);
      setSharePicker(null);
      onClearIncomingShare?.();
      if (sharePowerBoost) onPowerBoostChanged?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to share into selected chat.');
    } finally {
      setShareSending(false);
    }
  };

  const handleAcknowledgePowerBoost = async (msg: ChatMessageItem, fallbackNote?: string) => {
    setAckingMsgId(msg.id);
    try {
      const note = (ackNotes[msg.id] ?? fallbackNote ?? '').trim();
      const res = await api.acknowledgePowerBoost(token, msg.id, note);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msg.id) return m;
          const filtered = m.acknowledgements.filter((a) => a.userId !== user.id);
          return {
            ...m,
            acknowledgements: [...filtered, res.acknowledgement],
            acknowledgedByMe: true,
          };
        })
      );
      onPowerBoostChanged?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not record response.');
    } finally {
      setAckingMsgId(null);
    }
  };

  const handleStopPowerBoost = async (msgId: number) => {
    try {
      await api.stopPowerBoost(token, msgId);
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, powerBoostEnabled: false } : m))
      );
      onPowerBoostChanged?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not stop Power Boost.');
    }
  };

  const handleTogglePin = async (msg: ChatMessageItem) => {
    try {
      const res = await api.updateChatMessage(token, msg.id, { isPinned: !msg.isPinned });
      setMessages((prev) => prev.map((m) => (m.id === res.message.id ? res.message : m)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to pin message.');
    }
  };

  const handleDeleteMessage = async (msgId: number) => {
    try {
      await api.deleteChatMessage(token, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      onPowerBoostChanged?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to delete message.');
    }
  };

  const openForwardModal = (msg: ChatMessageItem) => {
    setSharePicker({
      mode: 'forward_message',
      title: msg.attachment?.title || `Forwarded from ${msg.senderName}`,
      url: msg.attachment?.url || msg.powerBoostActionUrl || '',
      caption: msg.content,
      attachmentType: msg.attachmentType,
      attachment: msg.attachment,
    });
    setSharePowerBoost(false);
  };

  const notifyTyping = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN && activeGroup) {
      wsRef.current.send(JSON.stringify({ type: 'typing', groupId: activeGroup.id }));
    }
  };

  const consumeSignals = useCallback((count: number) => {
    setCallSignalQueue((prev) => prev.slice(count));
  }, []);

  const activeGroupCallParticipants = activeGroup
    ? activeCalls[String(activeGroup.id)] ?? []
    : [];

  const handleJumpToGroupFromSummary = useCallback(
    (groupId: number) => {
      for (const c of communities) {
        if (c.groups.some((g) => g.id === groupId)) {
          setSelectedCommunityId(c.id);
          setSelectedGroupId(groupId);
          break;
        }
      }
      setCommunityTab('chat');
    },
    [communities]
  );

  return (
    <div className="space-y-4">
      {/* Community Workspace Mode Switcher & Live Power Boost Engagement Strip */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setCommunityTab('chat')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              communityTab === 'chat'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Community Chat
          </button>
          <button
            type="button"
            onClick={() => setCommunityTab('analytics')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              communityTab === 'analytics'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Power Boost Engagement
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
            <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            Power Boost Summary:
          </span>
          {quickBoostStats && quickBoostStats.totalBoostedMessages > 0 ? (
            <>
              <span className="font-mono tabular-nums">
                <strong className="text-slate-900">{quickBoostStats.activeBoostedMessages}</strong>{' '}
                active
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="font-mono tabular-nums">
                <strong className="text-emerald-700">
                  {quickBoostStats.totalStudentAcknowledgements}
                </strong>{' '}
                student acks
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="font-mono tabular-nums">
                <strong className="text-indigo-700">
                  {quickBoostStats.formStudentCompletions}
                </strong>{' '}
                forms filled
              </span>
              <span className="text-slate-300" aria-hidden="true">
                ·
              </span>
              <span className="font-mono tabular-nums">
                <strong className="text-slate-900">
                  {quickBoostStats.averageStudentCompletionRate}%
                </strong>{' '}
                avg student rate
              </span>
            </>
          ) : (
            <span className="text-slate-500">No Power Boost campaigns sent yet</span>
          )}
        </div>
      </div>

      {communityTab === 'analytics' ? (
        <PowerBoostEngagementSummary
          token={token}
          activeGroupId={activeGroup?.id ?? null}
          activeGroupName={activeGroup?.name}
          refreshTrigger={statsRefreshTick}
          onJumpToGroup={handleJumpToGroupFromSummary}
          onSummaryLoaded={setQuickBoostStats}
        />
      ) : (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[700px]">
      {/* Hidden File Inputs for Document & Photo Upload */}
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
        onChange={handleFileChosen}
        className="hidden"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChosen}
        className="hidden"
      />

      {/* Left Rail: Communities & Groups */}
      <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col bg-slate-50/40">
        <div className="p-4 border-b border-slate-200 bg-white space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Communities & Chats</h2>
              <p className="text-xs text-slate-500 tabular-nums">
                {communities.length} communit{communities.length === 1 ? 'y' : 'ies'} ·{' '}
                {onlineUsers.length} online
              </p>
            </div>
            {canCreateCommunity && (
              <button
                type="button"
                onClick={openCreateCommunity}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Community
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search communities or groups..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-200 max-h-[340px] lg:max-h-none">
          {loading && (
            <div className="p-6 text-xs text-slate-500 text-center">Loading communities...</div>
          )}

          {!loading && filteredCommunities.length === 0 && (
            <div className="p-6 text-xs text-slate-500 text-center space-y-2">
              <p>No communities match your search.</p>
            </div>
          )}

          {filteredCommunities.map((comm) => (
            <div key={comm.id} className="bg-white">
              <div className="px-4 py-3 flex items-start justify-between gap-2 bg-slate-50/90 border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCommunityId(comm.id);
                    const targetGrp = pickPreferredGroup(comm);
                    if (targetGrp) setSelectedGroupId(targetGrp.id);
                  }}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {comm.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {CATEGORY_LABELS[comm.category]} · {comm.groups.length} group
                    {comm.groups.length === 1 ? '' : 's'}
                  </div>
                </button>

                {comm.canManage && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      title="Add group to community"
                      onClick={() => openCreateGroup(comm)}
                      className="p-1.5 text-slate-500 hover:text-emerald-700 rounded hover:bg-slate-200/60"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Edit community settings"
                      onClick={() => openEditCommunity(comm)}
                      className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-200/60"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="divide-y divide-slate-100">
                {comm.groups.map((grp) => {
                  const isActive = grp.id === selectedGroupId;
                  const liveCount = activeCalls[String(grp.id)]?.length ?? 0;
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      onClick={() => {
                        setSelectedCommunityId(comm.id);
                        setSelectedGroupId(grp.id);
                        setEditingMsg(null);
                        setReplyTarget(null);
                        setPendingAttachment(null);
                      }}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 ${
                        isActive ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          grp.groupType === 'announcements'
                            ? 'bg-emerald-700 text-white'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {grp.groupType === 'announcements' ? (
                          <Megaphone className="w-4 h-4" />
                        ) : (
                          <MessageSquare className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {grp.name}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-slate-400 shrink-0">
                            {liveCount > 0 ? (
                              <span className="text-emerald-700 font-semibold">
                                LIVE ({liveCount})
                              </span>
                            ) : grp.lastMessageAt ? (
                              grp.lastMessageAt.slice(11, 16)
                            ) : (
                              ''
                            )}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">
                          {grp.lastMessagePreview || grp.description || 'No messages yet'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Right Pane: Real-Time Rich Chat Thread */}
      <section className="lg:col-span-8 flex flex-col bg-slate-50/50">
        {activeGroup && activeCommunity ? (
          <>
            {/* Active Group Top Bar with Voice Call & Group Video Meet Triggers */}
            <header className="px-4 sm:px-5 py-3.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 truncate">
                    {activeGroup.name}
                  </h3>
                  <span className="text-xs text-slate-400" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-xs text-slate-500 truncate">
                    {activeCommunity.name}
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {typingUser
                    ? `${typingUser} is typing...`
                    : activeGroup.onlyAdminsCanPost
                    ? 'Announcement channel · Admins, HOD & Class Advisors can post'
                    : activeGroup.description || 'Real-time department messaging channel'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleStartCall('audio')}
                  title="Start Group Voice Call"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Voice Call
                </button>
                <button
                  type="button"
                  onClick={() => handleStartCall('video')}
                  title="Start Group Video Meet"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-md whitespace-nowrap"
                >
                  <Video className="w-3.5 h-3.5" />
                  Video Meet
                </button>

                {activeCommunity.canManage && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEditGroup(activeGroup)}
                      title="Edit Group"
                      className="p-2 text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-md"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditCommunity(activeCommunity)}
                      title="Edit Community"
                      className="p-2 text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-md"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </header>

            {/* Live Active Call Join Banner */}
            {activeGroupCallParticipants.length > 0 && !activeCallRoom && (
              <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-950 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                  <span>
                    Live Call in Progress ·{' '}
                    <span className="font-mono tabular-nums">
                      {activeGroupCallParticipants.length}
                    </span>{' '}
                    {activeGroupCallParticipants.length === 1 ? 'participant' : 'participants'} (
                    {activeGroupCallParticipants
                      .slice(0, 3)
                      .map((p) => p.fullName)
                      .join(', ')}
                    )
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleJoinCall('audio')}
                    className="px-3 py-1 text-xs font-medium text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                  >
                    Join Audio
                  </button>
                  <button
                    type="button"
                    onClick={() => handleJoinCall('video')}
                    className="px-3 py-1 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                  >
                    Join Video Meet
                  </button>
                </div>
              </div>
            )}

            {/* Pinned Notice Banner */}
            {pinnedMessages.length > 0 && (
              <div className="px-5 py-2 bg-amber-50/80 border-b border-amber-200/70 flex items-center gap-2 text-xs text-amber-950">
                <Pin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span className="font-medium shrink-0">Pinned:</span>
                <span className="truncate">{pinnedMessages[pinnedMessages.length - 1].content}</span>
              </div>
            )}

            {errorMsg && (
              <div className="mx-5 mt-3 p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-800 flex items-center justify-between gap-2">
                <span>{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => setErrorMsg(null)}
                  className="text-red-500 hover:text-red-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Message Feed */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 max-h-[540px]">
              {messages.length === 0 && (
                <div className="py-16 text-center text-xs text-slate-500">
                  No messages in {activeGroup.name} yet. Share a message, document, photo, contact, live location, voice note, or start a Group Video Meet below.
                </div>
              )}

              {messages.map((msg) => {
                const isMine = msg.senderUserId === user.id;
                const replyParent = msg.replyToId
                  ? messages.find((m) => m.id === msg.replyToId)
                  : null;
                const att = msg.attachment;
                const safeBoostUrl = getSafeExternalUrl(msg.powerBoostActionUrl);
                const safeSharedUrl = getSafeExternalUrl(att?.url);
                const canStopBoost =
                  msg.powerBoostEnabled && (isMine || activeCommunity.canManage || user.role === 'hod');

                if (msg.messageType === 'system') {
                  return (
                    <div key={msg.id} className="text-center py-1">
                      <span className="text-[11px] text-slate-500">
                        {msg.content} · {msg.createdAt.slice(11, 16)}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[90%] sm:max-w-[76%] rounded-lg px-4 py-3 border space-y-2 ${
                        msg.powerBoostEnabled
                          ? 'bg-amber-50/70 border-amber-300 text-slate-900'
                          : isMine
                          ? 'bg-emerald-50 border-emerald-200 text-slate-900'
                          : 'bg-white border-slate-200 text-slate-900'
                      }`}
                    >
                      {/* Sender Header & Message Actions */}
                      <div className="flex items-center justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => openSenderProfile(msg)}
                          title={`View ${msg.senderName}'s profile or send Wake-Up Page-Call`}
                          className="text-[11px] font-semibold text-slate-800 hover:text-indigo-700 flex items-center gap-1.5 flex-wrap text-left transition-colors"
                        >
                          {msg.senderPhotoData ? (
                            <img
                              src={msg.senderPhotoData}
                              alt={msg.senderName}
                              className="w-5 h-5 rounded-full object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 text-[9px] font-bold flex items-center justify-center shrink-0">
                              {msg.senderName
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((p) => p[0]?.toUpperCase() || '')
                                .join('') || 'U'}
                            </span>
                          )}
                          {msg.powerBoostEnabled && (
                            <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          )}
                          <span className="underline-offset-2 hover:underline">{msg.senderName}</span>
                          <span className="font-normal text-slate-500">
                            · {ROLE_LABELS[msg.senderRole as UserRole] ?? msg.senderRole}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
                          <button
                            type="button"
                            title="Reply"
                            onClick={() => {
                              setReplyTarget(msg);
                              setEditingMsg(null);
                            }}
                            className="hover:text-slate-700"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Forward / Share to another chat"
                            onClick={() => openForwardModal(msg)}
                            className="hover:text-slate-700"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                          {activeCommunity.canManage && (
                            <button
                              type="button"
                              title={msg.isPinned ? 'Unpin' : 'Pin message'}
                              onClick={() => handleTogglePin(msg)}
                              className={
                                msg.isPinned ? 'text-amber-600' : 'hover:text-slate-700'
                              }
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isMine && (
                            <button
                              type="button"
                              title="Edit message"
                              onClick={() => {
                                setEditingMsg(msg);
                                setReplyTarget(null);
                                setDraft(msg.content);
                              }}
                              className="hover:text-slate-700"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(isMine || activeCommunity.canManage) && (
                            <button
                              type="button"
                              title="Delete message"
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Reply Quote */}
                      {replyParent && (
                        <div className="px-2.5 py-1.5 rounded bg-slate-100/90 border-l-2 border-emerald-600 text-[11px] text-slate-600">
                          <span className="font-medium text-slate-800">
                            {replyParent.senderName}:{' '}
                          </span>
                          <span className="line-clamp-1">{replyParent.content}</span>
                        </div>
                      )}

                      {/* Rich Attachment Rendering */}
                      {msg.attachmentType === 'photo' && att?.fileKey && (
                        <div className="space-y-1.5">
                          <AuthenticatedPhoto
                            token={token}
                            fileKey={att.fileKey}
                            fileName={att.fileName || 'photo.jpg'}
                            onExpand={(blobUrl, fileName, fileKey) =>
                              setLightboxPhoto({ blobUrl, fileName, fileKey })
                            }
                          />
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span className="truncate">{att.fileName}</span>
                            <button
                              type="button"
                              onClick={() =>
                                api.downloadChatAttachment(
                                  token,
                                  att.fileKey!,
                                  att.fileName || 'photo.jpg'
                                )
                              }
                              className="inline-flex items-center gap-1 text-indigo-700 hover:underline whitespace-nowrap"
                            >
                              <Download className="w-3 h-3" />
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {msg.attachmentType === 'document' && att?.fileKey && (
                        <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {att.fileName || 'Document'}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {formatBytes(att.fileSize)}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              api.downloadChatAttachment(
                                token,
                                att.fileKey!,
                                att.fileName || 'document'
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md whitespace-nowrap shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </button>
                        </div>
                      )}

                      {msg.attachmentType === 'voice' && att?.fileKey && (
                        <AuthenticatedAudio
                          token={token}
                          fileKey={att.fileKey}
                          fileName={att.fileName || 'voice-note.webm'}
                          durationSec={att.durationSec}
                        />
                      )}

                      {msg.attachmentType === 'contact' && att?.contactName && (
                        <div className="p-3 rounded-lg bg-white border border-slate-200 space-y-1.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                              <Contact className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {att.contactName}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {[att.contactRole, att.contactDepartment, att.contactId]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100 text-[11px] text-slate-700">
                            {att.contactPhone && (
                              <span className="font-mono tabular-nums">
                                Tel: {att.contactPhone}
                              </span>
                            )}
                            {att.contactEmail && (
                              <span className="truncate">{att.contactEmail}</span>
                            )}
                          </div>
                        </div>
                      )}

                      {msg.attachmentType === 'location' &&
                        att?.latitude !== undefined &&
                        att?.longitude !== undefined && (
                          <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-md bg-rose-50 text-rose-700 flex items-center justify-center shrink-0">
                                <MapPin className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-900 truncate">
                                  {att.isLiveLocation ? 'Live Location · ' : ''}
                                  {att.locationLabel || 'Shared Location'}
                                </div>
                                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                                  {att.latitude.toFixed(5)}, {att.longitude.toFixed(5)}
                                  {att.accuracyMeters ? ` (±${att.accuracyMeters}m)` : ''}
                                </div>
                              </div>
                            </div>
                            <a
                              href={`https://www.google.com/maps?q=${encodeURIComponent(
                                `${att.latitude},${att.longitude}`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md whitespace-nowrap shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Open Map
                            </a>
                          </div>
                        )}

                      {msg.attachmentType === 'shared_link' && safeSharedUrl && (
                        <div className="p-3 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                              <Link2 className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                                {att?.sourceApp || detectSourceApp(safeSharedUrl)}
                              </div>
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {att?.title || safeSharedUrl}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {safeSharedUrl}
                              </div>
                            </div>
                          </div>
                          <a
                            href={safeSharedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md whitespace-nowrap shrink-0"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </a>
                        </div>
                      )}

                      {msg.attachmentType === 'call_invite' && (
                        <div className="p-3 rounded-lg bg-indigo-50/70 border border-indigo-200 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-9 h-9 rounded-md bg-indigo-700 text-white flex items-center justify-center shrink-0">
                              {att?.callMode === 'audio' ? (
                                <Phone className="w-4 h-4" />
                              ) : (
                                <Video className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900">
                                {att?.callMode === 'audio'
                                  ? 'Group Voice Call'
                                  : 'Group Video Meet'}
                              </div>
                              <div className="text-[11px] text-slate-600 tabular-nums">
                                {activeGroupCallParticipants.length > 0
                                  ? `${activeGroupCallParticipants.length} active right now`
                                  : 'Click to start or join room'}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleJoinCall(att?.callMode === 'audio' ? 'audio' : 'video')
                            }
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-md whitespace-nowrap shrink-0"
                          >
                            Join Now
                          </button>
                        </div>
                      )}

                      {/* Message Text Body */}
                      {msg.content && (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                          {msg.content}
                        </p>
                      )}

                      {/* Power Boost Interactive Banner & Response Tracker */}
                      {msg.powerBoostEnabled && (
                        <div className="pt-2 mt-1 border-t border-amber-200 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span className="font-semibold text-amber-900 inline-flex items-center gap-1">
                              <Zap className="w-3.5 h-3.5 text-amber-600" />
                              Power Boost ON · Repeats every {msg.powerBoostIntervalMinutes}m
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedAckMsgId((prev) =>
                                    prev === msg.id ? null : msg.id
                                  )
                                }
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-950 font-medium font-mono tabular-nums"
                              >
                                {msg.acknowledgements.length} Responded
                                {expandedAckMsgId === msg.id ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                              {canStopBoost && (
                                <button
                                  type="button"
                                  onClick={() => handleStopPowerBoost(msg.id)}
                                  className="text-red-700 hover:underline font-medium"
                                >
                                  Stop Boost
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Recipient Response Action Controls */}
                          {!isMine && !msg.acknowledgedByMe && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <input
                                type="text"
                                value={ackNotes[msg.id] ?? ''}
                                onChange={(e) =>
                                  setAckNotes((prev) => ({
                                    ...prev,
                                    [msg.id]: e.target.value,
                                  }))
                                }
                                placeholder="Response note (e.g. Google Form filled)"
                                maxLength={120}
                                className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-md focus:outline-none"
                              />
                              {safeBoostUrl && (
                                <a
                                  href={safeBoostUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-md whitespace-nowrap"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  Open Form / Link
                                </a>
                              )}
                              <button
                                type="button"
                                disabled={ackingMsgId === msg.id}
                                onClick={() =>
                                  handleAcknowledgePowerBoost(
                                    msg,
                                    safeBoostUrl ? 'Completed form / link' : 'Acknowledged'
                                  )
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md whitespace-nowrap"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {ackingMsgId === msg.id
                                  ? 'Saving...'
                                  : 'Responded — Turn Off Alerts'}
                              </button>
                            </div>
                          )}

                          {!isMine && msg.acknowledgedByMe && (
                            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                              You responded — repeating alerts are turned OFF for you.
                            </div>
                          )}

                          {safeBoostUrl && (isMine || msg.acknowledgedByMe) && (
                            <a
                              href={safeBoostUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Action Link: {safeBoostUrl}
                            </a>
                          )}

                          {/* Expandable Responders List */}
                          {expandedAckMsgId === msg.id && (
                            <div className="bg-white border border-amber-200 rounded-md p-2.5 space-y-1.5 text-xs">
                              {msg.acknowledgements.length === 0 ? (
                                <div className="text-slate-500">No responses recorded yet.</div>
                              ) : (
                                msg.acknowledgements.map((ack) => (
                                  <div
                                    key={ack.id}
                                    className="flex items-center justify-between gap-2 text-[11px] border-b last:border-b-0 border-slate-100 pb-1 last:pb-0"
                                  >
                                    <div className="min-w-0">
                                      <span className="font-semibold text-slate-900">
                                        {ack.userName}
                                      </span>{' '}
                                      <span className="text-slate-500">
                                        ({ROLE_LABELS[ack.userRole as UserRole] ?? ack.userRole})
                                      </span>
                                      {ack.responseNote && (
                                        <span className="text-emerald-800">
                                          {' '}
                                          — {ack.responseNote}
                                        </span>
                                      )}
                                    </div>
                                    <span className="font-mono tabular-nums text-slate-400 shrink-0">
                                      {ack.acknowledgedAt.slice(11, 16)}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Timestamp & Delivery Ticks */}
                      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono tabular-nums text-slate-500">
                        {msg.editedAt && <span>edited ·</span>}
                        <span>{msg.createdAt.slice(11, 16)}</span>
                        {isMine && <CheckCheck className="w-3.5 h-3.5 text-emerald-700" />}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Rich Message Composer */}
            <div className="p-3.5 sm:p-4 bg-white border-t border-slate-200 space-y-2.5 relative">
              {/* Reply / Edit Banner */}
              {(replyTarget || editingMsg) && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
                  <span className="truncate">
                    {editingMsg
                      ? `Editing message: "${editingMsg.content}"`
                      : `Replying to ${replyTarget?.senderName}: "${replyTarget?.content}"`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTarget(null);
                      setEditingMsg(null);
                      setDraft('');
                    }}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Pending Attachment Preview Chip */}
              {pendingAttachment && (
                <div className="flex items-center justify-between gap-2 px-3 py-2 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-950">
                  <div className="flex items-center gap-2 min-w-0">
                    {pendingAttachment.type === 'document' && <FileText className="w-4 h-4 shrink-0" />}
                    {pendingAttachment.type === 'photo' && <ImageIcon className="w-4 h-4 shrink-0" />}
                    {pendingAttachment.type === 'contact' && <Contact className="w-4 h-4 shrink-0" />}
                    {pendingAttachment.type === 'location' && <MapPin className="w-4 h-4 shrink-0" />}
                    {pendingAttachment.type === 'voice' && <Mic className="w-4 h-4 shrink-0" />}
                    {pendingAttachment.type === 'shared_link' && <Link2 className="w-4 h-4 shrink-0" />}
                    <span className="truncate font-medium">
                      Ready to send:{' '}
                      {pendingAttachment.payload.fileName ||
                        pendingAttachment.payload.contactName ||
                        pendingAttachment.payload.locationLabel ||
                        pendingAttachment.payload.title ||
                        pendingAttachment.type}
                      {pendingAttachment.payload.durationSec
                        ? ` (${formatSeconds(pendingAttachment.payload.durationSec)})`
                        : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingAttachment(null)}
                    className="text-indigo-500 hover:text-indigo-900"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Power Boost Mode Configurator (HOD / Class Advisor / Class Rep) */}
              {canUsePowerBoost && powerBoostOn && canPostInActiveGroup && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-amber-950 inline-flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-600" />
                      Power Boost Message Mode Active — Repeats alert until each recipient responds
                    </span>
                    <button
                      type="button"
                      onClick={() => setPowerBoostOn(false)}
                      className="text-amber-700 hover:text-amber-950"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium text-amber-900">
                        Repeat Timer
                      </span>
                      <select
                        value={powerBoostInterval}
                        onChange={(e) => setPowerBoostInterval(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-md"
                      >
                        <option value={1}>Every 1 minute</option>
                        <option value={2}>Every 2 minutes</option>
                        <option value={5}>Every 5 minutes</option>
                        <option value={10}>Every 10 minutes</option>
                        <option value={15}>Every 15 minutes</option>
                        <option value={30}>Every 30 minutes</option>
                        <option value={60}>Every 60 minutes</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium text-amber-900">
                        Active Duration
                      </span>
                      <select
                        value={powerBoostDurationHours}
                        onChange={(e) => setPowerBoostDurationHours(Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-md"
                      >
                        <option value={1}>1 hour</option>
                        <option value={6}>6 hours</option>
                        <option value={24}>24 hours</option>
                        <option value={72}>3 days</option>
                        <option value={0}>Until manually stopped</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[11px] font-medium text-amber-900">
                        Google Form / Action Link (optional)
                      </span>
                      <input
                        type="url"
                        value={powerBoostActionUrl}
                        onChange={(e) => setPowerBoostActionUrl(e.target.value)}
                        placeholder="https://forms.gle/..."
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-md"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* WhatsApp-Style Attachment Drawer Popover */}
              {attachMenuOpen && (
                <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-lg grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  <button
                    type="button"
                    onClick={() => docInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 text-xs font-medium text-slate-700"
                  >
                    <FileText className="w-4 h-4 text-indigo-700" />
                    Document
                  </button>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-emerald-50 hover:border-emerald-200 text-xs font-medium text-slate-700"
                  >
                    <ImageIcon className="w-4 h-4 text-emerald-700" />
                    Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setContactModalOpen(true);
                    }}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-sky-50 hover:border-sky-200 text-xs font-medium text-slate-700"
                  >
                    <Contact className="w-4 h-4 text-sky-700" />
                    Contact
                  </button>
                  <button
                    type="button"
                    onClick={openLocationModal}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-xs font-medium text-slate-700"
                  >
                    <MapPin className="w-4 h-4 text-rose-700" />
                    Live Location
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      setLinkModalOpen(true);
                    }}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-violet-50 hover:border-violet-200 text-xs font-medium text-slate-700"
                  >
                    <Link2 className="w-4 h-4 text-violet-700" />
                    Share Link
                  </button>
                  <button
                    type="button"
                    onClick={startVoiceRecording}
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg border border-slate-200 hover:bg-amber-50 hover:border-amber-200 text-xs font-medium text-slate-700"
                  >
                    <Mic className="w-4 h-4 text-amber-700" />
                    Voice Note
                  </button>
                </div>
              )}

              {/* Active Voice Recording Strip */}
              {recordingVoice && (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded-lg text-xs">
                  <div className="flex items-center gap-2 text-red-900 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                    <span>Recording voice note...</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatSeconds(voiceSeconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => stopVoiceRecording(true)}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => stopVoiceRecording(false)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md"
                    >
                      <Square className="w-3 h-3 fill-current" />
                      Stop & Attach
                    </button>
                  </div>
                </div>
              )}

              {canPostInActiveGroup ? (
                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadingFile || recordingVoice}
                    onClick={() => setAttachMenuOpen((prev) => !prev)}
                    title="Attach document, photo, contact, live location, or link"
                    className={`min-h-[42px] min-w-[42px] flex items-center justify-center rounded-lg border transition-colors shrink-0 ${
                      attachMenuOpen
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  {canUsePowerBoost && !editingMsg && (
                    <button
                      type="button"
                      onClick={() => setPowerBoostOn((prev) => !prev)}
                      title="Toggle Power Boost repeating alert mode (HOD / Class Advisor / Class Rep)"
                      className={`min-h-[42px] px-2.5 inline-flex items-center gap-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        powerBoostOn
                          ? 'bg-amber-500 border-amber-600 text-slate-950'
                          : 'bg-white border-slate-300 text-slate-700 hover:bg-amber-50'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Power Boost</span>
                    </button>
                  )}

                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      notifyTyping();
                    }}
                    placeholder={
                      uploadingFile
                        ? 'Uploading attachment...'
                        : powerBoostOn
                        ? 'Write Power Boost announcement or paste Google Form link...'
                        : `Message ${activeGroup.name}...`
                    }
                    maxLength={2000}
                    className="flex-1 min-w-0 px-3.5 py-2.5 min-h-[42px] text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />

                  {!recordingVoice && !draft.trim() && !pendingAttachment ? (
                    <button
                      type="button"
                      onClick={startVoiceRecording}
                      title="Record voice note"
                      className="min-h-[42px] min-w-[42px] flex items-center justify-center text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shrink-0"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={sending || uploadingFile || (!draft.trim() && !pendingAttachment)}
                      className={`inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[42px] text-sm font-medium text-white disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        powerBoostOn
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-emerald-700 hover:bg-emerald-800'
                      }`}
                    >
                      <Send className="w-4 h-4" />
                      {editingMsg ? 'Update' : powerBoostOn ? 'Boost Send' : 'Send'}
                    </button>
                  )}
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-600 py-2">
                  <span>
                    Only community administrators, HOD, or Class Advisors can post in this announcement channel.
                  </span>
                  {(() => {
                    const writable = activeCommunity.groups.find((g) => canPostInGroup(activeCommunity, g));
                    if (!writable) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGroupId(writable.id);
                          setEditingMsg(null);
                          setReplyTarget(null);
                          setPendingAttachment(null);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-md whitespace-nowrap"
                      >
                        Switch to {writable.name}
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-3">
            <MessageSquare className="w-8 h-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-800">
              Select a community group to begin messaging
            </p>
            {canCreateCommunity && (
              <button
                type="button"
                onClick={openCreateCommunity}
                className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                Create First Community
              </button>
            )}
          </div>
        )}
      </section>

      {/* Google Meet-Style Live Audio / Group Video Call Room */}
      {activeCallRoom && (
        <CommunityCallRoom
          ws={wsRef.current}
          mySocketId={mySocketId}
          groupId={activeCallRoom.groupId}
          groupName={activeCallRoom.groupName}
          communityName={activeCallRoom.communityName}
          initialMode={activeCallRoom.mode}
          currentUser={user}
          participants={activeCalls[String(activeCallRoom.groupId)] ?? []}
          signalQueue={callSignalQueue}
          onSignalsConsumed={consumeSignals}
          onLeave={() => setActiveCallRoom(null)}
        />
      )}

      {/* Photo Lightbox Viewer */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-white text-xs">
              <span className="truncate font-medium">{lightboxPhoto.fileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    api.downloadChatAttachment(
                      token,
                      lightboxPhoto.fileKey,
                      lightboxPhoto.fileName
                    )
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-md"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxPhoto(null)}
                  className="p-1.5 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 flex items-center justify-center bg-black">
              <img
                src={lightboxPhoto.blobUrl}
                alt={lightboxPhoto.fileName}
                className="max-h-[75vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Contact Sharing Modal */}
      {contactModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Share Contact to Chat</h3>
              <button
                type="button"
                onClick={() => setContactModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setContactTab('directory')}
                className={`flex-1 py-1.5 font-medium rounded-md ${
                  contactTab === 'directory' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Department Directory
              </button>
              <button
                type="button"
                onClick={() => setContactTab('custom')}
                className={`flex-1 py-1.5 font-medium rounded-md ${
                  contactTab === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Custom Contact
              </button>
            </div>

            {contactTab === 'directory' ? (
              <div className="space-y-3">
                <input
                  type="search"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search students, faculty, or roll/employee ID..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {directoryContacts.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      No matching contacts found. Switch to Custom Contact to enter manually.
                    </div>
                  ) : (
                    directoryContacts.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => handleSelectDirectoryContact(c)}
                        className="w-full text-left px-3.5 py-2.5 hover:bg-emerald-50 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 truncate">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {c.role} · {c.id}
                          </div>
                        </div>
                        <span className="text-[11px] font-medium text-emerald-700 shrink-0">
                          Attach
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleCustomContactSubmit} className="space-y-3 text-xs">
                <input
                  type="text"
                  required
                  value={customContact.name}
                  onChange={(e) =>
                    setCustomContact((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="Full Name *"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  value={customContact.role}
                  onChange={(e) =>
                    setCustomContact((p) => ({ ...p, role: e.target.value }))
                  }
                  placeholder="Role / Designation"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="tel"
                  value={customContact.phone}
                  onChange={(e) =>
                    setCustomContact((p) => ({ ...p, phone: e.target.value }))
                  }
                  placeholder="Phone Number"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="email"
                  value={customContact.email}
                  onChange={(e) =>
                    setCustomContact((p) => ({ ...p, email: e.target.value }))
                  }
                  placeholder="Email Address"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setContactModalOpen(false)}
                    className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg"
                  >
                    Attach Contact
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Live Location Modal */}
      {locationModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Share Live Location</h3>
              <button
                type="button"
                onClick={() => setLocationModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {locLoading && (
              <div className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md p-2.5">
                Acquiring GPS coordinates from your device...
              </div>
            )}
            {locError && (
              <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                {locError}
              </div>
            )}

            <ClassroomMapPicker
              latitude={locLat && Number.isFinite(Number(locLat)) ? Number(locLat) : null}
              longitude={locLng && Number.isFinite(Number(locLng)) ? Number(locLng) : null}
              radiusMeters={100}
              label={locLabel || 'Pinned Chat Location'}
              height="220px"
              onSelectLocation={({ lat, lng, label: pickedLabel }) => {
                setLocLat(lat.toFixed(6));
                setLocLng(lng.toFixed(6));
                if (pickedLabel && !locLabel.trim()) {
                  setLocLabel(pickedLabel);
                }
              }}
            />

            <form onSubmit={handleAttachLocation} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="space-y-1">
                  <span className="block font-medium text-slate-700">Latitude</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={locLat}
                    onChange={(e) => setLocLat(e.target.value)}
                    placeholder="11.341036"
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block font-medium text-slate-700">Longitude</span>
                  <input
                    type="number"
                    step="any"
                    required
                    value={locLng}
                    onChange={(e) => setLocLng(e.target.value)}
                    placeholder="77.717164"
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="block font-medium text-slate-700">Location Label</span>
                <input
                  type="text"
                  value={locLabel}
                  onChange={(e) => setLocLabel(e.target.value)}
                  placeholder="e.g., EIE Block Lab 2, Seminar Hall"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>
              <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={locIsLive}
                  onChange={(e) => setLocIsLive(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-700"
                />
                <span>Mark as Live Location pin</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLocationModalOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg"
                >
                  Attach Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share External Link / Reel / Google Form Modal */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Share External Link / Post / Form
              </h3>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAttachLink} className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="block font-medium text-slate-700">Link URL *</span>
                <input
                  type="url"
                  required
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://www.instagram.com/reel/... or https://forms.gle/..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="block font-medium text-slate-700">Title (optional)</span>
                <input
                  type="text"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  placeholder="e.g., Semester Feedback Form or Tech Reel"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="block font-medium text-slate-700">Caption (optional)</span>
                <textarea
                  rows={2}
                  value={linkCaption}
                  onChange={(e) => setLinkCaption(e.target.value)}
                  placeholder="Add note for the group..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setLinkModalOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium rounded-lg"
                >
                  Attach Link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WhatsApp-Style Incoming External Share / Forward Destination Picker */}
      {sharePicker && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {sharePicker.mode === 'incoming_external'
                    ? 'Share to Community Chat'
                    : 'Forward Message to Chat'}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Choose any community group below to share this content.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSharePicker(null);
                  onClearIncomingShare?.();
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleShareToSelectedGroup} className="space-y-3 text-xs">
              {sharePicker.url && (
                <div className="p-2.5 rounded-lg bg-indigo-50/70 border border-indigo-200 space-y-0.5">
                  <div className="text-[10px] font-semibold uppercase text-indigo-700">
                    {detectSourceApp(sharePicker.url)}
                  </div>
                  <div className="font-medium text-slate-900 truncate">{sharePicker.title}</div>
                  <div className="text-[11px] text-slate-600 truncate">{sharePicker.url}</div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="block font-medium text-slate-700">Select Destination Chat</span>
                <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {communities.map((c) =>
                    c.groups.map((g) => (
                      <label
                        key={g.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer ${
                          shareTargetGroupId === g.id ? 'bg-emerald-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="radio"
                            name="share_target_group"
                            checked={shareTargetGroupId === g.id}
                            onChange={() => setShareTargetGroupId(g.id)}
                            className="text-emerald-700"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{g.name}</div>
                            <div className="text-[11px] text-slate-500 truncate">{c.name}</div>
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <label className="block space-y-1">
                <span className="block font-medium text-slate-700">Message / Caption</span>
                <textarea
                  rows={2}
                  value={sharePicker.caption}
                  onChange={(e) =>
                    setSharePicker((prev) =>
                      prev ? { ...prev, caption: e.target.value } : null
                    )
                  }
                  placeholder="Add a caption..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </label>

              {canUsePowerBoost && (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 font-medium text-amber-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sharePowerBoost}
                      onChange={(e) => setSharePowerBoost(e.target.checked)}
                      className="rounded border-amber-400 text-amber-600"
                    />
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    Enable Power Boost Reminder
                  </label>
                  {sharePowerBoost && (
                    <select
                      value={sharePowerInterval}
                      onChange={(e) => setSharePowerInterval(Number(e.target.value))}
                      className="px-2 py-1 text-xs bg-white border border-amber-300 rounded"
                    >
                      <option value={1}>Every 1m</option>
                      <option value={5}>Every 5m</option>
                      <option value={15}>Every 15m</option>
                      <option value={30}>Every 30m</option>
                    </select>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setSharePicker(null);
                    onClearIncomingShare?.();
                  }}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={shareSending || !shareTargetGroupId}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-medium rounded-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  {shareSending ? 'Sending...' : 'Share to Selected Chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Community & Group Modal */}
      {modalMode && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                {modalMode === 'create_comm' && 'Create New Community'}
                {modalMode === 'edit_comm' && 'Edit Community Authority & Details'}
                {modalMode === 'create_group' && 'Add Group to Community'}
                {modalMode === 'edit_group' && 'Edit Group Settings'}
              </h3>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  {modalMode.includes('comm') ? 'Community Name' : 'Group Name'}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={
                    modalMode.includes('comm')
                      ? 'e.g., III Year EIE Academic Hub'
                      : 'e.g., Instrumentation Lab Coordination'
                  }
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Purpose, guidelines, or scope of this channel..."
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              {(modalMode === 'create_comm' || modalMode === 'edit_comm') && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Community Category
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as CommunityCategory)}
                    className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="department">Department Hub</option>
                    <option value="academic_class">Academic Class</option>
                    <option value="faculty_council">Faculty Council</option>
                    <option value="announcement">Official Broadcast</option>
                    <option value="general">General Group</option>
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formFlag}
                  onChange={(e) => setFormFlag(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>
                  {modalMode.includes('comm')
                    ? 'Announcements-only community (restricts default channel to admins)'
                    : 'Only community admins, HOD, and Class Advisors can post messages'}
                </span>
              </label>

              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-200">
                {modalMode === 'edit_comm' ? (
                  <button
                    type="button"
                    disabled={modalSaving}
                    onClick={handleDeleteCommunity}
                    className="px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md"
                  >
                    Delete Community
                  </button>
                ) : modalMode === 'edit_group' ? (
                  <button
                    type="button"
                    disabled={modalSaving}
                    onClick={handleDeleteGroup}
                    className="px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-md"
                  >
                    Delete Group
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalMode(null)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={modalSaving}
                    className="px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg"
                  >
                    {modalSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      <RecordProfileModal
        open={Boolean(profileModalTarget)}
        onClose={() => setProfileModalTarget(null)}
        token={token}
        person={profileModalTarget}
      />
    </div>
      )}
    </div>
  );
}
