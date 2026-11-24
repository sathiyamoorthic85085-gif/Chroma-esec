import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Camera,
  CheckSquare,
  FileUp,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
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
import { OfflineIndicator } from './components/OfflineIndicator';
import { OverviewView, type NavSection } from './components/OverviewView';
import { PowerBoostAlertBar } from './components/PowerBoostAlertBar';
import { PWAInstallButton } from './components/PWAInstallButton';
import { TimetableView } from './components/TimetableView';
import { WhatsAppCommunityView } from './components/WhatsAppCommunityView';
import { useServerTime } from './hooks/useServerTime';
import { api } from './lib/api';
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

  // Incoming PWA Web Share Target payload (e.g., Instagram Reel / website shared to ChromaGrade)
  const [incomingShare, setIncomingShare] = useState<SharedContentPayload | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const title = params.get('share_title')?.trim() ?? '';
    const text = params.get('share_text')?.trim() ?? '';
    const rawUrl = params.get('share_url')?.trim() ?? '';
    // Some Android apps place the URL inside share_text instead of share_url
    const extractedUrl =
      rawUrl || (text.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? '');
    if (!title && !text && !extractedUrl) return null;
    window.history.replaceState({}, '', window.location.pathname);
    return { title, text, url: extractedUrl };
  });
  const [targetChatGroupId, setTargetChatGroupId] = useState<number | null>(null);
  const [powerBoostRefreshSignal, setPowerBoostRefreshSignal] = useState(0);

  // Academic dataset state
  const [students, setStudents] = useState<DepartmentStudent[]>([]);
  const [deptStaff, setDeptStaff] = useState<DepartmentStaff[]>([]);
  const [otherStaff, setOtherStaff] = useState<OtherDepartmentStaff[]>([]);
  const [slots, setSlots] = useState<TimetableSlot[]>([]);
  const [batches, setBatches] = useState<UploadBatch[]>([]);
  const [registrations, setRegistrations] = useState<UserProfile[]>([]);
  const [intimations, setIntimations] = useState<EmailIntimation[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

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

  const handleAuthenticated = (newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    if (incomingShare) {
      setActiveSection('communities');
    } else if (newUser.role === 'class_advisor') {
      setActiveSection('advisor_class');
    } else {
      setActiveSection('overview');
    }
  };

  const handleSignOut = async () => {
    if (token) {
      await api.logout(token).catch(() => {});
    }
    setToken(null);
    setUser(null);
    setActiveSection('overview');
    setMobileMenuOpen(false);
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

  const navItems: NavItem[] = useMemo(() => {
    if (!user) return [];

    if (user.role === 'hod') {
      return [
        { id: 'overview', label: 'HOD Overview', icon: LayoutDashboard },
        { id: 'communities', label: 'Communities & Chat', icon: MessageSquare },
        { id: 'attendance', label: 'Camera Attendance', icon: Camera },
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
      { id: 'timetable', label: 'Class Timetable', icon: CalendarClock },
      { id: 'advisor_class', label: 'Class Reps & Roster', icon: UserCheck },
      { id: 'dept_staff', label: 'Department Faculty', icon: Users },
      { id: 'other_staff', label: 'Other Dept Faculty', icon: Building2 },
    ];
  }, [user, pendingApprovalsCount]);

  if (!token || !user) {
    return (
      <AuthPortal
        serverTime={serverTime}
        displayTime={displayTime}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const sectionTitleMap: Record<NavSection, string> = {
    overview: user.role === 'hod' ? 'HOD Overview' : 'Academic Overview',
    communities: 'Department Communities & Live Messaging',
    attendance: 'Daily Dual-Camera Timetable Attendance',
    approvals: 'Registration Approvals & Email Intimations',
    students: 'Department Students Directory',
    dept_staff: 'Department Staff Directory',
    other_staff: 'Other Department Staff Directory',
    advisor_class: 'Students & Class Representatives',
    timetable: 'Timetable & Server-Time Availability',
    uploads: 'Document Upload & Manual Record Entry',
  };

  const canUpload = user.role === 'hod' || user.role === 'class_advisor';
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
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <ChromaGradeMark size="md" />
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
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {user.fullName}
            </div>
            <div className="text-xs text-slate-500 truncate">
              {ROLE_LABELS[user.role]}
            </div>
          </div>
          <PWAInstallButton variant="sidebar" />
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
              <ChromaGradeMark size="sm" />
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
              <div className="min-w-0 pb-1">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {user.fullName}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {ROLE_LABELS[user.role]}
                </div>
              </div>
              <PWAInstallButton variant="sidebar" />
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

              <div className="lg:hidden">
                <PWAInstallButton compact />
              </div>

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
            setActiveSection('communities');
          }}
          onAcknowledged={() => setPowerBoostRefreshSignal((n) => n + 1)}
        />

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-8 pb-24 lg:pb-8 max-w-[1440px] w-full mx-auto">
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

      <OfflineIndicator />
    </div>
  );
}
