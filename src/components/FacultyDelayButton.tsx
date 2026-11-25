import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Music, Play, Send, Sparkles, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import {
  getFacultyAudioSettings,
  playFacultyAlertAudio,
  saveFacultyAudioSettings,
  validateCustomAudioFile,
  type FacultyAudioPreset,
  type FacultyAudioSettings,
} from '../lib/facultyAudio';
import type { ServerTimePayload, TimetableSlot, UserProfile } from '../types';

interface FacultyDelayButtonProps {
  token: string;
  user: UserProfile;
  slots: TimetableSlot[];
  serverTime: ServerTimePayload | null;
  compact?: boolean;
  onAlertSent?: () => void;
}

export function FacultyDelayButton({
  token,
  user,
  slots,
  serverTime,
  compact = false,
  onAlertSent,
}: FacultyDelayButtonProps) {
  const canReport =
    user.role === 'class_rep' || user.role === 'class_advisor' || user.role === 'hod';

  const [open, setOpen] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('');
  const [customFacultyName, setCustomFacultyName] = useState('');
  const [customSubjectCode, setCustomSubjectCode] = useState('');
  const [customSubjectName, setCustomSubjectName] = useState('');
  const [customRoomNo, setCustomRoomNo] = useState('');
  const [delayMinutes, setDelayMinutes] = useState<number>(10);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sentToast, setSentToast] = useState<string | null>(null);
  const [audioSettings, setAudioSettings] = useState<FacultyAudioSettings>(() =>
    getFacultyAudioSettings()
  );
  const [audioErr, setAudioErr] = useState<string | null>(null);

  const relevantSlots = useMemo(() => {
    const activeDay = serverTime?.weekday ?? '';
    const userClassSlots =
      user.yearOfStudy && user.section
        ? slots.filter(
            (s) => s.yearOfStudy === user.yearOfStudy && s.section === user.section
          )
        : slots;
    const pool = userClassSlots.length > 0 ? userClassSlots : slots;
    const todayPool = activeDay ? pool.filter((s) => s.dayOfWeek === activeDay) : [];
    return todayPool.length > 0 ? todayPool : pool;
  }, [slots, serverTime?.weekday, user.yearOfStudy, user.section]);

  // Pre-select the active server-time period when opening modal
  useEffect(() => {
    if (!open) return;
    const activeNum = serverTime?.activePeriod?.periodNumber;
    const activeMatch = activeNum
      ? relevantSlots.find((s) => s.periodNumber === activeNum)
      : null;
    const pick = activeMatch ?? relevantSlots[0] ?? null;
    setSelectedSlotId(pick ? String(pick.id) : 'custom');
    setErrorMsg(null);
  }, [open, relevantSlots, serverTime?.activePeriod?.periodNumber]);

  const selectedSlot = useMemo(
    () => relevantSlots.find((s) => String(s.id) === selectedSlotId) ?? null,
    [relevantSlots, selectedSlotId]
  );

  if (!canReport) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const facultyName = selectedSlot ? selectedSlot.facultyName : customFacultyName.trim();
    if (!facultyName) {
      setErrorMsg('Select the active period or specify the respected hour faculty name.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.reportFacultyDelay(token, {
        timetableSlotId: selectedSlot?.id ?? null,
        yearOfStudy: selectedSlot?.yearOfStudy ?? user.yearOfStudy ?? '',
        section: selectedSlot?.section ?? user.section ?? '',
        dayOfWeek: selectedSlot?.dayOfWeek ?? serverTime?.weekday ?? 'Monday',
        periodNumber:
          selectedSlot?.periodNumber ?? serverTime?.activePeriod?.periodNumber ?? 1,
        subjectCode: selectedSlot?.subjectCode ?? (customSubjectCode.trim() || 'CLASS'),
        subjectName:
          selectedSlot?.subjectName ?? (customSubjectName.trim() || 'Scheduled Hour'),
        roomNo: selectedSlot?.roomNo ?? customRoomNo.trim(),
        facultyName,
        delayMinutes,
        note: note.trim(),
      });

      setOpen(false);
      setNote('');
      playFacultyAlertAudio('faculty_delay', { overrideSettings: audioSettings });
      setSentToast(
        `Faculty delay alert dispatched to ${res.alert.facultyName}, HOD, and Class Advisor.`
      );
      window.setTimeout(() => setSentToast(null), 5000);
      onAlertSent?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to send faculty delay alert.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
          compact
            ? 'px-3 py-2 min-h-[40px] text-xs text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200'
            : 'px-3.5 py-2 min-h-[40px] text-xs text-white bg-rose-700 hover:bg-rose-800'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>Faculty Delay Alert</span>
      </button>

      {sentToast && (
        <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 max-w-sm bg-emerald-900 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2.5 text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>{sentToast}</span>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="faculty-delay-modal-title"
        >
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl overflow-hidden pb-safe">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="faculty-delay-modal-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Report Faculty Delay for Active Hour
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Notifies the respected hour faculty, HOD, and Class Advisor immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close faculty delay modal"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 flex items-start gap-2 text-[11px] text-indigo-950">
                <Sparkles className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Auto Time-Analysis Always Active:</span> The server automatically checks the live timetable every minute and alerts the scheduled faculty&apos;s mobile if attendance hasn&apos;t started. Use this form anytime for immediate manual escalation.
                </div>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {errorMsg}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  Scheduled Period & Respected Hour Faculty
                </label>
                <select
                  value={selectedSlotId}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                  className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg bg-white text-slate-900"
                >
                  {relevantSlots.map((slot) => (
                    <option key={slot.id} value={String(slot.id)}>
                      {slot.dayOfWeek} · P{slot.periodNumber} ({slot.startTime}–{slot.endTime}) ·{' '}
                      {slot.subjectCode} — {slot.facultyName} ({slot.yearOfStudy} Sec {slot.section})
                    </option>
                  ))}
                  <option value="custom">Other / Enter Faculty Name Manually</option>
                </select>
              </div>

              {selectedSlot ? (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-xs">
                  <div className="font-semibold text-slate-900">
                    {selectedSlot.facultyName} · {selectedSlot.subjectCode} ({selectedSlot.subjectName})
                  </div>
                  <div className="text-slate-600 tabular-nums">
                    {selectedSlot.yearOfStudy} Section {selectedSlot.section} · Period P
                    {selectedSlot.periodNumber} ({selectedSlot.startTime}–{selectedSlot.endTime}) · Room{' '}
                    {selectedSlot.roomNo || 'TBA'}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs font-medium text-slate-700">
                      Respected Hour Faculty Name
                    </span>
                    <input
                      type="text"
                      required
                      value={customFacultyName}
                      onChange={(e) => setCustomFacultyName(e.target.value)}
                      placeholder="e.g. Dr. K. Rajesh"
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Subject Code</span>
                    <input
                      type="text"
                      value={customSubjectCode}
                      onChange={(e) => setCustomSubjectCode(e.target.value)}
                      placeholder="e.g. EI3402"
                      className="w-full px-3 py-2 min-h-[40px] text-xs font-mono uppercase border border-slate-300 rounded-lg"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Room No.</span>
                    <input
                      type="text"
                      value={customRoomNo}
                      onChange={(e) => setCustomRoomNo(e.target.value)}
                      placeholder="e.g. EIE-201"
                      className="w-full px-3 py-2 min-h-[40px] text-xs font-mono border border-slate-300 rounded-lg"
                    />
                  </label>
                  <label className="block space-y-1 sm:col-span-2">
                    <span className="text-xs font-medium text-slate-700">Subject Name</span>
                    <input
                      type="text"
                      value={customSubjectName}
                      onChange={(e) => setCustomSubjectName(e.target.value)}
                      placeholder="e.g. Industrial Instrumentation"
                      className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg"
                    />
                  </label>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-700">
                  Delay Duration (Minutes Elapsed)
                </span>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDelayMinutes(mins)}
                      className={`py-2 min-h-[40px] text-xs font-mono font-medium rounded-lg border transition-colors ${
                        delayMinutes === mins
                          ? 'bg-rose-700 text-white border-rose-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {mins}+ min
                    </button>
                  ))}
                </div>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700">
                  Additional Note (Optional)
                </span>
                <input
                  type="text"
                  maxLength={240}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Class seated in Room 204 awaiting faculty arrival"
                  className="w-full px-3 py-2 min-h-[40px] text-xs border border-slate-300 rounded-lg"
                />
              </label>

              {/* Custom Audio Notification Picker for Faculty Alert */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-slate-800 inline-flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-indigo-700" />
                    Custom Audio Notification Tone
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      playFacultyAlertAudio('faculty_delay', { overrideSettings: audioSettings })
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-800 bg-indigo-100 hover:bg-indigo-200 rounded"
                  >
                    <Play className="w-2.5 h-2.5" />
                    Preview
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'siren_pulse', label: 'Siren Pulse' },
                      { id: 'campus_bell', label: 'Campus Bell' },
                      { id: 'urgent_chime', label: 'Urgent Chime' },
                    ] as { id: FacultyAudioPreset; label: string }[]
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const updated = saveFacultyAudioSettings({ preset: p.id });
                        setAudioSettings(updated);
                        playFacultyAlertAudio('faculty_delay', { overrideSettings: updated });
                      }}
                      className={`px-2 py-1 text-[10px] font-medium rounded border ${
                        audioSettings.preset === p.id
                          ? 'bg-indigo-700 text-white border-indigo-700'
                          : 'bg-white text-slate-700 border-slate-300'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <label className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-indigo-800 bg-white border border-indigo-300 hover:bg-indigo-50 rounded cursor-pointer">
                    <Upload className="w-3 h-3" />
                    {audioSettings.customAudioName ? 'Change Custom Audio' : 'Upload Custom Audio'}
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(ev) => {
                        const f = ev.target.files?.[0];
                        ev.target.value = '';
                        if (!f) return;
                        const err = validateCustomAudioFile(f);
                        if (err) {
                          setAudioErr(err);
                          return;
                        }
                        setAudioErr(null);
                        const reader = new FileReader();
                        reader.onload = () => {
                          if (typeof reader.result !== 'string') return;
                          try {
                            const updated = saveFacultyAudioSettings({
                              preset: 'custom',
                              customAudioName: f.name,
                              customAudioDataUrl: reader.result,
                            });
                            setAudioSettings(updated);
                            playFacultyAlertAudio('faculty_delay', { overrideSettings: updated });
                          } catch (saveErr) {
                            setAudioErr(
                              saveErr instanceof Error ? saveErr.message : 'Unable to save audio.'
                            );
                          }
                        };
                        reader.readAsDataURL(f);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {audioSettings.preset === 'custom' && audioSettings.customAudioName && (
                  <div className="text-[10px] text-emerald-700">
                    Active custom audio: {audioSettings.customAudioName}
                  </div>
                )}
                {audioErr && <div className="text-[10px] text-rose-700">{audioErr}</div>}
              </div>

              <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-rose-50/70 border border-rose-100 rounded-lg px-3 py-2">
                <Clock className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                <span>
                  Instant notification recipients:{' '}
                  <strong>
                    {selectedSlot?.facultyName || customFacultyName || 'Respected Hour Faculty'}
                  </strong>{' '}
                  · <strong>HOD</strong> · <strong>Class Advisor</strong>
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 min-h-[40px] text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-rose-700 hover:bg-rose-800 disabled:opacity-50 rounded-lg"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Sending Alert...' : 'Send Faculty Delay Notification'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
