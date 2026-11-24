import { useMemo, useState } from 'react';
import { Calendar, Clock, PenLine, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type {
  DepartmentStaff,
  OtherDepartmentStaff,
  ServerTimePayload,
  TimetableSlot,
  UserProfile,
} from '../types';
import { ManualRecordForm } from './ManualRecordForm';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

const PERIOD_WINDOWS = [
  { num: 1, time: '08:45–09:35' },
  { num: 2, time: '09:35–10:25' },
  { num: 3, time: '10:40–11:30' },
  { num: 4, time: '11:30–12:20' },
  { num: 5, time: '13:15–14:05' },
  { num: 6, time: '14:05–14:55' },
  { num: 7, time: '15:05–15:55' },
  { num: 8, time: '15:55–16:45' },
];

interface TimetableViewProps {
  token: string;
  user: UserProfile;
  slots: TimetableSlot[];
  deptStaff: DepartmentStaff[];
  otherStaff: OtherDepartmentStaff[];
  serverTime: ServerTimePayload | null;
  displayTime: string;
  onRefreshServerTime: () => Promise<void>;
  onNavigateUpload?: () => void;
  onRecordAdded?: () => Promise<void>;
}

export function TimetableView({
  token,
  user,
  slots,
  deptStaff,
  otherStaff,
  serverTime,
  displayTime,
  onRefreshServerTime,
  onNavigateUpload,
  onRecordAdded,
}: TimetableViewProps) {
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    slots.forEach((s) => set.add(`${s.yearOfStudy}::${s.section}`));
    if (user.yearOfStudy && user.section) {
      set.add(`${user.yearOfStudy}::${user.section}`);
    }
    if (set.size === 0) set.add('III Year::A');
    return Array.from(set).sort();
  }, [slots, user.yearOfStudy, user.section]);

  const defaultClass =
    user.yearOfStudy && user.section && classOptions.includes(`${user.yearOfStudy}::${user.section}`)
      ? `${user.yearOfStudy}::${user.section}`
      : classOptions[0];

  const [selectedClass, setSelectedClass] = useState<string>(defaultClass);
  const [viewMode, setViewMode] = useState<'week' | 'availability'>('week');
  const [updatingTz, setUpdatingTz] = useState(false);
  const [tzMessage, setTzMessage] = useState<string | null>(null);
  const [showManualSlot, setShowManualSlot] = useState(false);

  const [selectedYear, selectedSection] = selectedClass.split('::');

  const classSlots = useMemo(
    () =>
      slots.filter(
        (s) => s.yearOfStudy === selectedYear && s.section === selectedSection
      ),
    [slots, selectedYear, selectedSection]
  );

  const slotLookup = useMemo(() => {
    const map = new Map<string, TimetableSlot>();
    classSlots.forEach((s) => {
      map.set(`${s.dayOfWeek}::${s.periodNumber}`, s);
    });
    return map;
  }, [classSlots]);

  const activeWeekday = serverTime?.weekday ?? '';
  const activePeriodNum = serverTime?.activePeriod?.periodNumber ?? null;

  // Live availability calculated strictly from authoritative server weekday & active period
  const liveAvailability = useMemo(() => {
    const activeSlotsNow =
      activeWeekday && activePeriodNum
        ? slots.filter(
            (s) => s.dayOfWeek === activeWeekday && s.periodNumber === activePeriodNum
          )
        : [];

    const busyByFaculty = new Map<string, TimetableSlot>();
    activeSlotsNow.forEach((s) => {
      busyByFaculty.set(s.facultyName.toLowerCase(), s);
    });

    const deptStatus = deptStaff.map((f) => ({
      id: f.employeeId,
      name: f.fullName,
      group: 'Department Staff',
      sublabel: f.designation,
      activeSlot: busyByFaculty.get(f.fullName.toLowerCase()) ?? null,
    }));

    const otherStatus = otherStaff.map((f) => ({
      id: f.employeeId,
      name: f.fullName,
      group: f.homeDepartment,
      sublabel: f.handlingSubject,
      activeSlot: busyByFaculty.get(f.fullName.toLowerCase()) ?? null,
    }));

    return {
      activeSlotsNow,
      allFaculty: [...deptStatus, ...otherStatus],
    };
  }, [slots, deptStaff, otherStaff, activeWeekday, activePeriodNum]);

  const handleTimezoneChange = async (nextTz: string) => {
    if (user.role !== 'hod') return;
    setUpdatingTz(true);
    setTzMessage(null);
    try {
      await api.updateSettings(token, { academicTimezone: nextTz });
      await onRefreshServerTime();
      setTzMessage(`Server timetable clock updated to ${nextTz}.`);
    } catch {
      setTzMessage('Failed to update academic timezone.');
    } finally {
      setUpdatingTz(false);
    }
  };

  const scheduleStateLabel = (() => {
    if (!serverTime) return 'Syncing server clock';
    if (serverTime.scheduleState === 'in_session' && serverTime.activePeriod) {
      return `${serverTime.activePeriod.label} in session · ${serverTime.activePeriod.minutesRemaining} min remaining`;
    }
    if (serverTime.scheduleState === 'break' && serverTime.nextPeriod) {
      return `Recess interval · Next: ${serverTime.nextPeriod.label} at ${serverTime.nextPeriod.startTime}`;
    }
    if (serverTime.scheduleState === 'before_hours' && serverTime.nextPeriod) {
      return `Before academic hours · ${serverTime.nextPeriod.label} starts at ${serverTime.nextPeriod.startTime}`;
    }
    if (serverTime.scheduleState === 'after_hours') {
      return 'Academic hours concluded for today';
    }
    return 'Sunday · Non-instructional day';
  })();

  return (
    <div className="space-y-6">
      {/* Server-Time Authoritative Availability Banner */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Server-Time Availability</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {serverTime?.academicTimezone ?? 'Loading'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Synced from server clock</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {displayTime}
              </span>
              <span className="text-sm font-medium text-slate-700">
                {serverTime?.formattedDate ?? 'Synchronizing...'}
              </span>
              <span
                className={`text-xs font-medium ${
                  serverTime?.scheduleState === 'in_session'
                    ? 'text-emerald-700'
                    : 'text-slate-600'
                }`}
              >
                {scheduleStateLabel}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {user.role === 'hod' && serverTime && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span className="whitespace-nowrap">Academic Zone</span>
                <select
                  value={serverTime.academicTimezone}
                  disabled={updatingTz}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => onRefreshServerTime()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-sync Server Time
            </button>
          </div>
        </div>
        {tzMessage && (
          <p className="mt-3 text-xs text-indigo-700 font-medium">{tzMessage}</p>
        )}
      </section>

      {/* Toolbar: Class selector + View toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'week'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Weekly Timetable Grid
            </button>
            <button
              type="button"
              onClick={() => setViewMode('availability')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'availability'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Live Faculty Availability
            </button>
          </div>

          {viewMode === 'week' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Class</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-900"
              >
                {classOptions.map((opt) => {
                  const [yr, sec] = opt.split('::');
                  return (
                    <option key={opt} value={opt}>
                      {yr} — Section {sec}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {(user.role === 'hod' || user.role === 'class_advisor') && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowManualSlot((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <PenLine className="w-3.5 h-3.5" />
              {showManualSlot ? 'Hide Custom Slot' : 'Add Custom Slot'}
            </button>
            {onNavigateUpload && (
              <button
                type="button"
                onClick={onNavigateUpload}
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Upload Timetable Document
              </button>
            )}
          </div>
        )}
      </div>

      {(user.role === 'hod' || user.role === 'class_advisor') && showManualSlot && (
        <ManualRecordForm
          token={token}
          targetModule="timetable"
          defaultDepartment={user.department}
          onCommitted={onRecordAdded ?? onRefreshServerTime}
          onClose={() => setShowManualSlot(false)}
          compact
        />
      )}

      {/* Weekly Timetable Matrix */}
      {viewMode === 'week' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {classSlots.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-900">
                No timetable records imported for {selectedYear} — Section {selectedSection}
              </p>
              <p className="text-xs text-slate-500">
                Import an Excel, PDF, or Word timetable document from Document Upload to populate this schedule.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left min-w-[960px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="py-3 px-4 text-xs font-semibold text-slate-700 w-32">
                      Day
                    </th>
                    {PERIOD_WINDOWS.map((pw) => {
                      const isCurrentCol = activePeriodNum === pw.num;
                      return (
                        <th
                          key={pw.num}
                          className={`py-3 px-3 text-xs font-semibold border-l border-slate-200 ${
                            isCurrentCol ? 'bg-indigo-50/70 text-indigo-900' : 'text-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span>P{pw.num}</span>
                            {isCurrentCol && (
                              <span className="text-[11px] font-medium text-indigo-700">
                                Now
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] font-normal tabular-nums text-slate-500 mt-0.5">
                            {pw.time}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {WEEKDAYS.map((day) => {
                    const isToday = activeWeekday === day;
                    return (
                      <tr key={day} className={isToday ? 'bg-indigo-50/20' : 'bg-white'}>
                        <td className="py-3.5 px-4 align-top">
                          <div className="text-xs font-semibold text-slate-900">{day}</div>
                          {isToday && (
                            <div className="text-[11px] font-medium text-indigo-700 mt-0.5">
                              Server Today
                            </div>
                          )}
                        </td>
                        {PERIOD_WINDOWS.map((pw) => {
                          const slot = slotLookup.get(`${day}::${pw.num}`);
                          const isLiveSlot = isToday && activePeriodNum === pw.num;
                          return (
                            <td
                              key={pw.num}
                              className={`py-3 px-3 align-top border-l border-slate-200 ${
                                isLiveSlot
                                  ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-500'
                                  : ''
                              }`}
                            >
                              {slot ? (
                                <div className="space-y-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="font-mono text-[11px] font-semibold text-slate-900">
                                      {slot.subjectCode}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-500">
                                      {slot.roomNo}
                                    </span>
                                  </div>
                                  <div className="text-xs font-medium text-slate-800 leading-snug">
                                    {slot.subjectName}
                                  </div>
                                  <div className="text-[11px] text-slate-600 leading-snug">
                                    {slot.facultyName}
                                  </div>
                                  <div className="text-[11px] text-slate-500">
                                    {slot.facultyType === 'other_department'
                                      ? 'Other Dept'
                                      : 'Home Dept'}
                                    {isLiveSlot ? ' · In Session' : ''}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400">Free</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Live Faculty Availability Table */}
      {viewMode === 'availability' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Faculty Availability at Server Time ({displayTime})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {activePeriodNum
                  ? `Evaluated against ${activeWeekday}, Period ${activePeriodNum} (${serverTime?.activePeriod?.startTime}–${serverTime?.activePeriod?.endTime})`
                  : `No active class period right now (${scheduleStateLabel}). All faculty listed as available.`}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {liveAvailability.activeSlotsNow.length} in session ·{' '}
                {Math.max(
                  0,
                  liveAvailability.allFaculty.length - liveAvailability.activeSlotsNow.length
                )}{' '}
                available
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">ID</th>
                  <th className="py-3 px-4">Faculty Name</th>
                  <th className="py-3 px-4">Affiliation</th>
                  <th className="py-3 px-4">Server-Time Status</th>
                  <th className="py-3 px-4">Current Assignment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {liveAvailability.allFaculty.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600">
                      {f.id}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      <div>{f.name}</div>
                      <div className="text-xs text-slate-500 font-normal">{f.sublabel}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700">{f.group}</td>
                    <td className="py-3 px-4 text-xs font-medium">
                      {f.activeSlot ? (
                        <span className="text-amber-700">In Class (Occupied)</span>
                      ) : (
                        <span className="text-emerald-700">Available Now</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {f.activeSlot
                        ? `${f.activeSlot.yearOfStudy} ${f.activeSlot.section} · ${f.activeSlot.subjectCode} (${f.activeSlot.roomNo})`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
