import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building,
  Calendar,
  Camera,
  CheckCircle2,
  Download,
  FileText,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  User,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  AttendancePersonType,
  AttendanceRecordItem,
  DepartmentStaff,
  DepartmentStudent,
  ServerTimePayload,
  TimetableSlot,
  UserProfile,
} from '../types';

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

  // Register filter, date selector & administrative export state
  const [registerFilter, setRegisterFilter] = useState<'all' | 'student' | 'faculty'>('all');
  const [logDate, setLogDate] = useState<string>(serverTime?.isoDate ?? '');
  const [exportMonth, setExportMonth] = useState<string>(
    (serverTime?.isoDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7)
  );
  const [exportScope, setExportScope] = useState<'date' | 'month' | 'all_dates'>('date');
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'pdf' | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);

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

  useEffect(() => {
    loadTodayAttendance();
  }, [loadTodayAttendance]);

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

  const handleExportLogs = async (format: 'csv' | 'pdf') => {
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
      setExportFeedback(
        `Exported ${format.toUpperCase()} attendance register for ${scopeLabel}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Unable to export ${format.toUpperCase()} file.`);
    } finally {
      setExportingFormat(null);
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
      });

      setLastOutcome({
        approved: res.approved,
        summary: res.verification.summary,
        faceConfidence: res.verification.faceConfidence,
        environmentLabel: res.verification.environmentLabel,
        personName: res.record.personName,
      });

      if (res.approved) {
        setFaceImageData(null);
        setEnvironmentImageData(null);
        setCaptureStep('face');
      }
      await loadTodayAttendance();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Attendance verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRegister = useMemo(() => {
    if (registerFilter === 'all') return records;
    return records.filter((r) => r.personType === registerFilter);
  }, [records, registerFilter]);

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
              Live Face & Work Environment Verification
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Marks daily attendance directly against the server-time timetable using strictly two live camera captures: (1) Face photo and (2) Classroom / lab / work environment photo.
            </p>
          </div>
          <button
            type="button"
            onClick={loadTodayAttendance}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Register
          </button>
        </div>
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

      {/* Daily Verified Attendance Register with CSV / PDF Export */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Daily Timetable Attendance Log ({logDate || serverTime?.isoDate || 'Today'})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Unique daily attendance per person and timetable period — exportable as CSV or PDF for official record-keeping.
            </p>
          </div>

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

            <div className="flex items-center gap-2">
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
                onClick={() => handleExportLogs('pdf')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                {exportingFormat === 'pdf'
                  ? 'Exporting PDF...'
                  : exportScope === 'month'
                  ? 'Monthly PDF'
                  : 'Export PDF'}
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
                      <div className="flex items-center gap-2">
                        <img
                          src={rec.faceImageData}
                          alt={`${rec.personName} face`}
                          className="w-12 h-9 object-cover rounded border border-slate-200"
                        />
                        <img
                          src={rec.environmentImageData}
                          alt={`${rec.personName} work environment`}
                          className="w-12 h-9 object-cover rounded border border-slate-200"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs">
                      <div>
                        Face: {rec.faceDetected ? `Verified (${rec.faceConfidence}%)` : 'Not detected'} ·{' '}
                        {rec.environmentLabel}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {rec.verificationSummary}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium whitespace-nowrap">
                      {rec.status === 'present' ? (
                        <span className="text-emerald-700">Present · Verified</span>
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
