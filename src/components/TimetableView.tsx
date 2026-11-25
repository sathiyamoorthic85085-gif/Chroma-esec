import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  LayoutGrid,
  List,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { notifyExportSaved } from '../lib/exportNotify';
import type {
  DepartmentStaff,
  OtherDepartmentStaff,
  ServerTimePayload,
  SessionOverlapWarning,
  TimetableSlot,
  UserProfile,
} from '../types';
import { FacultyDelayButton } from './FacultyDelayButton';
import { ManualRecordForm } from './ManualRecordForm';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAY_SHORT: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};
const WEEKDAY_ICS: Record<string, { byDay: string; offsetFromMon: number }> = {
  Monday: { byDay: 'MO', offsetFromMon: 0 },
  Tuesday: { byDay: 'TU', offsetFromMon: 1 },
  Wednesday: { byDay: 'WE', offsetFromMon: 2 },
  Thursday: { byDay: 'TH', offsetFromMon: 3 },
  Friday: { byDay: 'FR', offsetFromMon: 4 },
  Saturday: { byDay: 'SA', offsetFromMon: 5 },
};

const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'UTC',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

interface PeriodWindow {
  num: number;
  start: string;
  end: string;
  time: string;
  startMinutes: number;
  endMinutes: number;
  breakAfter?: { label: string; time: string };
}

const PERIOD_WINDOWS: PeriodWindow[] = [
  { num: 1, start: '08:45', end: '09:35', time: '08:45–09:35', startMinutes: 525, endMinutes: 575 },
  {
    num: 2,
    start: '09:35',
    end: '10:25',
    time: '09:35–10:25',
    startMinutes: 575,
    endMinutes: 625,
    breakAfter: { label: 'Morning Break', time: '10:25–10:40' },
  },
  { num: 3, start: '10:40', end: '11:30', time: '10:40–11:30', startMinutes: 640, endMinutes: 690 },
  {
    num: 4,
    start: '11:30',
    end: '12:20',
    time: '11:30–12:20',
    startMinutes: 690,
    endMinutes: 740,
    breakAfter: { label: 'Lunch Break', time: '12:20–13:15' },
  },
  { num: 5, start: '13:15', end: '14:05', time: '13:15–14:05', startMinutes: 795, endMinutes: 845 },
  {
    num: 6,
    start: '14:05',
    end: '14:55',
    time: '14:05–14:55',
    startMinutes: 845,
    endMinutes: 895,
    breakAfter: { label: 'Afternoon Break', time: '14:55–15:05' },
  },
  { num: 7, start: '15:05', end: '15:55', time: '15:05–15:55', startMinutes: 905, endMinutes: 955 },
  { num: 8, start: '15:55', end: '16:45', time: '15:55–16:45', startMinutes: 955, endMinutes: 1005 },
];

