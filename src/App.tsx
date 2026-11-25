import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Camera,
  CheckSquare,
  FileCheck2,
  FileUp,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  SlidersHorizontal,
  Users,
  UserCheck,
  X,
} from 'lucide-react';
import { ApprovalsView } from './components/ApprovalsView';
import { AuthPortal } from './components/AuthPortal';
import { CameraAttendanceView } from './components/CameraAttendanceView';
import { ChromaGradeMark } from './components/ChromaGradeMark';
import { ClassAdvisorView } from './components/ClassAdvisorView';
import { DocumentUploadView } from './components/DocumentUploadView';
import {
  DepartmentStaffView,
  DepartmentStudentsView,
  OtherDepartmentStaffView,
} from './components/HodDirectoryViews';
import { ExportConfirmationToast } from './components/ExportConfirmationToast';
import { OdLeaveView } from './components/OdLeaveView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverviewView, type NavSection } from './components/OverviewView';
import { PowerBoostAlertBar } from './components/PowerBoostAlertBar';
import { ProfileView } from './components/ProfileView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { SplashScreen } from './components/SplashScreen';
import { TimetableView } from './components/TimetableView';
import { WhatsAppCommunityView } from './components/WhatsAppCommunityView';
import { WorkspaceNotificationCenter } from './components/WorkspaceNotificationCenter';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { useServerTime } from './hooks/useServerTime';
import { api } from './lib/api';
import { auth } from './lib/firebase';
import {
  ROLE_LABELS,
  type DepartmentStaff,
  type DepartmentStudent,
  type EmailIntimation,
  type OtherDepartmentStaff,
  type SharedContentPayload,
  type TimetableSlot,
  type UploadBatch,
  type UploadModule,
  type UserProfile,
} from './types';

interface NavItem {
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
  badgeCount?: number;
}

