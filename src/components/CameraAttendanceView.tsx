import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Building,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  MapPin,
  Navigation,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  AttendancePersonType,
  AttendanceRecordItem,
  AttendanceRiskAlertItem,
  DepartmentStaff,
  DepartmentStudent,
  PinnedLocationConfig,
  ServerTimePayload,
  SessionOverlapWarning,
  StudentBiometricProfileSummary,
  TimetableSlot,
  UserProfile,
} from '../types';
import { FacultyDelayButton } from './FacultyDelayButton';
import { WeeklyAttendanceChart } from './WeeklyAttendanceChart';

function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

interface CameraAttendanceViewProps {
  token: string;
  user: UserProfile;
  students: DepartmentStudent[];
  deptStaff: DepartmentStaff[];
  serverTime: ServerTimePayload | null;
  displayTime: string;
}

export function CameraAttendanceView({
  token,
  user,
  students,
  deptStaff,
  serverTime,
  displayTime,
}: CameraAttendanceViewProps) {
  const [todaySlots, setTodaySlots] = useState<TimetableSlot[]>([]);
  const [allSlots, setAllSlots] = useState<TimetableSlot[]>([]);
  const [records, setRecords] = useState<AttendanceRecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Target selection
  const defaultPersonType: AttendancePersonType =
    user.role === 'student' || user.role === 'class_rep' ? 'student' : 'student';
  const [personType, setPersonType] = useState<AttendancePersonType>(defaultPersonType);
  const [selectedIdentifier, setSelectedIdentifier] = useState<string>('');
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);

  // Live camera stream state (STRICTLY live camera capture — no file uploads)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [captureStep, setCaptureStep] = useState<'face' | 'environment'>('face');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Strictly 2 live pictures: (1) face, (2) work environment
  const [faceImageData, setFaceImageData] = useState<string | null>(null);
  const [environmentImageData, setEnvironmentImageData] = useState<string | null>(null);

  // Verification & submission state
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastOutcome, setLastOutcome] = useState<{
    approved: boolean;
    summary: string;
    faceConfidence: number;
    environmentLabel: string;
    personName: string;
  } | null>(null);

  // Register filter, search bar, date selector & administrative export state
  const [registerFilter, setRegisterFilter] = useState<'all' | 'student' | 'faculty'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logDate, setLogDate] = useState<string>(serverTime?.isoDate ?? '');
  const [exportMonth, setExportMonth] = useState<string>(
    (serverTime?.isoDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7)
  );
  const [exportScope, setExportScope] = useState<'date' | 'month' | 'all_dates'>('date');
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'pdf' | 'xlsx' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [chartRefreshSignal, setChartRefreshSignal] = useState(0);

  // Real-time Attendance Alert (<75%), Low Attendance Risk Watch & Session Overlap state
  const [lowRiskStudents, setLowRiskStudents] = useState<AttendanceRiskAlertItem[]>([]);
  const [notifyingLowRisk, setNotifyingLowRisk] = useState(false);
  const [riskNotifyMsg, setRiskNotifyMsg] = useState<string | null>(null);
  const [liveSessionAlert, setLiveSessionAlert] = useState<{
    subjectCode: string;
    subjectName: string;
    yearOfStudy: string;
    section: string;
    periodNumber: number;
    presentCount: number;
    expectedCount: number;
    ratePct: number;
  } | null>(null);

  // HOD-Pinned Classroom Geofence & Biometric Baselines
  const [pinnedLocation, setPinnedLocation] = useState<PinnedLocationConfig | null>(null);
  const [biometricProfiles, setBiometricProfiles] = useState<StudentBiometricProfileSummary[]>([]);
  const [pinLabel, setPinLabel] = useState('Department Classroom Wing');
  const [pinLat, setPinLat] = useState('');
  const [pinLng, setPinLng] = useState('');
  const [pinRadius, setPinRadius] = useState('200');
  const [savingPin, setSavingPin] = useState(false);
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  // Live device GPS verification for classroom geofence
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    null
  );
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const loadGeofenceAndBaselines = useCallback(async () => {
    try {
      const [pinRes, bioRes] = await Promise.all([
        api.getPinnedLocation(token),
        api.getBiometricProfiles(token),
      ]);
      setPinnedLocation(pinRes.pinnedLocation);
      setPinLabel(pinRes.pinnedLocation.label || 'Department Classroom Wing');
      if (pinRes.pinnedLocation.latitude !== null) {
        setPinLat(String(pinRes.pinnedLocation.latitude));
      }
      if (pinRes.pinnedLocation.longitude !== null) {
        setPinLng(String(pinRes.pinnedLocation.longitude));
      }
      setPinRadius(String(pinRes.pinnedLocation.radiusMeters || 200));
      setBiometricProfiles(bioRes.profiles);
    } catch {
      // Handled gracefully
    }
  }, [token]);

  const loadTodayAttendance = useCallback(async () => {
    try {
      const res = await api.getTodayAttendance(token);
      setTodaySlots(res.todaySlots);
      setAllSlots(res.allSlots);

      const todayIso = res.serverTime.isoDate;
      setLogDate((prev) => prev || todayIso);
      setExportMonth((prev) => prev || todayIso.slice(0, 7));

      if (!logDate || logDate === todayIso) {
        setRecords(res.records);
      } else {
        const hist = await api.getAttendanceHistory(token, { date: logDate });
        setRecords(hist.records);
      }

      const slotsToPick = res.todaySlots.length > 0 ? res.todaySlots : res.allSlots;
      setSelectedSlotId((prev) => {
        if (prev && slotsToPick.some((s) => s.id === prev)) return prev;
        const activeMatch = res.serverTime.activePeriod
          ? slotsToPick.find(
              (s) => s.periodNumber === res.serverTime.activePeriod?.periodNumber
            )
          : null;
        return activeMatch?.id ?? slotsToPick[0]?.id ?? null;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load daily attendance.');
    } finally {
      setLoading(false);
    }
  }, [token, logDate]);

  const loadLowRiskWatch = useCallback(async () => {
    try {
      const res = await api.getAttendanceAlertsAndRisk(token);
      setLowRiskStudents(res.lowRiskStudents);
    } catch {
      // Handled gracefully
    }
  }, [token]);

  useEffect(() => {
    loadTodayAttendance();
    loadGeofenceAndBaselines();
    loadLowRiskWatch();
  }, [loadTodayAttendance, loadGeofenceAndBaselines, loadLowRiskWatch]);

  const requestCurrentGps = (alsoFillHodPin = false) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocation is not supported in this browser.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setGpsCoords({ lat, lng, accuracy: Math.round(pos.coords.accuracy || 0) });
        if (alsoFillHodPin) {
          setPinLat(String(lat));
          setPinLng(String(lng));
        }
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(
          err.message || 'Location access denied. Allow GPS permission to verify classroom location.'
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  };

  const handleSaveHodPin = async () => {
    if (user.role !== 'hod') return;
    const latNum = Number(pinLat);
    const lngNum = Number(pinLng);
    const radNum = Number(pinRadius) || 200;
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      setPinMessage('Click "Use My Current GPS" or enter valid latitude & longitude first.');
      return;
    }
    setSavingPin(true);
    setPinMessage(null);
    try {
      const res = await api.updatePinnedLocation(token, {
        label: pinLabel.trim() || 'Department Classroom Wing',
        latitude: latNum,
        longitude: lngNum,
        radiusMeters: radNum,
      });
      setPinnedLocation(res.pinnedLocation);
      setPinMessage(
        `Pinned "${res.pinnedLocation.label}" (${res.pinnedLocation.latitude}, ${res.pinnedLocation.longitude} · ${res.pinnedLocation.radiusMeters}m radius). Students must capture classroom environment photos inside this zone.`
      );
    } catch (err) {
      setPinMessage(err instanceof Error ? err.message : 'Unable to save pinned location.');
    } finally {
      setSavingPin(false);
    }
  };

  const gpsDistanceMeters = useMemo(() => {
    if (
      !gpsCoords ||
      !pinnedLocation?.configured ||
      pinnedLocation.latitude === null ||
      pinnedLocation.longitude === null
    ) {
      return null;
    }
    return haversineMeters(
      gpsCoords.lat,
      gpsCoords.lng,
      pinnedLocation.latitude,
      pinnedLocation.longitude
    );
  }, [gpsCoords, pinnedLocation]);

  const isInsidePinnedZone = useMemo(() => {
    if (!pinnedLocation?.configured) return true;
    if (gpsDistanceMeters === null) return false;
    return gpsDistanceMeters <= pinnedLocation.radiusMeters;
  }, [pinnedLocation, gpsDistanceMeters]);

  const selectedStudentBiometric = useMemo(() => {
    if (personType !== 'student' || !selectedIdentifier) return null;
    return (
      biometricProfiles.find(
        (b) => b.rollNo.toUpperCase() === selectedIdentifier.toUpperCase()
      ) ?? null
    );
  }, [personType, selectedIdentifier, biometricProfiles]);

  const handleDateChange = async (nextDate: string) => {
    setLogDate(nextDate);
    setExportFeedback(null);
    if (!nextDate) return;
    setLoading(true);
    try {
      const hist = await api.getAttendanceHistory(token, { date: nextDate });
      setRecords(hist.records);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load logs for selected date.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportLogs = async (format: 'csv' | 'pdf' | 'xlsx') => {
    setExportingFormat(format);
    setExportFeedback(null);
    setErrorMsg(null);
    const activeDate = logDate || serverTime?.isoDate || undefined;
    const activeMonth =
      exportMonth || (activeDate ? activeDate.slice(0, 7) : new Date().toISOString().slice(0, 7));
    const activePersonType = registerFilter === 'all' ? undefined : registerFilter;
    try {
      await api.exportAttendance(token, format, {
        date: exportScope === 'date' ? activeDate : undefined,
        month: exportScope === 'month' ? activeMonth : undefined,
        personType: activePersonType,
        scope: exportScope,
      });
      const scopeLabel =
        exportScope === 'month'
          ? `monthly summary (${activeMonth})`
          : exportScope === 'all_dates'
          ? 'all recorded dates (archive)'
          : activeDate ?? 'today';
      const formatLabel = format === 'xlsx' ? 'Excel (.xlsx)' : format.toUpperCase();
      setExportFeedback(
        `Exported ${formatLabel} attendance register for ${scopeLabel}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Unable to export ${format.toUpperCase()} file.`);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleDispatchLowRiskNotifications = async () => {
    setNotifyingLowRisk(true);
    setRiskNotifyMsg(null);
    try {
      const res = await api.notifyLowRiskStudents(token);
      setLowRiskStudents(res.lowRiskStudents);
      setRiskNotifyMsg(
        res.notifiedCount > 0
          ? `Sent proactive push notifications to ${res.notifiedCount} at-risk student(s) and their Class Advisors.`
          : 'All students with <75% cumulative attendance have already been notified today.'
      );
    } catch (err) {
      setRiskNotifyMsg(
        err instanceof Error ? err.message : 'Unable to dispatch low-attendance notifications.'
      );
    } finally {
      setNotifyingLowRisk(false);
    }
  };

  // Keep selected person in sync when switching between Student & Faculty mode
  useEffect(() => {
    if (personType === 'student') {
      const selfMatch = students.find(
        (s) =>
          s.rollNo.toLowerCase() === user.staffOrRollId.toLowerCase() ||
          s.email.toLowerCase() === user.email.toLowerCase()
      );
      setSelectedIdentifier(selfMatch?.rollNo ?? students[0]?.rollNo ?? '');
    } else {
      const selfMatch = deptStaff.find(
        (f) =>
          f.employeeId.toLowerCase() === user.staffOrRollId.toLowerCase() ||
          f.email.toLowerCase() === user.email.toLowerCase()
      );
      setSelectedIdentifier(selfMatch?.employeeId ?? deptStaff[0]?.employeeId ?? '');
    }
  }, [personType, students, deptStaff, user.staffOrRollId, user.email]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const startCamera = async (desiredFacing: 'user' | 'environment' = facingMode) => {
    setCameraError(null);
    stopCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Live camera access is not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: desiredFacing },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(desiredFacing);
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Camera permission denied. Allow camera access to take the two required live captures.'
      );
    }
  };

  const captureLiveFrame = (slotType: 'face' | 'environment') => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setCameraError('Wait for the live camera stream to initialize before capturing.');
      return;
    }

    const canvas = document.createElement('canvas');
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

    if (slotType === 'face') {
      setFaceImageData(dataUrl);
      setCaptureStep('environment');
    } else {
      setEnvironmentImageData(dataUrl);
    }
    setLastOutcome(null);
  };

  const availableSlots = todaySlots.length > 0 ? todaySlots : allSlots;
  const activeSlot = useMemo(
    () => availableSlots.find((s) => s.id === selectedSlotId) ?? null,
    [availableSlots, selectedSlotId]
  );

  const selectedPersonName = useMemo(() => {
    if (personType === 'student') {
      return students.find((s) => s.rollNo === selectedIdentifier)?.fullName ?? '';
    }
    return deptStaff.find((f) => f.employeeId === selectedIdentifier)?.fullName ?? '';
  }, [personType, students, deptStaff, selectedIdentifier]);

  const handleVerifyAndMark = async () => {
    if (!faceImageData || !environmentImageData) {
      setErrorMsg('Capture both live photos (Face + Work Environment) before submitting.');
      return;
    }
    if (!selectedIdentifier || !selectedPersonName) {
      setErrorMsg('Select a student or department faculty member first.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setLastOutcome(null);
    try {
      const res = await api.verifyAndMarkAttendance(token, {
        personType,
        personIdentifier: selectedIdentifier,
        personName: selectedPersonName,
        timetableSlotId: activeSlot?.id ?? null,
        periodNumber: activeSlot?.periodNumber ?? serverTime?.activePeriod?.periodNumber ?? 1,
        subjectCode: activeSlot?.subjectCode ?? 'DEPT-ATT',
        subjectName: activeSlot?.subjectName ?? 'Daily Department Session',
        yearOfStudy: activeSlot?.yearOfStudy ?? user.yearOfStudy ?? '',
        section: activeSlot?.section ?? user.section ?? '',
        roomNo: activeSlot?.roomNo ?? 'Campus',
        faceImageData,
        environmentImageData,
        latitude: gpsCoords?.lat ?? null,
        longitude: gpsCoords?.lng ?? null,
      });

      setLastOutcome({
        approved: res.approved,
        summary: res.verification.summary,
        faceConfidence: res.verification.faceConfidence,
        environmentLabel: res.verification.environmentLabel,
        personName: res.record.personName,
      });

      if (res.sessionAlert) {
        setLiveSessionAlert(res.sessionAlert);
      } else {
        setLiveSessionAlert(null);
      }

      if (res.approved) {
        setFaceImageData(null);
        setEnvironmentImageData(null);
        setCaptureStep('face');
      }
      setChartRefreshSignal((n) => n + 1);
      await Promise.all([loadTodayAttendance(), loadLowRiskWatch()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Attendance verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const transitBufferMinutes = user.transitBufferMinutes ?? 15;

  // Automated Session Overlap Alert for consecutive classes in different rooms
  const sessionOverlapWarnings = useMemo<SessionOverlapWarning[]>(() => {
    const warnings: SessionOverlapWarning[] = [];
    const byDayFaculty = new Map<string, TimetableSlot[]>();
    allSlots.forEach((s) => {
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
  }, [allSlots, transitBufferMinutes]);

  // Faculty Availability Sync incorporating transit buffer around adjacent room switches
  const facultyAvailabilitySync = useMemo(() => {
    const activePeriodNum = serverTime?.activePeriod?.periodNumber ?? null;
    const serverMinutes = serverTime?.minutesSinceMidnight ?? null;
    const roomsByFaculty = new Map<string, Set<string>>();
    todaySlots.forEach((s) => {
      const key = s.facultyName.toLowerCase();
      const set = roomsByFaculty.get(key) ?? new Set<string>();
      if (s.roomNo.trim()) set.add(s.roomNo.trim().toLowerCase());
      roomsByFaculty.set(key, set);
    });

    const items = deptStaff.map((f) => {
      const key = f.fullName.toLowerCase();
      const activeSlot = activePeriodNum
        ? todaySlots.find(
            (s) => s.periodNumber === activePeriodNum && s.facultyName.toLowerCase() === key
          ) ?? null
        : null;

      let transitSlot: TimetableSlot | null = null;
      if (!activeSlot && serverMinutes !== null && (roomsByFaculty.get(key)?.size ?? 0) > 1) {
        transitSlot =
          todaySlots.find((s) => {
            if (s.facultyName.toLowerCase() !== key) return false;
            const st = parseHHMM(s.startTime);
            const en = parseHHMM(s.endTime);
            if (st === null || en === null) return false;
            return (
              serverMinutes >= st - transitBufferMinutes &&
              serverMinutes <= en + transitBufferMinutes
            );
          }) ?? null;
      }

      return {
        employeeId: f.employeeId,
        fullName: f.fullName,
        designation: f.designation,
        status: activeSlot ? ('in_class' as const) : transitSlot ? ('transit' as const) : ('available' as const),
        slotInfo: activeSlot
          ? `P${activeSlot.periodNumber} · ${activeSlot.subjectCode} (${activeSlot.roomNo || 'TBA'})`
          : transitSlot
          ? `Transit buffer · ${transitSlot.subjectCode} (${transitSlot.roomNo || 'TBA'})`
          : null,
      };
    });

    return {
      availableCount: items.filter((i) => i.status === 'available').length,
      busyCount: items.filter((i) => i.status !== 'available').length,
      items,
    };
  }, [deptStaff, todaySlots, serverTime, transitBufferMinutes]);

  // Live Attendance Rate for currently selected slot
  const activeSessionHealth = useMemo(() => {
    if (!activeSlot) return null;
    const cohortStudents = students.filter(
      (s) => s.yearOfStudy === activeSlot.yearOfStudy && s.section === activeSlot.section
    );
    const expectedCount = cohortStudents.length > 0 ? cohortStudents.length : students.length;
    if (expectedCount === 0) return null;
    const presentToday = new Set(
      records
        .filter(
          (r) =>
            r.personType === 'student' &&
            r.periodNumber === activeSlot.periodNumber &&
            (r.status === 'present' || r.status === 'late' || r.status === 'od') &&
            (!r.yearOfStudy || r.yearOfStudy === activeSlot.yearOfStudy) &&
            (!r.section || r.section === activeSlot.section)
        )
        .map((r) => r.personIdentifier.toUpperCase())
    ).size;
    const ratePct = Math.round((presentToday / expectedCount) * 100);
    return {
      subjectCode: activeSlot.subjectCode,
      subjectName: activeSlot.subjectName,
      periodNumber: activeSlot.periodNumber,
      presentCount: presentToday,
      expectedCount,
      ratePct,
      isBelowThreshold: presentToday > 0 && ratePct < 75,
    };
  }, [activeSlot, students, records]);

  const filteredRegister = useMemo(() => {
    const q = logSearchQuery.trim().toLowerCase();
    return records.filter((r) => {
      if (registerFilter !== 'all' && r.personType !== registerFilter) return false;
      if (!q) return true;
      return (
        r.personName.toLowerCase().includes(q) ||
        r.personIdentifier.toLowerCase().includes(q) ||
        r.subjectCode.toLowerCase().includes(q)
      );
    });
  }, [records, registerFilter, logSearchQuery]);

  const registerStats = useMemo(() => {
    const present = filteredRegister.filter((r) => r.status === 'present').length;
    const rejected = filteredRegister.filter((r) => r.status !== 'present').length;
    const studentCount = filteredRegister.filter((r) => r.personType === 'student').length;
    const facultyCount = filteredRegister.filter((r) => r.personType === 'faculty').length;
    return { total: filteredRegister.length, present, rejected, studentCount, facultyCount };
  }, [filteredRegister]);

  return (
    <div className="space-y-6">
      {/* Header Timetable Context Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">
              Daily Timetable Dual-Camera Attendance · {serverTime?.formattedDate ?? 'Syncing'} ·{' '}
              <span className="font-mono tabular-nums">{displayTime}</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mt-1">
              Live Face, Classroom Environment & Geofence Verification
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Verifies live face and classroom environment captures against student registration baselines and the HOD-pinned campus location.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FacultyDelayButton
              token={token}
              user={user}
              slots={allSlots}
              serverTime={serverTime}
              compact
            />
            <button
              type="button"
              onClick={() => {
                loadTodayAttendance();
                loadLowRiskWatch();
                setChartRefreshSignal((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh Register
            </button>
          </div>
        </div>
      </section>

      {/* Automated Alerts Grid: Session <75% Alert, Session Overlap Transit Alert & Faculty Availability Sync */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Real-time Attendance Alert & Session Overlap Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Real-Time Attendance &amp; Session Overlap Monitor
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Monitors 75% session thresholds and faculty room-to-room transit overlaps ({transitBufferMinutes}m buffer).
              </p>
            </div>
            {activeSessionHealth && (
              <span
                className={`font-mono text-xs tabular-nums font-semibold ${
                  activeSessionHealth.isBelowThreshold ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                P{activeSessionHealth.periodNumber} {activeSessionHealth.subjectCode} ·{' '}
                {activeSessionHealth.ratePct}% ({activeSessionHealth.presentCount}/
                {activeSessionHealth.expectedCount})
              </span>
            )}
          </div>

          {(liveSessionAlert || activeSessionHealth?.isBelowThreshold) && (
            <div
              role="alert"
              className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-950 flex items-start gap-2.5"
            >
              <BellRing className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">
                  Attendance Alert: Session below 75% (
                  {(liveSessionAlert ?? activeSessionHealth)!.subjectCode} · P
                  {(liveSessionAlert ?? activeSessionHealth)!.periodNumber})
                </div>
                <p className="text-rose-800 mt-0.5 tabular-nums">
                  Current turnout is {(liveSessionAlert ?? activeSessionHealth)!.ratePct}% (
                  {(liveSessionAlert ?? activeSessionHealth)!.presentCount} of{' '}
                  {(liveSessionAlert ?? activeSessionHealth)!.expectedCount} students marked). Push alerts have been dispatched to students and class advisors.
                </p>
              </div>
            </div>
          )}

          {sessionOverlapWarnings.length > 0 ? (
            <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-950">
                <span className="inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  Session Overlap Warning ({sessionOverlapWarnings.length} multi-location transition{sessionOverlapWarnings.length === 1 ? '' : 's'})
                </span>
                <span className="font-mono text-[11px] tabular-nums text-amber-800">
                  Buffer: {transitBufferMinutes} min
                </span>
              </div>
              <div className="space-y-1.5">
                {sessionOverlapWarnings.slice(0, 3).map((w, idx) => (
                  <div
                    key={`${w.facultyName}-${w.periodA}-${idx}`}
                    className="text-[11px] text-amber-900 font-mono tabular-nums"
                  >
                    {w.facultyName} ({w.dayOfWeek}): P{w.periodA} {w.roomA} ({w.endTimeA}) → P
                    {w.periodB} {w.roomB} ({w.startTimeB}) · {w.gapMinutes}m gap
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                No consecutive multi-location faculty session overlaps detected under your {transitBufferMinutes}-minute transit buffer.
              </span>
            </div>
          )}

          {/* Proactive Low Attendance Risk (<75% Cumulative) */}
          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Proactive Low Attendance Risk Watch (&lt;75% Cumulative)
                </div>
                <div className="text-[11px] text-slate-500">
                  Automatically alerts students below 75% cumulative attendance and notifies their Class Advisor.
                </div>
              </div>
              {(user.role === 'hod' || user.role === 'class_advisor' || user.role === 'dept_staff') &&
                lowRiskStudents.length > 0 && (
                  <button
                    type="button"
                    disabled={notifyingLowRisk}
                    onClick={handleDispatchLowRiskNotifications}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    {notifyingLowRisk ? 'Notifying...' : 'Notify Students & Advisors'}
                  </button>
                )}
            </div>

            {riskNotifyMsg && (
              <div className="text-xs text-indigo-800 font-medium">{riskNotifyMsg}</div>
            )}

            {lowRiskStudents.length > 0 ? (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                {lowRiskStudents.slice(0, 8).map((st) => (
                  <div
                    key={st.rollNo}
                    className="px-3 py-2 flex items-center justify-between gap-3 text-xs bg-white"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-900">{st.rollNo}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      <span className="font-medium text-slate-800">{st.studentName}</span>
                      <span className="ml-2 text-[11px] text-slate-500">
                        {st.yearOfStudy} Sec {st.section}
                      </span>
                    </div>
                    <div className="font-mono tabular-nums text-rose-700 font-semibold shrink-0">
                      {st.cumulativeRate}% ({st.presentCount}/{st.totalSessions})
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                No students currently flagged below 75% cumulative attendance across recorded sessions.
              </div>
            )}
          </div>
        </div>

        {/* Faculty Availability Sync Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Faculty Availability Sync
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Live status at {displayTime} (includes {transitBufferMinutes}m transit buffer)
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-mono tabular-nums text-slate-700 shrink-0">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>
                {facultyAvailabilitySync.availableCount} free · {facultyAvailabilitySync.busyCount} busy
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg max-h-64 overflow-y-auto flex-1">
            {facultyAvailabilitySync.items.length > 0 ? (
              facultyAvailabilitySync.items.map((fac) => (
                <div
                  key={fac.employeeId}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{fac.fullName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{fac.designation}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`font-medium ${
                        fac.status === 'available'
                          ? 'text-emerald-700'
                          : fac.status === 'transit'
                          ? 'text-indigo-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {fac.status === 'available'
                        ? 'Available'
                        : fac.status === 'transit'
                        ? 'Transit Buffer'
                        : 'In Session'}
                    </div>
                    {fac.slotInfo && (
                      <div className="text-[11px] font-mono tabular-nums text-slate-500">
                        {fac.slotInfo}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                No department faculty records loaded yet.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Weekly Attendance Fluctuations Chart (Recharts) */}
      <WeeklyAttendanceChart token={token} refreshSignal={chartRefreshSignal} />

      {/* HOD-Pinned Classroom Geofence Location Panel */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <MapPin className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
              <span>HOD-Pinned Classroom Location Geofence</span>
              {pinnedLocation?.configured && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-emerald-700 font-medium">
                    Active ({pinnedLocation.radiusMeters}m radius)
                  </span>
                </>
              )}
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mt-1">
              {pinnedLocation?.configured
                ? pinnedLocation.label
                : 'No Classroom Geofence Pinned Yet'}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
              {pinnedLocation?.configured &&
              pinnedLocation.latitude !== null &&
              pinnedLocation.longitude !== null
                ? `Pinned Coordinates: ${pinnedLocation.latitude}, ${pinnedLocation.longitude}${
                    pinnedLocation.updatedBy ? ` · Set by ${pinnedLocation.updatedBy}` : ''
                  }`
                : 'HOD can pin the exact department/classroom GPS coordinates so students register and mark attendance inside the classroom.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pinnedLocation?.configured &&
              pinnedLocation.latitude !== null &&
              pinnedLocation.longitude !== null && (
                <a
                  href={`https://www.google.com/maps?q=${pinnedLocation.latitude},${pinnedLocation.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View Pin on Map
                </a>
              )}
            <button
              type="button"
              disabled={gpsLoading}
              onClick={() => requestCurrentGps(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium text-indigo-800 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg whitespace-nowrap"
            >
              <Navigation className="w-3.5 h-3.5" />
              {gpsLoading ? 'Locating GPS...' : 'Verify My Classroom GPS'}
            </button>
          </div>
        </div>

        {/* Live GPS Lock Status */}
        {(gpsCoords || gpsError) && (
          <div
            className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
              gpsError
                ? 'bg-rose-50 border-rose-200 text-rose-800'
                : isInsidePinnedZone
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            {gpsError ? (
              <span>{gpsError}</span>
            ) : (
              <>
                <span className="font-medium">
                  {pinnedLocation?.configured
                    ? isInsidePinnedZone
                      ? `Inside HOD-Pinned Classroom Zone (${gpsDistanceMeters}m away · limit ${pinnedLocation.radiusMeters}m)`
                      : `Outside HOD-Pinned Zone (${gpsDistanceMeters}m away · move within ${pinnedLocation.radiusMeters}m to mark attendance)`
                    : `Device GPS Locked (${gpsCoords?.lat}, ${gpsCoords?.lng})`}
                </span>
                <span className="font-mono text-[11px] tabular-nums opacity-80">
                  ±{gpsCoords?.accuracy}m accuracy
                </span>
              </>
            )}
          </div>
        )}

        {/* HOD-Only Pin Controls */}
        {user.role === 'hod' && (
          <div className="pt-3 border-t border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">
                HOD Classroom Location Pinning Controls
              </span>
              <button
                type="button"
                disabled={gpsLoading}
                onClick={() => requestCurrentGps(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
              >
                <MapPin className="w-3.5 h-3.5 text-indigo-700" />
                Fill From My Current GPS
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="sm:col-span-2 block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Classroom / Block Name</span>
                <input
                  type="text"
                  value={pinLabel}
                  onChange={(e) => setPinLabel(e.target.value)}
                  placeholder="e.g. ESEC EIE Block Classroom Wing"
                  className="w-full px-3 py-2 min-h-[38px] text-xs border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Latitude</span>
                <input
                  type="text"
                  value={pinLat}
                  onChange={(e) => setPinLat(e.target.value)}
                  placeholder="11.312500"
                  className="w-full px-3 py-2 min-h-[38px] text-xs font-mono border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Longitude</span>
                <input
                  type="text"
                  value={pinLng}
                  onChange={(e) => setPinLng(e.target.value)}
                  placeholder="77.550100"
                  className="w-full px-3 py-2 min-h-[38px] text-xs font-mono border border-slate-300 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-600">Radius (meters)</span>
                <input
                  type="number"
                  min={25}
                  max={5000}
                  value={pinRadius}
                  onChange={(e) => setPinRadius(e.target.value)}
                  className="w-full px-3 py-2 min-h-[38px] text-xs font-mono border border-slate-300 rounded-lg"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {pinMessage ? (
                <span className="text-xs text-indigo-800 font-medium">{pinMessage}</span>
              ) : (
                <span className="text-[11px] text-slate-500">
                  Registering students and daily camera attendance will verify GPS proximity against this pinned point.
                </span>
              )}
              <button
                type="button"
                disabled={savingPin}
                onClick={handleSaveHodPin}
                className="px-4 py-2 min-h-[38px] text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                {savingPin ? 'Saving Pin...' : 'Save Pinned Classroom Location'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main Dual-Camera Capture & Selection Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Target Period, Person & Live Camera Feed */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          {/* Student vs Faculty Toggle & Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">Attendance Mode</span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPersonType('student')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    personType === 'student'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Student
                </button>
                <button
                  type="button"
                  onClick={() => setPersonType('faculty')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    personType === 'faculty'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Department Faculty
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                {personType === 'student' ? 'Select Student (Roll No)' : 'Select Department Faculty'}
              </label>
              <select
                value={selectedIdentifier}
                onChange={(e) => setSelectedIdentifier(e.target.value)}
                className="w-full px-3 py-2 min-h-[40px] text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                {personType === 'student' ? (
                  students.length > 0 ? (
                    students.map((s) => (
                      <option key={s.rollNo} value={s.rollNo}>
                        {s.rollNo} — {s.fullName} ({s.yearOfStudy} {s.section})
                      </option>
                    ))
                  ) : (
                    <option value="">No students added yet — upload or add manually</option>
                  )
                ) : deptStaff.length > 0 ? (
                  deptStaff.map((f) => (
                    <option key={f.employeeId} value={f.employeeId}>
                      {f.employeeId} — {f.fullName} ({f.designation})
                    </option>
                  ))
                ) : (
                  <option value="">No department staff added yet — upload or add manually</option>
                )}
              </select>
              {personType === 'student' && selectedIdentifier && (
                <div className="text-[11px] text-slate-500">
                  {selectedStudentBiometric ? (
                    <span className="text-emerald-700 font-medium">
                      Registered face & classroom environment baseline on file
                      {selectedStudentBiometric.locationVerified
                        ? ` · Pinned GPS verified${
                            selectedStudentBiometric.distanceMeters !== null
                              ? ` (${selectedStudentBiometric.distanceMeters}m)`
                              : ''
                          }`
                        : ''}
                    </span>
                  ) : (
                    <span>No registration face baseline yet (live AI verification active)</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">
              Timetable Period Slot ({todaySlots.length > 0 ? serverTime?.weekday : 'Department Schedule'})
            </label>
            <select
              value={selectedSlotId ?? ''}
              onChange={(e) => setSelectedSlotId(Number(e.target.value) || null)}
              className="w-full px-3 py-2 min-h-[40px] text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              {availableSlots.length > 0 ? (
                availableSlots.map((sl) => (
                  <option key={sl.id} value={sl.id}>
                    {sl.dayOfWeek} · P{sl.periodNumber} ({sl.startTime}–{sl.endTime}) · {sl.subjectCode}{' '}
                    {sl.subjectName} — {sl.yearOfStudy} Sec {sl.section} · Room {sl.roomNo}
                  </option>
                ))
              ) : (
                <option value="">
                  Daily Department Session (upload timetable or add slots manually)
                </option>
              )}
            </select>
          </div>

          {/* Live Camera Viewport */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">
                Live Camera Feed —{' '}
                {captureStep === 'face'
                  ? 'Capture 1 of 2: Live Face'
                  : 'Capture 2 of 2: Work / Classroom Environment'}
              </span>
              <div className="flex items-center gap-2">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => startCamera(captureStep === 'face' ? 'user' : 'environment')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-md whitespace-nowrap"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    Start Live Camera
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        startCamera(facingMode === 'user' ? 'environment' : 'user')
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Switch {facingMode === 'user' ? 'Rear' : 'Front'} Lens
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                    >
                      Stop Camera
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
              />
              {!cameraActive && (
                <div className="text-center p-6 space-y-2">
                  <Camera className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-300">
                    Camera preview is idle. Click “Start Live Camera” to capture live face and work environment frames.
                  </p>
                </div>
              )}
            </div>

            {cameraError && (
              <div className="p-3 rounded-md border border-red-200 bg-red-50 text-xs text-red-800">
                {cameraError}
              </div>
            )}

            {/* Two Direct Live Capture Triggers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!cameraActive}
                onClick={() => captureLiveFrame('face')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
              >
                <User className="w-4 h-4" />
                {faceImageData ? 'Retake Photo 1: Face' : 'Capture Photo 1: Face'}
              </button>
              <button
                type="button"
                disabled={!cameraActive}
                onClick={() => captureLiveFrame('environment')}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg transition-colors whitespace-nowrap"
              >
                <Building className="w-4 h-4" />
                {environmentImageData
                  ? 'Retake Photo 2: Work Environment'
                  : 'Capture Photo 2: Work Environment'}
              </button>
            </div>
          </div>
        </section>

        {/* Right: 2-Photo Evidence Preview & AI Detection Submit */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Required Live Capture Evidence (2 Photos Only)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Both live photos are analyzed on the server to confirm face presence and work environment before marking daily attendance.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Photo 1 Preview */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-700">
                1. Face Photo {faceImageData ? '· Captured' : '· Required'}
              </div>
              <div className="aspect-[4/3] rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                {faceImageData ? (
                  <img
                    src={faceImageData}
                    alt="Live face capture"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[11px] text-slate-400 px-2 text-center">
                    No live face captured
                  </span>
                )}
              </div>
            </div>

            {/* Photo 2 Preview */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-700">
                2. Work Environment {environmentImageData ? '· Captured' : '· Required'}
              </div>
              <div className="aspect-[4/3] rounded-md border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                {environmentImageData ? (
                  <img
                    src={environmentImageData}
                    alt="Live work environment capture"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[11px] text-slate-400 px-2 text-center">
                    No work environment captured
                  </span>
                )}
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          {lastOutcome && (
            <div
              className={`p-4 rounded-lg border text-xs space-y-1.5 ${
                lastOutcome.approved
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {lastOutcome.approved ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <span>
                  {lastOutcome.approved
                    ? `Attendance Marked Present for ${lastOutcome.personName}`
                    : `Verification Rejected for ${lastOutcome.personName}`}
                </span>
              </div>
              <p className="leading-relaxed">{lastOutcome.summary}</p>
              <div className="font-mono text-[11px] tabular-nums opacity-80">
                Face Confidence: {lastOutcome.faceConfidence}% · Environment: {lastOutcome.environmentLabel}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={submitting || !faceImageData || !environmentImageData}
            onClick={handleVerifyAndMark}
            className="w-full py-2.5 px-4 text-sm font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors"
          >
            {submitting
              ? 'Detecting Face & Environment...'
              : 'Verify 2 Live Photos & Mark Attendance'}
          </button>
        </section>
      </div>

      {/* Daily Verified Attendance Register with Search, CSV, Excel & PDF Export */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Daily Timetable Attendance Log ({logDate || serverTime?.isoDate || 'Today'})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Filter logs by student name or roll number and export printable PDF, Excel (.xlsx), or CSV reports.
              </p>
            </div>

            <div className="relative w-full lg:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder="Search student name, roll number, or subject..."
                aria-label="Filter attendance logs by student name or roll number"
                className="w-full pl-9 pr-8 py-2 min-h-[38px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
              />
              {logSearchQuery && (
                <button
                  type="button"
                  onClick={() => setLogSearchQuery('')}
                  aria-label="Clear attendance log search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white text-xs text-slate-700">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="date"
                  value={logDate || serverTime?.isoDate || ''}
                  onChange={(e) => handleDateChange(e.target.value)}
                  aria-label="Select attendance log date"
                  className="text-xs font-mono tabular-nums text-slate-800 focus:outline-none bg-transparent"
                />
              </label>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['all', 'student', 'faculty'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setRegisterFilter(f)}
                    className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                      registerFilter === f
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f === 'all' ? `All (${records.length})` : f === 'student' ? 'Students' : 'Faculty'}
                  </button>
                ))}
              </div>

              <select
                value={exportScope}
                onChange={(e) => {
                  setExportScope(e.target.value as 'date' | 'month' | 'all_dates');
                  setExportFeedback(null);
                }}
                aria-label="Export date scope"
                className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-700"
              >
                <option value="date">Scope: Selected Date</option>
                <option value="month">Scope: Monthly Summary</option>
                <option value="all_dates">Scope: All Recorded Dates</option>
              </select>

              {exportScope === 'month' && (
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-indigo-300 rounded-lg bg-indigo-50/40 text-xs text-slate-700">
                  <Calendar className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <input
                    type="month"
                    value={exportMonth}
                    onChange={(e) => {
                      setExportMonth(e.target.value);
                      setExportFeedback(null);
                    }}
                    aria-label="Select month for monthly attendance summary"
                    className="text-xs font-mono tabular-nums text-slate-900 focus:outline-none bg-transparent"
                  />
                </label>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExportLogs('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                {exportingFormat === 'csv'
                  ? 'Exporting CSV...'
                  : exportScope === 'month'
                  ? 'Monthly CSV'
                  : 'Export CSV'}
              </button>
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExportLogs('xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {exportingFormat === 'xlsx'
                  ? 'Exporting Excel...'
                  : exportScope === 'month'
                  ? 'Monthly Excel'
                  : 'Export to Excel'}
              </button>
              <button
                type="button"
                disabled={exportingFormat !== null}
                onClick={() => handleExportLogs('pdf')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                {exportingFormat === 'pdf'
                  ? 'Generating PDF...'
                  : exportScope === 'month'
                  ? 'Monthly PDF'
                  : 'Download PDF'}
              </button>
            </div>
          </div>
        </div>

        {/* Administrative Summary Strip */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums">
            <span>
              Total: <strong className="text-slate-900">{registerStats.total}</strong>
            </span>
            <span>
              Present: <strong className="text-emerald-700">{registerStats.present}</strong>
            </span>
            <span>
              Rejected: <strong className="text-red-700">{registerStats.rejected}</strong>
            </span>
            <span>
              Students: <strong className="text-slate-900">{registerStats.studentCount}</strong>
            </span>
            <span>
              Faculty: <strong className="text-slate-900">{registerStats.facultyCount}</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            {exportScope === 'month'
              ? `Monthly summary (${exportMonth}) aggregates per-individual days present, verification rates, and daily breakdown.`
              : exportScope === 'all_dates'
              ? 'CSV & PDF will export the full multi-date administrative archive.'
              : `CSV & PDF will export records for ${logDate || serverTime?.isoDate || 'today'}.`}
          </span>
        </div>

        {exportFeedback && (
          <div className="px-6 py-2.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span>{exportFeedback}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">ID / Roll No</th>
                <th className="py-3 px-4">Name & Role</th>
                <th className="py-3 px-4">Timetable Slot</th>
                <th className="py-3 px-4">Live Captures</th>
                <th className="py-3 px-4">Detection Result</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {loading && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading daily attendance records...
                  </td>
                </tr>
              )}
              {!loading &&
                filteredRegister.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono tabular-nums font-medium text-slate-900">
                      {rec.personIdentifier}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900">{rec.personName}</div>
                      <div className="text-slate-500 capitalize">{rec.personType}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      <div className="font-medium">
                        P{rec.periodNumber} · {rec.subjectCode} ({rec.roomNo})
                      </div>
                      <div className="text-slate-500">{rec.subjectName}</div>
                    </td>
                    <td className="py-3 px-4">
                      {rec.faceImageData || rec.environmentImageData ? (
                        <div className="flex items-center gap-2">
                          {rec.faceImageData && (
                            <img
                              src={rec.faceImageData}
                              alt={`${rec.personName} face`}
                              className="w-12 h-9 object-cover rounded border border-slate-200"
                            />
                          )}
                          {rec.environmentImageData && (
                            <img
                              src={rec.environmentImageData}
                              alt={`${rec.personName} work environment`}
                              className="w-12 h-9 object-cover rounded border border-slate-200"
                            />
                          )}
                        </div>
                      ) : (
                        <span className="text-[11px] font-medium text-slate-500">
                          {rec.status === 'od'
                            ? 'HOD Approved OD'
                            : rec.status === 'absent'
                            ? 'HOD Approved Leave'
                            : 'Auto-logged'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs">
                      <div>
                        {rec.status === 'od' || rec.status === 'absent' ? (
                          <span className="font-medium text-slate-700">
                            {rec.environmentLabel || (rec.status === 'od' ? 'On-Duty Permission' : 'Approved Leave')}
                          </span>
                        ) : (
                          <>
                            Face: {rec.faceDetected ? `Verified (${rec.faceConfidence}%)` : 'Not detected'} ·{' '}
                            {rec.environmentLabel}
                          </>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {rec.verificationSummary}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium whitespace-nowrap">
                      {rec.status === 'present' ? (
                        <span className="text-emerald-700">Present · Verified</span>
                      ) : rec.status === 'od' ? (
                        <span className="text-indigo-700 font-semibold">OD · On-Duty</span>
                      ) : rec.status === 'absent' ? (
                        <span className="text-rose-700 font-semibold">Absent · Leave</span>
                      ) : rec.status === 'late' ? (
                        <span className="text-amber-700">Late</span>
                      ) : (
                        <span className="text-red-700">Rejected</span>
                      )}
                    </td>
                  </tr>
                ))}
              {!loading && filteredRegister.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No attendance captured yet for {serverTime?.isoDate ?? 'today'}. Use the live camera capture module above to record daily attendance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