function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatIcsDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatIcsTime(hhmm: string): string {
  const [h = '08', m = '45'] = hhmm.split(':');
  return `${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
}

function buildIcsCalendar(slotsToExport: TimetableSlot[], calendarName: string): string {
  const now = new Date();
  // Find Monday of the current week
  const dayIdx = now.getDay(); // 0=Sun, 1=Mon
  const diffToMon = dayIdx === 0 ? 1 : 1 - dayIdx;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon);
  const dtStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChromaGrade//Academic Timetable//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  slotsToExport.forEach((slot) => {
    const info = WEEKDAY_ICS[slot.dayOfWeek];
    if (!info) return;
    const eventDate = new Date(monday);
    eventDate.setDate(monday.getDate() + info.offsetFromMon);
    const dateStr = formatIcsDate(eventDate);
    const uid = `chromagrade-slot-${slot.id}-${slot.dayOfWeek.toLowerCase()}-p${slot.periodNumber}@esec.ac.in`;
    const summary = `${slot.subjectCode} — ${slot.subjectName}`;
    const desc = [
      `Faculty: ${slot.facultyName} (${slot.facultyType === 'other_department' ? 'Other Dept' : 'Home Dept'})`,
      `Class: ${slot.yearOfStudy} — Section ${slot.section}`,
      `Period: P${slot.periodNumber} (${slot.startTime}–${slot.endTime})`,
      slot.roomNo ? `Room: ${slot.roomNo}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dateStr}T${formatIcsTime(slot.startTime)}`,
      `DTEND:${dateStr}T${formatIcsTime(slot.endTime)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${info.byDay}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(desc)}`,
      slot.roomNo ? `LOCATION:${escapeIcsText(slot.roomNo)}` : 'LOCATION:Department Classroom',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface SlotDraft {
  id: number | null;
  yearOfStudy: string;
  section: string;
  dayOfWeek: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  subjectCode: string;
  subjectName: string;
  facultyName: string;
  facultyType: 'department' | 'other_department';
  roomNo: string;
}

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
  const canManageSchedule = user.role === 'hod' || user.role === 'class_advisor';

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
  const [viewMode, setViewMode] = useState<'daily' | 'week' | 'availability'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'daily' : 'week'
  );

  const activeWeekday = serverTime?.weekday ?? '';
  const activePeriodNum = serverTime?.activePeriod?.periodNumber ?? null;
  const serverMinutes = serverTime?.minutesSinceMidnight ?? null;

  const initialDay = (WEEKDAYS as readonly string[]).includes(activeWeekday)
    ? activeWeekday
    : 'Monday';
  const [selectedDay, setSelectedDay] = useState<string>(initialDay);
  const [dayUserOverridden, setDayUserOverridden] = useState(false);

  // Sync selectedDay to authoritative server weekday until the user picks another day manually
  useEffect(() => {
    if (!dayUserOverridden && (WEEKDAYS as readonly string[]).includes(activeWeekday)) {
      setSelectedDay(activeWeekday);
    }
  }, [activeWeekday, dayUserOverridden]);

  // Keep selectedClass valid if classOptions changes after import
  useEffect(() => {
    if (!classOptions.includes(selectedClass) && classOptions.length > 0) {
      setSelectedClass(classOptions[0]);
    }
  }, [classOptions, selectedClass]);

  // Search & filter controls
  const [searchQuery, setSearchQuery] = useState('');
  const [facultyFilter, setFacultyFilter] = useState<'all' | 'department' | 'other_department'>('all');
  const [showFreePeriods, setShowFreePeriods] = useState(true);

  // Live availability filter controls
  const [availSearch, setAvailSearch] = useState('');
  const [availStatusFilter, setAvailStatusFilter] = useState<'all' | 'available' | 'busy'>('all');

  // Timezone & feedback controls
  const [updatingTz, setUpdatingTz] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showManualSlot, setShowManualSlot] = useState(false);

  // Interactive Slot Detail / Quick Editor modal state
  const [modalSlot, setModalSlot] = useState<TimetableSlot | null>(null);
  const [editorDraft, setEditorDraft] = useState<SlotDraft | null>(null);
  const [isEditingModal, setIsEditingModal] = useState(false);
  const [savingSlot, setSavingSlot] = useState(false);
  const [deletingSlot, setDeletingSlot] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [copiedSlotId, setCopiedSlotId] = useState<number | null>(null);

  const [selectedYear, selectedSection] = selectedClass.split('::');

  const classSlots = useMemo(
    () =>
      slots.filter(
        (s) => s.yearOfStudy === selectedYear && s.section === selectedSection
      ),
    [slots, selectedYear, selectedSection]
  );

  const matchesFilters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (slot: TimetableSlot) => {
      if (facultyFilter !== 'all' && slot.facultyType !== facultyFilter) {
        return false;
      }
      if (!q) return true;
      return (
        slot.subjectCode.toLowerCase().includes(q) ||
        slot.subjectName.toLowerCase().includes(q) ||
        slot.facultyName.toLowerCase().includes(q) ||
        slot.roomNo.toLowerCase().includes(q)
      );
    };
  }, [searchQuery, facultyFilter]);

  const filteredClassSlots = useMemo(
    () => classSlots.filter(matchesFilters),
    [classSlots, matchesFilters]
  );

  const slotLookup = useMemo(() => {
    const map = new Map<string, TimetableSlot>();
    classSlots.forEach((s) => {
      map.set(`${s.dayOfWeek}::${s.periodNumber}`, s);
    });
    return map;
  }, [classSlots]);

  const daySlotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    WEEKDAYS.forEach((d) => {
      counts[d] = 0;
    });
    filteredClassSlots.forEach((s) => {
      if (counts[s.dayOfWeek] !== undefined) {
        counts[s.dayOfWeek] += 1;
      }
    });
    return counts;
  }, [filteredClassSlots]);

  // All known faculty names for quick autocomplete inside editor modal
  const facultySuggestions = useMemo(() => {
    const map = new Map<string, 'department' | 'other_department'>();
    deptStaff.forEach((f) => map.set(f.fullName, 'department'));
    otherStaff.forEach((f) => map.set(f.fullName, 'other_department'));
    slots.forEach((s) => {
      if (!map.has(s.facultyName)) map.set(s.facultyName, s.facultyType);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [deptStaff, otherStaff, slots]);

  const transitBufferMinutes = user.transitBufferMinutes ?? 15;

  // Session Overlap warnings: consecutive periods in different locations where gap < transitBufferMinutes
  const sessionOverlapWarnings = useMemo<SessionOverlapWarning[]>(() => {
    const warnings: SessionOverlapWarning[] = [];
    const byDayFaculty = new Map<string, TimetableSlot[]>();
    slots.forEach((s) => {
      if (!s.facultyName.trim()) return;
      const key = `${s.dayOfWeek}::${s.facultyName.trim().toLowerCase()}`;
      const list = byDayFaculty.get(key) ?? [];
      list.push(s);
      byDayFaculty.set(key, list);
    });

    byDayFaculty.forEach((list) => {
      const sorted = [...list].sort((a, b) => a.periodNumber - b.periodNumber);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const roomA = a.roomNo.trim();
        const roomB = b.roomNo.trim();
        if (!roomA || !roomB || roomA.toLowerCase() === roomB.toLowerCase()) continue;
        const endA = parseHHMM(a.endTime);
        const startB = parseHHMM(b.startTime);
        if (endA === null || startB === null) continue;
        const gapMinutes = startB - endA;
        if (gapMinutes < transitBufferMinutes) {
          warnings.push({
            facultyName: a.facultyName,
            periodA: a.periodNumber,
            roomA,
            endTimeA: a.endTime,
            periodB: b.periodNumber,
            roomB,
            startTimeB: b.startTime,
            gapMinutes,
            requiredTransitMinutes: transitBufferMinutes,
            dayOfWeek: a.dayOfWeek,
            yearOfStudy: b.yearOfStudy,
            section: b.section,
          });
        }
      }
    });

    return warnings;
  }, [slots, transitBufferMinutes]);

  // Live availability calculated from authoritative server weekday, active period & transit buffer windows
  const liveAvailability = useMemo(() => {
    const todayFacultySlots = activeWeekday
      ? slots.filter((s) => s.dayOfWeek === activeWeekday)
      : [];

    const activeSlotsNow = activePeriodNum
      ? todayFacultySlots.filter((s) => s.periodNumber === activePeriodNum)
      : [];

    const busyByFaculty = new Map<string, TimetableSlot>();
    activeSlotsNow.forEach((s) => {
      busyByFaculty.set(s.facultyName.toLowerCase(), s);
    });

    // Extended transit buffer window when faculty has sessions in multiple rooms on the same day
    const transitBusyByFaculty = new Map<string, TimetableSlot>();
    if (serverMinutes !== null && activeWeekday) {
      const roomsByFaculty = new Map<string, Set<string>>();
      todayFacultySlots.forEach((s) => {
        const key = s.facultyName.toLowerCase();
        const set = roomsByFaculty.get(key) ?? new Set<string>();
        if (s.roomNo.trim()) set.add(s.roomNo.trim().toLowerCase());
        roomsByFaculty.set(key, set);
      });

      todayFacultySlots.forEach((s) => {
        const key = s.facultyName.toLowerCase();
        if (busyByFaculty.has(key)) return;
        const roomCount = roomsByFaculty.get(key)?.size ?? 0;
        if (roomCount <= 1 || transitBufferMinutes <= 0) return;
        const st = parseHHMM(s.startTime);
        const en = parseHHMM(s.endTime);
        if (st === null || en === null) return;
        if (
          serverMinutes >= st - transitBufferMinutes &&
          serverMinutes <= en + transitBufferMinutes
        ) {
          transitBusyByFaculty.set(key, s);
        }
      });
    }

    const deptStatus = deptStaff.map((f) => {
      const activeSlot = busyByFaculty.get(f.fullName.toLowerCase()) ?? null;
      const transitSlot = transitBusyByFaculty.get(f.fullName.toLowerCase()) ?? null;
      return {
        id: f.employeeId,
        name: f.fullName,
        group: 'Department Staff',
        sublabel: f.designation,
        activeSlot,
        transitSlot,
      };
    });

    const otherStatus = otherStaff.map((f) => {
      const activeSlot = busyByFaculty.get(f.fullName.toLowerCase()) ?? null;
      const transitSlot = transitBusyByFaculty.get(f.fullName.toLowerCase()) ?? null;
      return {
        id: f.employeeId,
        name: f.fullName,
        group: f.homeDepartment,
        sublabel: f.handlingSubject,
        activeSlot,
        transitSlot,
      };
    });

    const allFaculty = [...deptStatus, ...otherStatus];
    const q = availSearch.trim().toLowerCase();
    const filteredFaculty = allFaculty.filter((f) => {
      const isBusy = Boolean(f.activeSlot || f.transitSlot);
      if (availStatusFilter === 'available' && isBusy) return false;
      if (availStatusFilter === 'busy' && !isBusy) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q) ||
        f.sublabel.toLowerCase().includes(q) ||
        (f.activeSlot?.subjectCode.toLowerCase().includes(q) ?? false) ||
        (f.activeSlot?.roomNo.toLowerCase().includes(q) ?? false) ||
        (f.transitSlot?.subjectCode.toLowerCase().includes(q) ?? false)
      );
    });

    const busyOrTransitCount = allFaculty.filter((f) => f.activeSlot || f.transitSlot).length;

    return {
      activeSlotsNow,
      busyOrTransitCount,
      allFaculty,
      filteredFaculty,
    };
  }, [
    slots,
    deptStaff,
    otherStaff,
    activeWeekday,
    activePeriodNum,
    serverMinutes,
    transitBufferMinutes,
    availSearch,
    availStatusFilter,
  ]);

  const handleTimezoneChange = async (nextTz: string) => {
    if (user.role !== 'hod') return;
    setUpdatingTz(true);
    setFeedbackMsg(null);
    try {
      await api.updateSettings(token, { academicTimezone: nextTz });
      await onRefreshServerTime();
      setFeedbackMsg({ type: 'ok', text: `Server timetable clock updated to ${nextTz}.` });
    } catch {
      setFeedbackMsg({ type: 'err', text: 'Failed to update academic timezone.' });
    } finally {
      setUpdatingTz(false);
    }
  };

  const handleSelectDay = (day: string) => {
    setSelectedDay(day);
    setDayUserOverridden(true);
  };

  const handleStepDay = (delta: -1 | 1) => {
    const idx = WEEKDAYS.indexOf(selectedDay as (typeof WEEKDAYS)[number]);
    const nextIdx = (idx + delta + WEEKDAYS.length) % WEEKDAYS.length;
    handleSelectDay(WEEKDAYS[nextIdx]);
  };

  const handleJumpToday = () => {
    if ((WEEKDAYS as readonly string[]).includes(activeWeekday)) {
      setSelectedDay(activeWeekday);
      setDayUserOverridden(false);
    } else {
      setSelectedDay('Monday');
      setDayUserOverridden(true);
    }
  };

  const openSlotDetail = (slot: TimetableSlot) => {
    setModalSlot(slot);
    setEditorDraft({
      id: slot.id,
      yearOfStudy: slot.yearOfStudy,
      section: slot.section,
      dayOfWeek: slot.dayOfWeek,
      periodNumber: slot.periodNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subjectCode: slot.subjectCode,
      subjectName: slot.subjectName,
      facultyName: slot.facultyName,
      facultyType: slot.facultyType,
      roomNo: slot.roomNo,
    });
    setIsEditingModal(false);
    setModalError(null);
  };

  const openQuickCreate = (dayOfWeek: string, periodNumber: number) => {
    if (!canManageSchedule) return;
    const pw = PERIOD_WINDOWS.find((p) => p.num === periodNumber) ?? PERIOD_WINDOWS[0];
    setModalSlot(null);
    setEditorDraft({
      id: null,
      yearOfStudy: selectedYear,
      section: selectedSection,
      dayOfWeek,
      periodNumber: pw.num,
      startTime: pw.start,
      endTime: pw.end,
      subjectCode: '',
      subjectName: '',
      facultyName: '',
      facultyType: 'department',
      roomNo: '',
    });
    setIsEditingModal(true);
    setModalError(null);
  };

  const closeModal = () => {
    setModalSlot(null);
    setEditorDraft(null);
    setIsEditingModal(false);
    setModalError(null);
  };

  const handleSaveDraft = async (e: FormEvent) => {
    e.preventDefault();
    if (!editorDraft) return;
    setModalError(null);

    if (
      !editorDraft.subjectCode.trim() ||
      !editorDraft.subjectName.trim() ||
      !editorDraft.facultyName.trim()
    ) {
      setModalError('Subject code, subject name, and faculty name are required.');
      return;
    }

    setSavingSlot(true);
    try {
      const payload = {
        department: user.department,
        yearOfStudy: editorDraft.yearOfStudy,
        section: editorDraft.section,
        dayOfWeek: editorDraft.dayOfWeek,
        periodNumber: editorDraft.periodNumber,
        startTime: editorDraft.startTime,
        endTime: editorDraft.endTime,
        subjectCode: editorDraft.subjectCode.trim().toUpperCase(),
        subjectName: editorDraft.subjectName.trim(),
        facultyName: editorDraft.facultyName.trim(),
        facultyType: editorDraft.facultyType,
        roomNo: editorDraft.roomNo.trim(),
      };

      if (editorDraft.id) {
        await api.updateTimetableSlot(token, editorDraft.id, payload);
        setFeedbackMsg({
          type: 'ok',
          text: `Updated ${payload.subjectCode} (${payload.dayOfWeek}, P${payload.periodNumber}).`,
        });
      } else {
        await api.saveTimetableSlot(token, payload);
        setFeedbackMsg({
          type: 'ok',
          text: `Added ${payload.subjectCode} to ${payload.dayOfWeek}, Period ${payload.periodNumber}.`,
        });
      }

      closeModal();
      if (onRecordAdded) {
        await onRecordAdded();
      } else {
        await onRefreshServerTime();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Unable to save timetable slot.');
    } finally {
      setSavingSlot(false);
    }
  };

  const handleDeleteSlot = async () => {
    if (!editorDraft?.id) return;
    setDeletingSlot(true);
    setModalError(null);
    try {
      await api.deleteTimetableSlot(token, editorDraft.id);
      setFeedbackMsg({
        type: 'ok',
        text: `Removed ${editorDraft.subjectCode} from ${editorDraft.dayOfWeek}, Period ${editorDraft.periodNumber}.`,
      });
      closeModal();
      if (onRecordAdded) {
        await onRecordAdded();
      } else {
        await onRefreshServerTime();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Unable to remove slot.');
    } finally {
      setDeletingSlot(false);
    }
  };

  const handleCopySlot = async (slot: TimetableSlot) => {
    const summary = `${slot.subjectCode} — ${slot.subjectName} | ${slot.dayOfWeek} P${slot.periodNumber} (${slot.startTime}–${slot.endTime}) | ${slot.facultyName} | Room ${slot.roomNo || 'TBA'} | ${slot.yearOfStudy} Sec ${slot.section}`;
    try {
      await navigator.clipboard.writeText(summary);
      setCopiedSlotId(slot.id);
      window.setTimeout(() => setCopiedSlotId(null), 2000);
    } catch {
      // Clipboard restricted
    }
  };

  const handleExportCsv = () => {
    const rowsToExport =
      viewMode === 'daily'
        ? filteredClassSlots.filter((s) => s.dayOfWeek === selectedDay)
        : filteredClassSlots;

    const header = [
      'Day',
      'Period',
      'Start Time',
      'End Time',
      'Subject Code',
      'Subject Name',
      'Faculty',
      'Affiliation',
      'Room',
      'Class',
    ];
    const sorted = [...rowsToExport].sort((a, b) => {
      const dayDiff = WEEKDAYS.indexOf(a.dayOfWeek as (typeof WEEKDAYS)[number]) - WEEKDAYS.indexOf(b.dayOfWeek as (typeof WEEKDAYS)[number]);
      return dayDiff !== 0 ? dayDiff : a.periodNumber - b.periodNumber;
    });

    const csvLines = [
      header.map(escapeCsvCell).join(','),
      ...sorted.map((s) =>
        [
          s.dayOfWeek,
          `P${s.periodNumber}`,
          s.startTime,
          s.endTime,
          s.subjectCode,
          s.subjectName,
          s.facultyName,
          s.facultyType === 'other_department' ? 'Other Dept' : 'Home Dept',
          s.roomNo,
          `${s.yearOfStudy} - ${s.section}`,
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
    ];

    const scopeSlug = viewMode === 'daily' ? selectedDay.toLowerCase() : 'weekly';
    const classSlug = `${selectedYear}_${selectedSection}`.replace(/\s+/g, '_');
    const filename = `ChromaGrade_Timetable_${classSlug}_${scopeSlug}.csv`;
    downloadTextFile(
      csvLines.join('\r\n'),
      filename,
      'text/csv;charset=utf-8'
    );
    notifyExportSaved(filename, 'CSV');
    setFeedbackMsg({
      type: 'ok',
      text: `Exported ${sorted.length} timetable ${sorted.length === 1 ? 'period' : 'periods'} to CSV.`,
    });
  };

  const handleExportIcs = (specificSlots?: TimetableSlot[], customSuffix?: string) => {
    const targetSlots =
      specificSlots ??
      (viewMode === 'daily'
        ? filteredClassSlots.filter((s) => s.dayOfWeek === selectedDay)
        : filteredClassSlots);

    if (targetSlots.length === 0) {
      setFeedbackMsg({ type: 'err', text: 'No scheduled periods to export for the current selection.' });
      return;
    }

    const calTitle = `${selectedYear} Sec ${selectedSection} Timetable`;
    const icsContent = buildIcsCalendar(targetSlots, calTitle);
    const classSlug = `${selectedYear}_${selectedSection}`.replace(/\s+/g, '_');
    const suffix = customSuffix ?? (viewMode === 'daily' ? selectedDay.toLowerCase() : 'weekly');
    const filename = `ChromaGrade_${classSlug}_${suffix}.ics`;
    downloadTextFile(
      icsContent,
      filename,
      'text/calendar;charset=utf-8'
    );
    notifyExportSaved(filename, 'Calendar (.ics)');
    setFeedbackMsg({
      type: 'ok',
      text: `Downloaded recurring calendar (.ics) for ${targetSlots.length} ${targetSlots.length === 1 ? 'period' : 'periods'}.`,
    });
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

  // Daily list computed metrics
  const isSelectedDayToday = activeWeekday === selectedDay;
  const dailyPeriods = useMemo(() => {
    const hasFilter = searchQuery.trim().length > 0 || facultyFilter !== 'all';
    return PERIOD_WINDOWS.map((pw) => {
      const slot = slotLookup.get(`${selectedDay}::${pw.num}`) ?? null;
      const matches = slot ? matchesFilters(slot) : !hasFilter;
      return { pw, slot, visible: slot ? matches : showFreePeriods && !hasFilter };
    });
  }, [selectedDay, slotLookup, matchesFilters, showFreePeriods, searchQuery, facultyFilter]);

  const dailySummary = useMemo(() => {
    let scheduled = 0;
    let homeDept = 0;
    let otherDept = 0;
    PERIOD_WINDOWS.forEach((pw) => {
      const s = slotLookup.get(`${selectedDay}::${pw.num}`);
      if (s) {
        scheduled += 1;
        if (s.facultyType === 'other_department') otherDept += 1;
        else homeDept += 1;
      }
    });
    return {
      scheduled,
      free: PERIOD_WINDOWS.length - scheduled,
      homeDept,
      otherDept,
    };
  }, [selectedDay, slotLookup]);

  const isFilteringSchedule = searchQuery.trim().length > 0 || facultyFilter !== 'all';

  return (
    <div className="space-y-5">
      {/* Server-Time Authoritative Availability Banner */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Server-Time Schedule</span>
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

          <div className="flex flex-wrap items-center gap-2.5">
            {user.role === 'hod' && serverTime && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <span className="whitespace-nowrap">Academic Zone</span>
                <select
                  value={serverTime.academicTimezone}
                  disabled={updatingTz}
                  onChange={(e) => handleTimezoneChange(e.target.value)}
                  className="px-2.5 py-2 min-h-[40px] text-xs font-mono border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
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
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Re-sync Time
            </button>
          </div>
        </div>
        {feedbackMsg && (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs">
            <span
              className={
                feedbackMsg.type === 'ok'
                  ? 'text-indigo-700 font-medium'
                  : 'text-rose-700 font-medium'
              }
            >
              {feedbackMsg.text}
            </span>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* Primary Toolbar: Daily List / Weekly Grid / Live Availability Toggle + Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* 3-Mode Segmented Control */}
          <div
            role="tablist"
            aria-label="Timetable view mode"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg max-w-full overflow-x-auto"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'daily'}
              onClick={() => setViewMode('daily')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'daily'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              Daily List
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'week'}
              onClick={() => setViewMode('week')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'week'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Weekly Grid
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'availability'}
              onClick={() => setViewMode('availability')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[36px] text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'availability'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Live Availability
            </button>
          </div>

          {viewMode !== 'availability' && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-slate-500 whitespace-nowrap">Class</span>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="px-3 py-2 min-h-[40px] text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
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
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FacultyDelayButton
            token={token}
            user={user}
            slots={slots}
            serverTime={serverTime}
            compact
          />

          {viewMode !== 'availability' && classSlots.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => handleExportIcs()}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <CalendarPlus className="w-3.5 h-3.5" />
                Export .ics
              </button>
            </>
          )}

          {canManageSchedule && (
            <>
              <button
                type="button"
                onClick={() => setShowManualSlot((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {showManualSlot ? 'Hide Batch Form' : 'Batch Add Slots'}
              </button>
              {onNavigateUpload && (
                <button
                  type="button"
                  onClick={onNavigateUpload}
                  className="px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Upload Timetable
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filter & Search Bar (for Daily List & Weekly Grid) */}
      {viewMode !== 'availability' && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by subject, code, faculty, or room..."
              aria-label="Filter timetable schedule"
              className="w-full pl-9 pr-8 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All Faculty' },
                  { id: 'department', label: 'Home Dept' },
                  { id: 'other_department', label: 'Other Dept' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFacultyFilter(item.id)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    facultyFilter === item.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {viewMode === 'daily' && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showFreePeriods}
                  onChange={(e) => setShowFreePeriods(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                />
                Show free periods
              </label>
            )}

            {isFilteringSchedule && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFacultyFilter('all');
                }}
                className="text-xs font-medium text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      )}

      {canManageSchedule && showManualSlot && (
        <ManualRecordForm
          token={token}
          targetModule="timetable"
          defaultDepartment={user.department}
          onCommitted={onRecordAdded ?? onRefreshServerTime}
          onClose={() => setShowManualSlot(false)}
          compact
        />
      )}

      {sessionOverlapWarnings.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Session Overlap &amp; Transit Buffer Alert ({sessionOverlapWarnings.length} multi-location transition{sessionOverlapWarnings.length === 1 ? '' : 's'} below {transitBufferMinutes} min)
              </span>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-amber-800">
              Profile Transit Buffer: {transitBufferMinutes} min
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sessionOverlapWarnings.slice(0, 4).map((w, idx) => (
              <div
                key={`${w.facultyName}-${w.dayOfWeek}-${w.periodA}-${idx}`}
                className="bg-white border border-amber-200 rounded-md px-3 py-2 text-xs text-slate-700"
              >
                <div className="font-medium text-slate-900">
                  {w.facultyName} · {w.dayOfWeek}
                </div>
                <div className="text-[11px] text-slate-600 font-mono tabular-nums mt-0.5">
                  P{w.periodA} ({w.roomA}, ends {w.endTimeA}) → P{w.periodB} ({w.roomB}, starts {w.startTimeB}) · Gap {w.gapMinutes}m
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ============================================================
          VIEW 1: DAILY LIST VIEW
          ============================================================ */}
      {viewMode === 'daily' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Weekday Selector Header */}
          <div className="px-4 sm:px-6 py-4 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStepDay(-1)}
                  aria-label="Previous weekday"
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">
                      {selectedDay}
                    </h2>
                    {isSelectedDayToday && (
                      <span className="text-xs font-medium text-indigo-700">
                        · Server Today
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 tabular-nums mt-0.5">
                    <span>{selectedYear} — Section {selectedSection}</span>
                    <span aria-hidden="true">·</span>
                    <span>{dailySummary.scheduled} scheduled</span>
                    <span aria-hidden="true">·</span>
                    <span>{dailySummary.free} free</span>
                    {dailySummary.otherDept > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{dailySummary.otherDept} visiting</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleStepDay(1)}
                  aria-label="Next weekday"
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {!isSelectedDayToday && (WEEKDAYS as readonly string[]).includes(activeWeekday) && (
                  <button
                    type="button"
                    onClick={handleJumpToday}
                    className="px-3 py-2 min-h-[40px] text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Jump to Today ({WEEKDAY_SHORT[activeWeekday]})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setViewMode('week')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Full Week
                </button>
              </div>
            </div>

            {/* 6-Day Selector Strip */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {WEEKDAYS.map((day) => {
                const active = selectedDay === day;
                const isToday = activeWeekday === day;
                const count = daySlotCounts[day] ?? 0;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => handleSelectDay(day)}
                    className={`min-h-[44px] px-3 py-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-indigo-700 text-white border-indigo-700'
                        : 'bg-slate-50/70 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold">{WEEKDAY_SHORT[day]}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          active ? 'text-indigo-100' : 'text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                    <div
                      className={`text-[11px] truncate mt-0.5 ${
                        active
                          ? 'text-indigo-100'
                          : isToday
                          ? 'text-indigo-700 font-medium'
                          : 'text-slate-500'
                      }`}
                    >
                      {isToday ? 'Today' : day}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chronological Daily Schedule List */}
          {dailyPeriods.every((item) => !item.visible) ? (
            <div className="p-10 text-center space-y-2">
              <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-900">
                {isFilteringSchedule
                  ? `No matching classes on ${selectedDay}`
                  : `No scheduled periods for ${selectedDay}`}
              </p>
              <p className="text-xs text-slate-500">
                {isFilteringSchedule
                  ? 'Clear your search query or faculty filter to view all periods.'
                  : canManageSchedule
                  ? 'Enable "Show free periods" or click Batch Add Slots to schedule classes.'
                  : 'Switch to another weekday or open the Weekly Grid view.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {dailyPeriods.map(({ pw, slot, visible }) => {
                if (!visible) return null;

                const isLive = isSelectedDayToday && activePeriodNum === pw.num;
                const isCompleted =
                  isSelectedDayToday && serverMinutes !== null && serverMinutes >= pw.endMinutes;
                const isUpNext =
                  isSelectedDayToday && serverTime?.nextPeriod?.periodNumber === pw.num;

                let progressPct = 0;
                if (isLive && serverMinutes !== null) {
                  const total = Math.max(1, pw.endMinutes - pw.startMinutes);
                  progressPct = Math.min(
                    100,
                    Math.max(4, Math.round(((serverMinutes - pw.startMinutes) / total) * 100))
                  );
                }

                const statusText = isLive
                  ? `In Session · ${serverTime?.activePeriod?.minutesRemaining ?? 0} min left`
                  : isUpNext
                  ? `Up Next · starts in ${serverTime?.nextPeriod?.startsInMinutes ?? 0} min`
                  : isCompleted
                  ? 'Completed'
                  : 'Scheduled';

                return (
                  <div key={pw.num}>
                    <div
                      className={`px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 transition-colors ${
                        isLive
                          ? 'bg-indigo-50/70'
                          : slot
                          ? 'bg-white hover:bg-slate-50/70'
                          : 'bg-slate-50/35'
                      }`}
                    >
                      {/* Time & Period Column */}
                      <div className="sm:w-36 shrink-0 flex sm:flex-col items-baseline sm:items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`font-mono text-sm font-semibold tabular-nums ${
                              isLive ? 'text-indigo-800' : 'text-slate-900'
                            }`}
                          >
                            P{pw.num}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-slate-600">
                            {slot ? `${slot.startTime}–${slot.endTime}` : pw.time}
                          </span>
                        </div>
                        {isSelectedDayToday && (
                          <span
                            className={`text-[11px] font-medium tabular-nums ${
                              isLive
                                ? 'text-emerald-700'
                                : isUpNext
                                ? 'text-indigo-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {statusText}
                          </span>
                        )}
                      </div>

                      {/* Subject & Faculty Content */}
                      {slot ? (
                        <button
                          type="button"
                          onClick={() => openSlotDetail(slot)}
                          className="flex-1 min-w-0 text-left space-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-md"
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                            <span className="font-mono text-xs font-semibold text-indigo-800">
                              {slot.subjectCode}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">
                              {slot.subjectName}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
                            <span className="font-medium text-slate-700">{slot.facultyName}</span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span>
                              {slot.facultyType === 'other_department'
                                ? 'Other Dept'
                                : 'Home Dept'}
                            </span>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="font-mono tabular-nums text-slate-700">
                              Room {slot.roomNo || 'TBA'}
                            </span>
                          </div>
                          {isLive && (
                            <div className="pt-1.5 max-w-xs">
                              <div className="h-1.5 w-full bg-indigo-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-700 transition-all"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </button>
                      ) : (
                        <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-medium text-slate-500">Free Period</div>
                            <div className="text-[11px] text-slate-400">
                              No class assigned to Period {pw.num}
                            </div>
                          </div>
                          {canManageSchedule && (
                            <button
                              type="button"
                              onClick={() => openQuickCreate(selectedDay, pw.num)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] text-xs font-medium text-indigo-700 border border-indigo-200 bg-white hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Assign Period
                            </button>
                          )}
                        </div>
                      )}

                      {/* Quick Row Actions for Occupied Slot */}
                      {slot && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openSlotDetail(slot)}
                            className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                          >
                            {canManageSchedule ? 'Details / Edit' : 'Details'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Recess / Lunch Divider */}
                    {pw.breakAfter && (
                      <div className="px-4 sm:px-6 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-medium">{pw.breakAfter.label}</span>
                        <span className="font-mono tabular-nums">{pw.breakAfter.time}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ============================================================
          VIEW 2: FULL WEEKLY GRID VIEW
          ============================================================ */}
      {viewMode === 'week' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 sm:px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
              <span className="font-semibold text-slate-900">
                {selectedYear} — Section {selectedSection}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {filteredClassSlots.length} of {classSlots.length} weekly periods shown
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-500">
                {canManageSchedule
                  ? 'Click any cell to edit or assign'
                  : 'Click any class cell for details or click a day to open Daily List'}
              </span>
            </div>
          </div>

          {classSlots.length === 0 && !canManageSchedule ? (
            <div className="p-10 text-center space-y-2">
              <Calendar className="w-6 h-6 text-slate-400 mx-auto" />
              <p className="text-sm font-medium text-slate-900">
                No timetable records imported for {selectedYear} — Section {selectedSection}
              </p>
              <p className="text-xs text-slate-500">
                Ask your HOD or Class Advisor to upload or add timetable periods for this section.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left min-w-[1000px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="sticky left-0 z-10 bg-slate-50 py-3 px-4 text-xs font-semibold text-slate-700 w-32 border-r border-slate-200">
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
                            <span className="font-mono tabular-nums">P{pw.num}</span>
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
                        <td
                          className={`sticky left-0 z-10 py-3.5 px-4 align-top border-r border-slate-200 ${
                            isToday ? 'bg-indigo-50/60' : 'bg-white'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              handleSelectDay(day);
                              setViewMode('daily');
                            }}
                            className="text-left group focus:outline-none"
                            title={`Open ${day} in Daily List View`}
                          >
                            <div className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors">
                              {day}
                            </div>
                            <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                              {isToday ? (
                                <span className="font-medium text-indigo-700">Server Today</span>
                              ) : (
                                `${daySlotCounts[day] ?? 0} periods`
                              )}
                            </div>
                          </button>
                        </td>
                        {PERIOD_WINDOWS.map((pw) => {
                          const slot = slotLookup.get(`${day}::${pw.num}`);
                          const isLiveSlot = isToday && activePeriodNum === pw.num;
                          const dimmed = Boolean(slot && isFilteringSchedule && !matchesFilters(slot));
                          return (
                            <td
                              key={pw.num}
                              className={`p-0 align-top border-l border-slate-200 ${
                                isLiveSlot
                                  ? 'bg-indigo-50 ring-1 ring-inset ring-indigo-500'
                                  : ''
                              }`}
                            >
                              {slot ? (
                                <button
                                  type="button"
                                  onClick={() => openSlotDetail(slot)}
                                  className={`w-full h-full min-h-[92px] py-3 px-3 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600 ${
                                    dimmed ? 'opacity-25' : ''
                                  }`}
                                >
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-mono text-[11px] font-semibold text-slate-900">
                                        {slot.subjectCode}
                                      </span>
                                      <span className="font-mono text-[11px] text-slate-500">
                                        {slot.roomNo}
                                      </span>
                                    </div>
                                    <div className="text-xs font-medium text-slate-800 leading-snug line-clamp-2">
                                      {slot.subjectName}
                                    </div>
                                    <div className="text-[11px] text-slate-600 leading-snug truncate">
                                      {slot.facultyName}
                                    </div>
                                    <div className="text-[11px] text-slate-500">
                                      {slot.facultyType === 'other_department'
                                        ? 'Other Dept'
                                        : 'Home Dept'}
                                      {isLiveSlot ? ' · Live' : ''}
                                    </div>
                                  </div>
                                </button>
                              ) : canManageSchedule ? (
                                <button
                                  type="button"
                                  onClick={() => openQuickCreate(day, pw.num)}
                                  className="w-full h-full min-h-[92px] py-3 px-3 text-left text-[11px] text-slate-400 hover:text-indigo-700 hover:bg-slate-50 transition-colors flex flex-col justify-between group"
                                  title={`Assign ${day} Period ${pw.num}`}
                                >
                                  <span>Free</span>
                                  <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 text-indigo-700 font-medium transition-opacity">
                                    <Plus className="w-3 h-3" />
                                    Assign
                                  </span>
                                </button>
                              ) : (
                                <div className="min-h-[92px] py-3 px-3 text-[11px] text-slate-400">
                                  Free
                                </div>
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
        </section>
      )}

      {/* ============================================================
          VIEW 3: LIVE FACULTY AVAILABILITY TABLE
          ============================================================ */}
      {viewMode === 'availability' && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
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
                  {liveAvailability.busyOrTransitCount} busy / in transit ({transitBufferMinutes}m buffer) ·{' '}
                  {Math.max(
                    0,
                    liveAvailability.allFaculty.length - liveAvailability.busyOrTransitCount
                  )}{' '}
                  available
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={availSearch}
                  onChange={(e) => setAvailSearch(e.target.value)}
                  placeholder="Search faculty, ID, department, or room..."
                  aria-label="Search faculty availability"
                  className="w-full pl-9 pr-3 py-2 min-h-[38px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                />
              </div>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'available', label: 'Available' },
                    { id: 'busy', label: 'In Class / Transit' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setAvailStatusFilter(item.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      availStatusFilter === item.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
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
                {liveAvailability.filteredFaculty.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-xs text-slate-500">
                      No faculty match the selected filter.
                    </td>
                  </tr>
                ) : (
                  liveAvailability.filteredFaculty.map((f) => (
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
                        ) : f.transitSlot ? (
                          <span className="text-indigo-700">
                            In Transit Buffer ({transitBufferMinutes}m)
                          </span>
                        ) : (
                          <span className="text-emerald-700">Available Now</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 font-mono tabular-nums">
                        {f.activeSlot
                          ? `${f.activeSlot.yearOfStudy} ${f.activeSlot.section} · ${f.activeSlot.subjectCode} (${f.activeSlot.roomNo || 'TBA'})`
                          : f.transitSlot
                          ? `Adjacent: ${f.transitSlot.subjectCode} (${f.transitSlot.roomNo || 'TBA'}, ${f.transitSlot.startTime}–${f.transitSlot.endTime})`
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ============================================================
          SLOT DETAIL & INLINE EDITOR MODAL
          ============================================================ */}
      {editorDraft && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="timetable-slot-modal-title"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl overflow-hidden pb-safe">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id="timetable-slot-modal-title"
                  className="text-sm font-semibold text-slate-900 truncate"
                >
                  {isEditingModal
                    ? editorDraft.id
                      ? 'Edit Timetable Period'
                      : 'Assign Timetable Period'
                    : `${modalSlot?.subjectCode} — ${modalSlot?.subjectName}`}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  {editorDraft.yearOfStudy} — Section {editorDraft.section} ·{' '}
                  {editorDraft.dayOfWeek} · P{editorDraft.periodNumber} ({editorDraft.startTime}–
                  {editorDraft.endTime})
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close period modal"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!isEditingModal && modalSlot ? (
              <div className="p-5 space-y-4">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div>
                    <dt className="text-slate-500">Subject Code</dt>
                    <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                      {modalSlot.subjectCode}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Room / Lab</dt>
                    <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                      {modalSlot.roomNo || 'TBA'}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Course Title</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">{modalSlot.subjectName}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Faculty</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">{modalSlot.facultyName}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Affiliation</dt>
                    <dd className="font-medium text-slate-900 mt-0.5">
                      {modalSlot.facultyType === 'other_department'
                        ? 'Other Department'
                        : 'Home Department'}
                    </dd>
                  </div>
                </dl>

                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopySlot(modalSlot)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {copiedSlotId === modalSlot.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Details
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleExportIcs([modalSlot], `${modalSlot.subjectCode}_p${modalSlot.periodNumber}`)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <CalendarPlus className="w-3.5 h-3.5" />
                      Save .ics
                    </button>
                  </div>

                  {canManageSchedule && (
                    <button
                      type="button"
                      onClick={() => setIsEditingModal(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <PenLine className="w-3.5 h-3.5" />
                      Edit Period
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveDraft} className="p-5 space-y-3.5">
                {modalError && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    {modalError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Day of Week</span>
                    <select
                      value={editorDraft.dayOfWeek}
                      onChange={(e) =>
                        setEditorDraft((prev) =>
                          prev ? { ...prev, dayOfWeek: e.target.value } : prev
                        )
                      }
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Period</span>
                    <select
                      value={editorDraft.periodNumber}
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        const pw = PERIOD_WINDOWS.find((p) => p.num === num);
                        setEditorDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                periodNumber: num,
                                startTime: pw?.start ?? prev.startTime,
                                endTime: pw?.end ?? prev.endTime,
                              }
                            : prev
                        );
                      }}
                      className="w-full px-3 py-2 min-h-[40px] text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-900"
                    >
                      {PERIOD_WINDOWS.map((pw) => (
                        <option key={pw.num} value={pw.num}>
                          P{pw.num} ({pw.time})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Subject Code</span>
                    <input
                      type="text"
                      required
                      value={editorDraft.subjectCode}
                      onChange={(e) =>
                        setEditorDraft((prev) =>
                          prev ? { ...prev, subjectCode: e.target.value } : prev
                        )
                      }
                      placeholder="e.g. EI3401"
                      className="w-full px-3 py-2 min-h-[40px] text-xs font-mono uppercase border border-slate-300 rounded-lg bg-white text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Room / Lab No.</span>
                    <input
                      type="text"
                      value={editorDraft.roomNo}
                      onChange={(e) =>
                        setEditorDraft((prev) =>
                          prev ? { ...prev, roomNo: e.target.value } : prev
                        )
                      }
                      placeholder="e.g. B-204"
                      className="w-full px-3 py-2 min-h-[40px] text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-900"
                    />
                  </label>

                  <label className="col-span-2 block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Subject Name</span>
                    <input
                      type="text"
                      required
                      value={editorDraft.subjectName}
                      onChange={(e) =>
                        setEditorDraft((prev) =>
                          prev ? { ...prev, subjectName: e.target.value } : prev
                        )
                      }
                      placeholder="e.g. Process Control & Instrumentation"
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Faculty Name</span>
                    <input
                      type="text"
                      required
                      list="timetable-faculty-list"
                      value={editorDraft.facultyName}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matched = facultySuggestions.find(
                          ([name]) => name.toLowerCase() === val.toLowerCase()
                        );
                        setEditorDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                facultyName: val,
                                facultyType: matched ? matched[1] : prev.facultyType,
                              }
                            : prev
                        );
                      }}
                      placeholder="Dr. A. Kumar"
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                    />
                    <datalist id="timetable-faculty-list">
                      {facultySuggestions.map(([name]) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Faculty Affiliation</span>
                    <select
                      value={editorDraft.facultyType}
                      onChange={(e) =>
                        setEditorDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                facultyType: e.target.value as 'department' | 'other_department',
                              }
                            : prev
                        )
                      }
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                    >
                      <option value="department">Home Department</option>
                      <option value="other_department">Other Department</option>
                    </select>
                  </label>
                </div>

                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  {editorDraft.id ? (
                    <button
                      type="button"
                      disabled={deletingSlot || savingSlot}
                      onClick={handleDeleteSlot}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-rose-700 border border-rose-200 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deletingSlot ? 'Removing...' : 'Remove Slot'}
                    </button>
                  ) : (
                    <span />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingSlot || deletingSlot}
                      className="px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      {savingSlot ? 'Saving...' : editorDraft.id ? 'Save Changes' : 'Save Period'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