export default function App() {
  // Auth token kept strictly in JS/React memory (never localStorage/sessionStorage)
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('overview');
  const [uploadTargetModule, setUploadTargetModule] = useState<UploadModule>('department_students');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showSplash, setShowSplash] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('academia_esec_splash_played') !== '1';
    } catch {
      return true;
    }
  });

  const handleSplashComplete = useCallback(() => {
    try {
      sessionStorage.setItem('academia_esec_splash_played', '1');
    } catch {
      // Ignore storage errors
    }
    setShowSplash(false);
  }, []);

  // Capture incoming PWA Shortcut (?tab=communities&sub=analytics) and Web Share Target params
  const [initialLaunchTarget] = useState<{
    tab: NavSection | null;
    sub: 'chat' | 'analytics';
  }>(() => {
    if (typeof window === 'undefined') return { tab: null, sub: 'chat' };
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab');
    const rawSub = params.get('sub');
    const validTabs: NavSection[] = [
      'overview',
      'communities',
      'attendance',
      'od_leave',
      'approvals',
      'students',
      'dept_staff',
      'other_staff',
      'advisor_class',
      'timetable',
      'uploads',
      'profile',
    ];
    const tab = rawTab && validTabs.includes(rawTab as NavSection) ? (rawTab as NavSection) : null;
    const sub: 'chat' | 'analytics' = rawSub === 'analytics' ? 'analytics' : 'chat';
    return { tab, sub };
  });

  const [incomingShare, setIncomingShare] = useState<SharedContentPayload | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const title = params.get('share_title')?.trim() ?? '';
    const text = params.get('share_text')?.trim() ?? '';
    const rawUrl = params.get('share_url')?.trim() ?? '';
    // Some Android apps place the URL inside share_text instead of share_url
    const extractedUrl =
      rawUrl || (text.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? '');
    if (params.has('tab') || params.has('sub') || title || text || extractedUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (!title && !text && !extractedUrl) return null;
    return { title, text, url: extractedUrl };
  });
  const [targetChatGroupId, setTargetChatGroupId] = useState<number | null>(null);
  const [communityInitialSubTab, setCommunityInitialSubTab] = useState<'chat' | 'analytics'>(
    initialLaunchTarget.sub
  );
  const [powerBoostRefreshSignal, setPowerBoostRefreshSignal] = useState(0);
  const [activePowerBoostCount, setActivePowerBoostCount] = useState(0);
  const [activeFacultyDelayCount, setActiveFacultyDelayCount] = useState(0);

  // Academic dataset state
  const [students, setStudents] = useState<DepartmentStudent[]>([]);
  const [deptStaff, setDeptStaff] = useState<DepartmentStaff[]>([]);
  const [otherStaff, setOtherStaff] = useState<OtherDepartmentStaff[]>([]);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [registrations, setRegistrations] = useState<UserProfile[]>([]);
  const [intimations, setIntimations] = useState<EmailIntimation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Transit buffer settings state
  const [transitSettingsOpen, setTransitSettingsOpen] = useState(false);
  const [transitBufferInput, setTransitBufferInput] = useState<number>(15);
  const [savingTransit, setSavingTransit] = useState(false);
  const [transitError, setTransitError] = useState<string | null>(null);
  const [transitSavedMsg, setTransitSavedMsg] = useState<string | null>(null);

  const { serverTime, displayTime, refreshServerTime } = useServerTime();

  const loadWorkspaceData = useCallback(
    async (authToken: string, profile: UserProfile) => {
      setDataLoading(true);
      try {
        const [stRes, dsRes, osRes, ttRes, batchRes] = await Promise.all([
          api.getStudents(authToken),
          api.getDepartmentStaff(authToken),
          api.getOtherDepartmentStaff(authToken),
          api.getTimetable(authToken),
          api.getUploadBatches(authToken),
        ]);
        setStudents(stRes.students);
        setDeptStaff(dsRes.staff);
        setOtherStaff(osRes.staff);
        setSlots(ttRes.slots);
        setBatches(batchRes.batches);

        if (profile.role === 'hod') {
          const [regRes, intRes] = await Promise.all([
            api.getRegistrations(authToken),
            api.getIntimations(authToken),
          ]);
          setRegistrations(regRes.registrations);
          setIntimations(intRes.intimations);
        } else {
          setRegistrations([]);
          setIntimations([]);
        }
      } catch {
        // Handled cleanly in UI
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (token && user) {
      loadWorkspaceData(token, user);
    }
  }, [token, user, loadWorkspaceData]);

  const handleAuthenticated = useCallback(
    (newToken: string, newUser: UserProfile) => {
      try {
        sessionStorage.removeItem('chromagrade_signed_out');
      } catch {
        // Ignore storage errors
      }
      setToken(newToken);
      setUser(newUser);
      setTransitBufferInput(newUser.transitBufferMinutes ?? 15);
      if (incomingShare) {
        setCommunityInitialSubTab('chat');
        setActiveSection('communities');
      } else if (initialLaunchTarget.tab) {
        setCommunityInitialSubTab(initialLaunchTarget.sub);
        setActiveSection(initialLaunchTarget.tab);
      } else if (newUser.role === 'class_advisor') {
        setActiveSection('advisor_class');
      } else {
        setActiveSection('overview');
      }
    },
    [incomingShare, initialLaunchTarget]
  );

  const handleSignOut = async () => {
    try {
      sessionStorage.setItem('chromagrade_signed_out', '1');
    } catch {
      // Ignore storage errors
    }
    if (token) {
      await api.logout(token).catch(() => {});
    }
    await firebaseSignOut(auth).catch(() => {});
    setToken(null);
    setUser(null);
    setActivePowerBoostCount(0);
    setActiveSection('overview');
    setMobileMenuOpen(false);
    setTransitSettingsOpen(false);
  };

  const handleOpenTransitSettings = () => {
    setTransitBufferInput(user?.transitBufferMinutes ?? 15);
    setTransitError(null);
    setTransitSavedMsg(null);
    setTransitSettingsOpen(true);
    setMobileMenuOpen(false);
  };

  const handleSaveTransitSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSavingTransit(true);
    setTransitError(null);
    setTransitSavedMsg(null);
    try {
      const clamped = Math.min(60, Math.max(0, Math.round(Number(transitBufferInput) || 0)));
      const res = await api.updateProfileSettings(token, { transitBufferMinutes: clamped });
      setUser(res.user);
      setTransitBufferInput(res.user.transitBufferMinutes ?? clamped);
      setTransitSavedMsg(`Transit buffer updated to ${res.user.transitBufferMinutes ?? clamped} min.`);
    } catch (err) {
      setTransitError(err instanceof Error ? err.message : 'Unable to save transit buffer.');
    } finally {
      setSavingTransit(false);
    }
  };

  const openUploadFor = (mod: UploadModule) => {
    setUploadTargetModule(mod);
    setActiveSection('uploads');
    setMobileMenuOpen(false);
  };

  const pendingApprovalsCount = useMemo(
    () => registrations.filter((r) => r.status === 'pending').length,
    [registrations]
  );

  // Native OS App Icon Badging (iOS Home Screen, Android Launcher, Windows/macOS Dock)
  useEffect(() => {
    const navWithBadge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (!navWithBadge.setAppBadge && !navWithBadge.clearAppBadge) return;

    const totalBadge =
      (user ? activePowerBoostCount + activeFacultyDelayCount : 0) +
      (user?.role === 'hod' ? pendingApprovalsCount : 0);

    if (totalBadge > 0) {
      navWithBadge.setAppBadge?.(totalBadge).catch(() => {});
    } else {
      navWithBadge.clearAppBadge?.().catch(() => {});
    }
  }, [user, activePowerBoostCount, activeFacultyDelayCount, pendingApprovalsCount]);

  // Desktop App Keyboard Navigation (Alt+1..4)
  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '1') {
        e.preventDefault();
        setActiveSection(user.role === 'class_advisor' ? 'advisor_class' : 'overview');
      } else if (e.key === '2') {
        e.preventDefault();
        setActiveSection('communities');
      } else if (e.key === '3') {
        e.preventDefault();
        setActiveSection('attendance');
      } else if (e.key === '4') {
        e.preventDefault();
        setActiveSection('timetable');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  const navItems: NavItem[] = useMemo(() => {
    if (!user) return [];

    if (user.role === 'hod') {
      return [
        { id: 'overview', label: 'HOD Overview', icon: LayoutDashboard },
        { id: 'communities', label: 'Communities & Chat', icon: MessageSquare },
        { id: 'attendance', label: 'Camera Attendance', icon: Camera },
        { id: 'od_leave', label: 'OD & Leave Permission', icon: FileCheck2 },
        {
          id: 'approvals',
          label: 'Approvals & Emails',
          icon: CheckSquare,
          badgeCount: pendingApprovalsCount,
        },
        { id: 'students', label: 'Department Students', icon: GraduationCap },
        { id: 'dept_staff', label: 'Department Staff', icon: Users },
        { id: 'other_staff', label: 'Other Dept Staff', icon: Building2 },
        { id: 'advisor_class', label: 'Class Reps & Rosters', icon: UserCheck },
        { id: 'timetable', label: 'Server-Time Timetable', icon: CalendarClock },
        { id: 'uploads', label: 'Upload & Manual Entry', icon: FileUp },
      ];
    }

    if (user.role === 'class_advisor') {
      return [
        { id: 'advisor_class', label: 'Students & Class Reps', icon: UserCheck },
        { id: 'communities', label: 'Communities & Chat', icon: MessageSquare },
        { id: 'attendance', label: 'Camera Attendance', icon: Camera },
        { id: 'od_leave', label: 'OD & Leave Permission', icon: FileCheck2 },
        { id: 'timetable', label: 'Server-Time Timetable', icon: CalendarClock },
        { id: 'uploads', label: 'Upload & Manual Entry', icon: FileUp },
        { id: 'dept_staff', label: 'Department Staff', icon: Users },
        { id: 'other_staff', label: 'Other Dept Staff', icon: Building2 },
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
      ];
    }

    if (user.role === 'dept_staff' || user.role === 'other_dept_staff') {
      return [
        { id: 'overview', label: 'Faculty Overview', icon: LayoutDashboard },
        { id: 'communities', label: 'Communities & Chat', icon: MessageSquare },
        { id: 'attendance', label: 'Camera Attendance', icon: Camera },
        { id: 'od_leave', label: 'OD & Leave Permission', icon: FileCheck2 },
        { id: 'timetable', label: 'Server-Time Timetable', icon: CalendarClock },
        { id: 'students', label: 'Department Students', icon: GraduationCap },
        { id: 'dept_staff', label: 'Department Staff', icon: Users },
        { id: 'other_staff', label: 'Other Dept Staff', icon: Building2 },
      ];
    }

    // Student & Class Representative
    return [
      { id: 'overview', label: 'Student Overview', icon: LayoutDashboard },
      { id: 'communities', label: 'Communities & Chat', icon: MessageSquare },
      { id: 'attendance', label: 'Camera Attendance', icon: Camera },
      { id: 'od_leave', label: 'OD & Leave Permission', icon: FileCheck2 },
      { id: 'students', label: 'Department Students', icon: GraduationCap },
      { id: 'advisor_class', label: 'Class Reps & Roster', icon: UserCheck },
      { id: 'timetable', label: 'Class Timetable', icon: CalendarClock },
      { id: 'uploads', label: 'Upload & Manual Entry', icon: FileUp },
      { id: 'dept_staff', label: 'Department Faculty', icon: Users },
      { id: 'other_staff', label: 'Other Dept Faculty', icon: Building2 },
    ];
  }, [user, pendingApprovalsCount]);

  if (!token || !user) {
    return (
      <>
        {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
        <AuthPortal
          serverTime={serverTime}
          displayTime={displayTime}
          onAuthenticated={handleAuthenticated}
        />
      </>
    );
  }

  const sectionTitleMap: Record<NavSection, string> = {
    overview: user.role === 'hod' ? 'HOD Overview' : 'Academic Overview',
    communities: 'Department Communities & Live Messaging',
    attendance: 'Daily Dual-Camera Timetable Attendance',
    od_leave: 'OD & Leave Permission Portal',
    approvals: 'Registration Approvals & Email Intimations',
    students: 'Department Students Directory',
    dept_staff: 'Department Staff Directory',
    other_staff: 'Other Department Staff Directory',
    advisor_class: 'Students & Class Representatives',
    timetable: 'Timetable & Server-Time Availability',
    uploads: 'Document Upload & Manual Record Entry',
    profile: 'My Profile, Face Lock & HOD Delegation',
  };

  const canUpload =
    user.role === 'hod' ||
    user.role === 'class_advisor' ||
    user.role === 'student' ||
    user.role === 'class_rep';
  const mobileHomeSection: NavSection =
    user.role === 'class_advisor' ? 'advisor_class' : 'overview';
  const mobileBottomTabs: { id: NavSection; label: string; icon: typeof LayoutDashboard }[] = [
    {
      id: mobileHomeSection,
      label: user.role === 'class_advisor' ? 'Roster' : 'Home',
      icon: user.role === 'class_advisor' ? UserCheck : LayoutDashboard,
    },
    { id: 'communities', label: 'Chat', icon: MessageSquare },
    { id: 'attendance', label: 'Attend', icon: Camera },
    { id: 'timetable', label: 'Schedule', icon: CalendarClock },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <button
            type="button"
            onClick={() => setShowSplash(true)}
            title="Replay Academia-ESEC intro animation"
            aria-label="Replay Academia-ESEC intro animation"
            className="text-left hover:opacity-90 transition-opacity focus:outline-none"
          >
            <ChromaGradeMark size="md" showSubline />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Workspace navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors text-left ${
                  active
                    ? 'bg-indigo-50 text-indigo-900'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      active ? 'text-indigo-700' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span className="font-mono text-xs tabular-nums font-semibold text-amber-700 shrink-0">
                    {item.badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2.5">
          <button
            type="button"
            onClick={() => setActiveSection('profile')}
            className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors ${
              activeSection === 'profile'
                ? 'bg-indigo-50 border-indigo-300'
                : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {user.profileImageData ? (
              <img
                src={user.profileImageData}
                alt={user.fullName}
                className="w-10 h-10 rounded-xl object-cover border border-indigo-200 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-indigo-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                {user.fullName
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() || '')
                  .join('')}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-xs font-semibold text-slate-900 truncate">
                  {user.fullName}
                </span>
                {user.faceRegisteredLocked && (
                  <span title="Face photo locked" className="inline-flex shrink-0">
                    <Lock className="w-3 h-3 text-emerald-600" />
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {ROLE_LABELS[user.role]}
              </div>
              <div className="text-[10px] font-medium text-indigo-700">
                View / Edit Profile
              </div>
            </div>
          </button>
          <PWAInstallButton variant="sidebar" />
          <button
            type="button"
            onClick={handleOpenTransitSettings}
            className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 min-h-[38px] text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              Transit Buffer
            </span>
            <span className="font-mono tabular-nums text-slate-500">
              {user.transitBufferMinutes ?? 15}m
            </span>
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white flex flex-col border-r border-slate-200">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <ChromaGradeMark size="sm" showSubline />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-slate-500 hover:text-slate-900"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-sm font-medium rounded-lg ${
                      active
                        ? 'bg-indigo-50 text-indigo-900'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {item.badgeCount !== undefined && item.badgeCount > 0 && (
                      <span className="font-mono text-xs tabular-nums font-semibold text-amber-700">
                        {item.badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2.5 pb-safe">
              <button
                type="button"
                onClick={() => {
                  setActiveSection('profile');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition-colors ${
                  activeSection === 'profile'
                    ? 'bg-indigo-50 border-indigo-300'
                    : 'bg-slate-50/70 border-slate-200'
                }`}
              >
                {user.profileImageData ? (
                  <img
                    src={user.profileImageData}
                    alt={user.fullName}
                    className="w-10 h-10 rounded-xl object-cover border border-indigo-200 shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-indigo-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {user.fullName
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0]?.toUpperCase() || '')
                      .join('')}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-semibold text-slate-900 truncate">
                      {user.fullName}
                    </span>
                    {user.faceRegisteredLocked && (
                      <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {ROLE_LABELS[user.role]}
                  </div>
                  <div className="text-[10px] font-medium text-indigo-700">
                    Tap for Profile & Name Edit
                  </div>
                </div>
              </button>
              <PWAInstallButton variant="sidebar" />
              <button
                type="button"
                onClick={handleOpenTransitSettings}
                className="w-full inline-flex items-center justify-between gap-2 px-3 py-2.5 min-h-[44px] text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                  Transit Buffer
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  {user.transitBufferMinutes ?? 15}m
                </span>
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Sticky Top Bar (compact on mobile for iOS/Android safe-area, spacious on desktop) */}
        <header className="sticky top-0 z-30 pt-safe bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-8 shrink-0">
          <div className="h-14 lg:h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg"
                aria-label="Open navigation"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSplash(true)}
                title="Replay Academia-ESEC intro animation"
                aria-label="Academia-ESEC logo"
                className="lg:hidden shrink-0 hover:opacity-90 transition-opacity focus:outline-none"
              >
                <ChromaGradeMark size="sm" showWordmark={false} />
              </button>
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="text-slate-500 hidden sm:inline truncate">
                  {user.department}
                </span>
                <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                  /
                </span>
                <h1 className="font-semibold text-slate-900 truncate">
                  {sectionTitleMap[activeSection]}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                <span>{displayTime}</span>
                <span className="text-slate-300" aria-hidden="true">
                  ·
                </span>
                <span>{serverTime?.academicTimezone ?? 'Server'}</span>
              </div>

              <WorkspaceNotificationCenter
                token={token}
                user={user}
                activeSection={activeSection}
                onOpenChat={(groupId) => {
                  if (groupId) setTargetChatGroupId(groupId);
                  setCommunityInitialSubTab('chat');
                  setActiveSection('communities');
                }}
                onOpenTimetable={() => setActiveSection('timetable')}
                onOpenOdLeave={() => setActiveSection('od_leave')}
                onOpenAttendance={() => setActiveSection('attendance')}
                onOpenOverview={() => setActiveSection('overview')}
                onFacultyDelayCountChange={setActiveFacultyDelayCount}
                onDelegationChanged={() => {
                  if (token) {
                    api
                      .getMyProfile(token)
                      .then((res) => {
                        setUser(res.user);
                        loadWorkspaceData(token, res.user);
                      })
                      .catch(() => null);
                  }
                }}
              />

              <PWAInstallButton compact />

              {canUpload && activeSection !== 'uploads' && (
                <button
                  type="button"
                  onClick={() => setActiveSection('uploads')}
                  className="px-3 sm:px-3.5 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Upload
                  <span className="hidden sm:inline"> Document</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Global Power Boost Repeating Reminder Bar (Active Across All Tabs) */}
        <PowerBoostAlertBar
          token={token}
          user={user}
          refreshSignal={powerBoostRefreshSignal}
          onOpenChat={(groupId) => {
            if (groupId) setTargetChatGroupId(groupId);
            setCommunityInitialSubTab('chat');
            setActiveSection('communities');
          }}
          onAcknowledged={() => setPowerBoostRefreshSignal((n) => n + 1)}
          onActiveCountChange={setActivePowerBoostCount}
        />

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-8 pb-24 lg:pb-8 pl-safe pr-safe max-w-[1440px] w-full mx-auto">
          {dataLoading && students.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500">
              Loading ChromaGrade department records...
            </div>
          ) : (
            <>
              {activeSection === 'overview' && (
                <OverviewView
                  token={token}
                  user={user}
                  students={students}
                  deptStaff={deptStaff}
                  otherStaff={otherStaff}
                  slots={slots}
                  registrations={registrations}
                  intimations={intimations}
                  batches={batches}
                  serverTime={serverTime}
                  displayTime={displayTime}
                  onNavigate={setActiveSection}
                  onRefreshData={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'communities' && (
                <WhatsAppCommunityView
                  token={token}
                  user={user}
                  students={students}
                  deptStaff={deptStaff}
                  otherStaff={otherStaff}
                  initialGroupId={targetChatGroupId}
                  initialSubTab={communityInitialSubTab}
                  incomingShare={incomingShare}
                  onClearIncomingShare={() => setIncomingShare(null)}
                  onPowerBoostChanged={() => setPowerBoostRefreshSignal((n) => n + 1)}
                />
              )}

              {activeSection === 'attendance' && (
                <CameraAttendanceView
                  token={token}
                  user={user}
                  students={students}
                  deptStaff={deptStaff}
                  serverTime={serverTime}
                  displayTime={displayTime}
                />
              )}

              {activeSection === 'od_leave' && (
                <OdLeaveView
                  token={token}
                  user={user}
                  serverTime={serverTime}
                  onAttendanceUpdated={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'approvals' && user.role === 'hod' && (
                <ApprovalsView
                  token={token}
                  registrations={registrations}
                  intimations={intimations}
                  onRefresh={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'students' && (
                <DepartmentStudentsView
                  token={token}
                  defaultDepartment={user.department}
                  students={students}
                  canUpload={canUpload}
                  onOpenUpload={openUploadFor}
                  onRecordAdded={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'dept_staff' && (
                <DepartmentStaffView
                  token={token}
                  defaultDepartment={user.department}
                  staff={deptStaff}
                  canUpload={user.role === 'hod'}
                  onOpenUpload={openUploadFor}
                  onRecordAdded={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'other_staff' && (
                <OtherDepartmentStaffView
                  token={token}
                  defaultDepartment={user.department}
                  staff={otherStaff}
                  canUpload={user.role === 'hod'}
                  onOpenUpload={openUploadFor}
                  onRecordAdded={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'advisor_class' && (
                <ClassAdvisorView
                  token={token}
                  user={user}
                  students={students}
                  onOpenUpload={openUploadFor}
                  onRecordAdded={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'timetable' && (
                <TimetableView
                  token={token}
                  user={user}
                  slots={slots}
                  deptStaff={deptStaff}
                  otherStaff={otherStaff}
                  serverTime={serverTime}
                  displayTime={displayTime}
                  onRefreshServerTime={refreshServerTime}
                  onNavigateUpload={canUpload ? () => openUploadFor('timetable') : undefined}
                  onRecordAdded={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'uploads' && canUpload && (
                <DocumentUploadView
                  token={token}
                  user={user}
                  initialModule={uploadTargetModule}
                  batches={batches}
                  onImportCommitted={() => loadWorkspaceData(token, user)}
                />
              )}

              {activeSection === 'profile' && (
                <ProfileView
                  user={user}
                  token={token}
                  onUserUpdated={(updated) => {
                    setUser(updated);
                    loadWorkspaceData(token, updated);
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Android & iOS Mobile Bottom Tab Navigation */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-5 items-center h-15 px-1">
          {mobileBottomTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
                  active ? 'text-indigo-700' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium tracking-tight leading-none">
                  {tab.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg text-slate-500 hover:text-slate-900 transition-colors relative"
          >
            <Menu className="w-5 h-5 shrink-0" />
            <span className="text-[10px] font-medium tracking-tight leading-none">More</span>
            {user.role === 'hod' && pendingApprovalsCount > 0 && (
              <span className="absolute top-1.5 right-3 font-mono text-[10px] font-semibold text-amber-700 tabular-nums">
                {pendingApprovalsCount}
              </span>
            )}
          </button>
        </div>
      </nav>

      {transitSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label="Transit Buffer Profile Settings"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Faculty Transit Buffer Settings
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically extends your busy window between consecutive sessions in different rooms
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTransitSettingsOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Close transit buffer settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTransitSettings} className="p-6 space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <label htmlFor="transit-buffer-range" className="font-medium text-slate-800">
                    Transit Buffer Duration
                  </label>
                  <span className="font-mono font-semibold tabular-nums text-indigo-700">
                    {transitBufferInput} minutes
                  </span>
                </div>
                <input
                  id="transit-buffer-range"
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={transitBufferInput}
                  onChange={(e) => setTransitBufferInput(Number(e.target.value))}
                  className="w-full accent-indigo-700"
                />
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                  <span>0 min</span>
                  <span>15 min (default)</span>
                  <span>60 min</span>
                </div>
              </div>

              <div>
                <label htmlFor="transit-buffer-number" className="block text-xs text-slate-600 mb-1">
                  Exact Minutes (0–60)
                </label>
                <input
                  id="transit-buffer-number"
                  type="number"
                  min={0}
                  max={60}
                  value={transitBufferInput}
                  onChange={(e) => setTransitBufferInput(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
                />
              </div>

              {transitError && <div className="text-xs text-rose-700">{transitError}</div>}
              {transitSavedMsg && (
                <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {transitSavedMsg}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransitSettingsOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={savingTransit}
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 rounded-lg"
                >
                  {savingTransit ? 'Saving...' : 'Save Buffer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ExportConfirmationToast />
      <OfflineIndicator />
    </div>
  );
}
