import { useState } from 'react';
import { ArrowRight, Camera, CheckCircle2, MessageSquare, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import {
  MODULE_LABELS,
  ROLE_LABELS,
  type DeduplicateReport,
  type DepartmentStaff,
  type DepartmentStudent,
  type EmailIntimation,
  type OtherDepartmentStaff,
  type ServerTimePayload,
  type TimetableSlot,
  type UploadBatch,
  type UserProfile,
} from '../types';
import { AcademicCalendarCard } from './AcademicCalendarCard';
import { AcademicGoalTrackerCard } from './AcademicGoalTrackerCard';
import { BatchComparisonRadarCard } from './BatchComparisonRadarCard';
import { ChromaGradeMark } from './ChromaGradeMark';
import { DailyArchivalCard } from './DailyArchivalCard';
import { DepartmentalPerformanceChart } from './DepartmentalPerformanceChart';
import { MonthlyAttendanceChart } from './MonthlyAttendanceChart';
import { StudentAchievementCard } from './StudentAchievementCard';
import { TopPerformersAndStudyBuddySection } from './TopPerformersAndStudyBuddySection';

export type NavSection =
  | 'overview'
  | 'approvals'
  | 'od_leave'
  | 'students'
  | 'dept_staff'
  | 'other_staff'
  | 'advisor_class'
  | 'timetable'
  | 'attendance'
  | 'communities'
  | 'uploads'
  | 'profile';

interface OverviewViewProps {
  token: string;
  user: UserProfile;
  students: DepartmentStudent[];
  deptStaff: DepartmentStaff[];
  otherStaff: OtherDepartmentStaff[];
  slots: TimetableSlot[];
  registrations: UserProfile[];
  intimations: EmailIntimation[];
  batches: UploadBatch[];
  serverTime: ServerTimePayload | null;
  displayTime: string;
  onNavigate: (section: NavSection) => void;
  onRefreshData: () => Promise<void>;
}

export function OverviewView({
  token,
  user,
  students,
  deptStaff,
  otherStaff,
  slots,
  registrations,
  intimations,
  batches,
  serverTime,
  displayTime,
  onNavigate,
  onRefreshData,
}: OverviewViewProps) {
  const [dedupRunning, setDedupRunning] = useState(false);
  const [dedupReport, setDedupReport] = useState<DeduplicateReport | null>(null);
  const [dedupError, setDedupError] = useState<string | null>(null);

  const pendingCount = registrations.filter((r) => r.status === 'pending').length;
  const crCount = students.filter((s) => s.isClassRep).length;

  const mySlotsToday = serverTime
    ? slots.filter((s) => {
        if (s.dayOfWeek !== serverTime.weekday) return false;
        if (user.role === 'dept_staff' || user.role === 'other_dept_staff') {
          return s.facultyName.toLowerCase().includes(user.fullName.toLowerCase());
        }
        if (user.yearOfStudy && user.section) {
          return s.yearOfStudy === user.yearOfStudy && s.section === user.section;
        }
        return true;
      })
    : [];

  const handleRunDeduplicate = async () => {
    setDedupRunning(true);
    setDedupError(null);
    try {
      const report = await api.runDeduplicate(token);
      setDedupReport(report);
      await onRefreshData();
    } catch (err) {
      setDedupError(err instanceof Error ? err.message : 'Unable to verify records right now.');
    } finally {
      setDedupRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header summary strip */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <ChromaGradeMark size="md" showWordmark={false} />
            <div>
              <div className="text-xs text-slate-500">
                {ROLE_LABELS[user.role]} · {user.department}
                {user.yearOfStudy ? ` · ${user.yearOfStudy} Sec ${user.section}` : ''}
              </div>
              <h2 className="text-xl font-semibold text-slate-900 mt-0.5">
                Welcome, {user.fullName}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 lg:text-right">
            <div>
              <div className="text-xs text-slate-500">
                Server Time ({serverTime?.academicTimezone ?? 'Syncing'})
              </div>
              <div className="font-mono text-xl font-semibold tabular-nums text-slate-900">
                {displayTime}
              </div>
            </div>
            <div className="h-8 w-px bg-slate-200 hidden sm:block" aria-hidden="true" />
            <div>
              <div className="text-xs text-slate-500">Live Schedule Status</div>
              <div className="text-sm font-medium text-slate-900">
                {serverTime?.activePeriod
                  ? `${serverTime.activePeriod.label} (${serverTime.activePeriod.startTime}–${serverTime.activePeriod.endTime})`
                  : serverTime?.nextPeriod
                  ? `Next: ${serverTime.nextPeriod.label} at ${serverTime.nextPeriod.startTime}`
                  : serverTime?.formattedDate ?? 'Synchronizing'}
              </div>
            </div>
          </div>
        </div>
        {user.delegationInfo && user.delegationInfo.status === 'active' && (
          <div className="mt-4 pt-3 border-t border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 bg-amber-50/70 px-3 py-2 rounded-lg">
            <span>
              <strong>HOD Leave Delegation Active:</strong> {user.delegationInfo.delegateName} is currently serving as Acting HOD (on behalf of {user.delegationInfo.originalHodName}).
            </span>
            <button
              type="button"
              onClick={() => onNavigate('profile')}
              className="font-semibold text-amber-800 underline hover:text-amber-950"
            >
              Manage in Profile
            </button>
          </div>
        )}
      </section>

      {/* Primary Live Workspace Modules Strip: Dual-Camera Attendance & Communities */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('attendance')}
          className="text-left bg-white border border-slate-200 hover:border-indigo-300 rounded-lg p-5 transition-colors flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                Dual-Camera Timetable Attendance
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Capture live face and classroom/work environment photos synced to today’s server-time schedule.
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('communities')}
          className="text-left bg-white border border-slate-200 hover:border-emerald-300 rounded-lg p-5 transition-colors flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900">
                Department Communities & Live Chat
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Real-time community channels, class groups, announcements, and community management.
              </p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
        </button>
      </section>

      {/* 4-column flat KPI strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs text-slate-500">Department Students</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {students.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {crCount} Class Representatives designated
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs text-slate-500">Department Staff</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {deptStaff.length}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {deptStaff.filter((s) => s.isClassAdvisor).length} Class Advisors assigned
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs text-slate-500">Other Department Staff</div>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {otherStaff.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Inter-departmental & visiting faculty
          </div>
        </div>

        {user.role === 'hod' ? (
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Pending HOD Approvals</div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {pendingCount}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {intimations.length} approval emails dispatched
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="text-xs text-slate-500">Timetable Slots Loaded</div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {slots.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 tabular-nums">
              {batches.length} document import batches
            </div>
          </div>
        )}
      </section>

      {/* Monthly Department Attendance Trends (Recharts) */}
      <MonthlyAttendanceChart
        token={token}
        serverTime={serverTime}
        onOpenAttendance={() => onNavigate('attendance')}
      />

      {/* Departmental Performance: Average Attendance vs. Academic Engagement across Student Batches (Recharts) */}
      <DepartmentalPerformanceChart
        token={token}
        refreshKey={students.length + batches.length}
        onOpenAttendance={() => onNavigate('attendance')}
        onOpenStudents={() => onNavigate(user.role === 'hod' || user.role === 'dept_staff' || user.role === 'other_dept_staff' ? 'students' : 'advisor_class')}
      />

      {/* Academic Goal Tracker & Daily Nudge Progress */}
      <AcademicGoalTrackerCard
        token={token}
        user={user}
        refreshKey={students.length + batches.length}
      />

      {/* Student Achievement Badges & Batch Filter */}
      <StudentAchievementCard
        token={token}
        refreshKey={students.length + batches.length}
      />

      {/* Side-by-Side Batch Comparison Radar, Predictive Risk, Trends Projection & Bulk PDF Export */}
      <BatchComparisonRadarCard
        token={token}
        refreshKey={students.length + batches.length}
      />

      {/* Top Performers Leaderboard & Study Buddy Complementary Pairings */}
      <TopPerformersAndStudyBuddySection
        token={token}
        refreshKey={students.length + batches.length}
      />

      {/* Academic Calendar View */}
      <AcademicCalendarCard
        token={token}
        user={user}
        todayIsoDate={serverTime?.isoDate}
      />

      {/* Automated Daily Archival & Backup Logs (HOD / Class Advisor) */}
      <DailyArchivalCard token={token} user={user} />

      {/* HOD Record Integrity & Duplicate Cleanup Bar */}
      {user.role === 'hod' && (
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                Record Integrity & Duplicate Protection
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                All student rosters, staff directories, timetable slots, and daily attendance entries enforce unique identifiers. Run an on-demand sweep anytime to clean legacy duplicates.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunDeduplicate}
              disabled={dedupRunning}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-700" />
              {dedupRunning ? 'Verifying Records...' : 'Remove Duplicates'}
            </button>
          </div>

          {dedupReport && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex items-start gap-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">{dedupReport.message}</div>
                <div className="text-slate-600 mt-0.5 font-mono tabular-nums">
                  Students: {dedupReport.studentsCleaned} · Dept Staff: {dedupReport.deptStaffCleaned} · Other Staff: {dedupReport.otherStaffCleaned} · Timetable: {dedupReport.timetableCleaned} · Attendance: {dedupReport.attendanceCleaned}
                </div>
              </div>
            </div>
          )}

          {dedupError && (
            <div className="mt-3 text-xs text-rose-700">{dedupError}</div>
          )}
        </section>
      )}

      {/* Actionable two-column summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left: Role-specific quick modules */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              {user.role === 'hod'
                ? 'Department Modules & Governance'
                : 'Today’s Server-Time Schedule'}
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('timetable')}
              className="text-xs font-medium text-indigo-700 hover:text-indigo-900 inline-flex items-center gap-1 whitespace-nowrap"
            >
              Open Timetable
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {user.role === 'hod' ? (
            <div className="divide-y divide-slate-200">
              <button
                type="button"
                onClick={() => onNavigate('approvals')}
                className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Registration Approvals & Email Intimations
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {pendingCount} pending request{pendingCount === 1 ? '' : 's'} · Approving dispatches email intimation for credential sign-in
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('students')}
                className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Department Students & Class Representatives
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {students.length} students arranged by year, section, and CR assignment
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('dept_staff')}
                className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Department Staff Directory (Home Department)
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {deptStaff.length} faculty members including assigned Class Advisors
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('other_staff')}
                className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Other Department Staff Directory (Separate Listing)
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {otherStaff.length} visiting / allied faculty from Mathematics, ECE, Physics, Humanities
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('uploads')}
                className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors flex items-center justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    Document Upload & Manual Custom Entry (Excel / PDF / Word / Form)
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Upload structured spreadsheets or documents, or manually add custom records directly
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 flex-1">
              {mySlotsToday.slice(0, 6).map((slot) => {
                const isLive =
                  serverTime?.activePeriod?.periodNumber === slot.periodNumber &&
                  serverTime?.weekday === slot.dayOfWeek;
                return (
                  <div
                    key={slot.id}
                    className={`px-6 py-3.5 flex items-center justify-between gap-4 ${
                      isLive ? 'bg-indigo-50/60' : ''
                    }`}
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {slot.subjectCode} — {slot.subjectName}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {slot.yearOfStudy} Sec {slot.section} · {slot.facultyName} · Room {slot.roomNo}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-xs tabular-nums text-slate-800">
                        P{slot.periodNumber} · {slot.startTime}–{slot.endTime}
                      </div>
                      {isLive && (
                        <div className="text-[11px] font-medium text-indigo-700">
                          In Session Now
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {mySlotsToday.length === 0 && (
                <div className="p-8 text-center text-xs text-slate-500">
                  No scheduled sessions listed for {serverTime?.weekday ?? 'today'} in your current scope. View the full weekly timetable grid for all days.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right: Recent Document Imports */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Document Imports
            </h3>
            {(user.role === 'hod' || user.role === 'class_advisor') && (
              <button
                type="button"
                onClick={() => onNavigate('uploads')}
                className="text-xs font-medium text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
              >
                Upload Document
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-200 flex-1">
            {batches.slice(0, 5).map((b) => (
              <div key={b.id} className="px-6 py-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 truncate">
                    {b.originalFilename}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {MODULE_LABELS[b.targetModule]} · .{b.fileType.toUpperCase()} · {b.uploadedByName}
                  </div>
                </div>
                <div className="font-mono text-xs tabular-nums text-emerald-700 shrink-0">
                  +{b.recordsInserted}
                  {b.recordsUpdated > 0 ? ` / ${b.recordsUpdated} upd` : ''}
                </div>
              </div>
            ))}
            {batches.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500">
                No documents imported yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
