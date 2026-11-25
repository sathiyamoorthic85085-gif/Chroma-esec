import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ROLE_LABELS,
  type FacultyAlterationItem,
  type OdLeaveFieldType,
  type OdLeaveFormConfig,
  type OdLeaveFormFieldConfig,
  type OdLeaveRequestItem,
  type OdLeaveRequestType,
  type ServerTimePayload,
  type TimetableSlot,
  type UserProfile,
  type UserRole,
} from '../types';

interface OdLeaveViewProps {
  token: string;
  user: UserProfile;
  serverTime: ServerTimePayload | null;
  onAttendanceUpdated?: () => void;
}

function countDaysInclusive(fromDate: string, toDate: string): number {
  if (!fromDate || !toDate) return 0;
  const s = new Date(`${fromDate}T00:00:00Z`);
  const e = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

export function OdLeaveView({
  token,
  user,
  serverTime,
  onAttendanceUpdated,
}: OdLeaveViewProps) {
  const isHod = user.role === 'hod';
  const isClassAdvisor = user.role === 'class_advisor';
  const isStudent = user.role === 'student' || user.role === 'class_rep';
  const applicantCategory: 'student' | 'faculty' = isStudent ? 'student' : 'faculty';

  const isFacultyRole = !isStudent;

  const [activeTab, setActiveTab] = useState<'requests' | 'apply' | 'alterations' | 'customize'>(
    isHod || isClassAdvisor ? 'requests' : 'apply'
  );

  const [requests, setRequests] = useState<OdLeaveRequestItem[]>([]);
  const [activeToday, setActiveToday] = useState<OdLeaveRequestItem[]>([]);
  const [formConfig, setFormConfig] = useState<OdLeaveFormConfig | null>(null);
  const [serverDate, setServerDate] = useState<string>(
    () => serverTime?.isoDate || new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters on Requests tab
  const [statusFilter, setStatusFilter] = useState<'all' | 'action_needed' | 'approved' | 'rejected'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'od' | 'leave'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Review state
  const [remarksById, setRemarksById] = useState<Record<number, string>>({});
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [previewModal, setPreviewModal] = useState<{
    title: string;
    url: string;
    isImage: boolean;
  } | null>(null);

  // Application form state
  const [requestType, setRequestType] = useState<OdLeaveRequestType>('od');
  const [applicantName, setApplicantName] = useState(user.fullName);
  const [rollOrEmployeeId, setRollOrEmployeeId] = useState(user.staffOrRollId || '');
  const [mobileNumber, setMobileNumber] = useState(user.phone || '');
  const [yearOfStudy, setYearOfStudy] = useState(user.yearOfStudy || 'III Year');
  const [section, setSection] = useState(user.section || 'A');
  const [fromDate, setFromDate] = useState(
    () => serverTime?.isoDate || new Date().toISOString().slice(0, 10)
  );
  const [toDate, setToDate] = useState(
    () => serverTime?.isoDate || new Date().toISOString().slice(0, 10)
  );
  const [reason, setReason] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [docUpload, setDocUpload] = useState<{
    fileKey: string;
    fileName: string;
    mimeType: string;
  } | null>(null);
  const [photoUpload, setPhotoUpload] = useState<{
    fileKey: string;
    fileName: string;
    mimeType: string;
    localPreviewUrl: string;
  } | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // HOD Customization draft state
  const [draftConfig, setDraftConfig] = useState<OdLeaveFormConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // Faculty Alterations state (Busy / OD / Absent -> HOD Permission)
  const [alterations, setAlterations] = useState<FacultyAlterationItem[]>([]);
  const [alterCandidates, setAlterCandidates] = useState<
    {
      userId: number | null;
      fullName: string;
      email: string;
      phone: string;
      designation: string;
      role: string;
    }[]
  >([]);
  const [alterSlots, setAlterSlots] = useState<TimetableSlot[]>([]);
  const [selectedAlterSlotId, setSelectedAlterSlotId] = useState<string>('');
  const [alterDate, setAlterDate] = useState<string>(
    () => serverTime?.isoDate || new Date().toISOString().slice(0, 10)
  );
  const [alterReason, setAlterReason] = useState<'busy' | 'od' | 'absent'>('busy');
  const [alterSubName, setAlterSubName] = useState('');
  const [alterNote, setAlterNote] = useState('');
  const [alterManualSubject, setAlterManualSubject] = useState('');
  const [alterManualPeriod, setAlterManualPeriod] = useState(1);
  const [alterManualDay, setAlterManualDay] = useState('Monday');
  const [alterSubmitting, setAlterSubmitting] = useState(false);
  const [alterDecidingId, setAlterDecidingId] = useState<number | null>(null);
  const [alterRemarksById, setAlterRemarksById] = useState<Record<number, string>>({});

  const loadData = useCallback(async () => {
    try {
      const [res, altRes, ttRes] = await Promise.all([
        api.getOdLeaveRequests(token),
        isFacultyRole ? api.getFacultyAlterations(token).catch(() => null) : Promise.resolve(null),
        isFacultyRole ? api.getTimetable(token).catch(() => null) : Promise.resolve(null),
      ]);
      setRequests(res.requests);
      setActiveToday(res.activeToday);
      setFormConfig(res.config);
      setDraftConfig((prev) => prev ?? res.config);
      if (res.serverDate) {
        setServerDate(res.serverDate);
      }
      if (altRes) {
        setAlterations(altRes.alterations || []);
        setAlterCandidates(altRes.candidates || []);
      }
      if (ttRes) {
        setAlterSlots(ttRes.slots || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load OD & Leave requests.');
    } finally {
      setLoading(false);
    }
  }, [token, isFacultyRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time refresh over WebSocket when requests or faculty alterations are updated
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: number | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/chat`);
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'auth', token }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (
            data.type === 'od_leave:created' ||
            data.type === 'od_leave:updated' ||
            data.type === 'faculty_alteration:changed'
          ) {
            loadData();
          }
        } catch {
          // ignore
        }
      };
      ws.onclose = () => {
        if (!closed) timer = window.setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, [token, loadData]);

  const activeFieldsForApplicant = useMemo(() => {
    if (!formConfig) return [];
    return formConfig.fields.filter(
      (f) => f.enabled && (f.appliesTo === 'all' || f.appliesTo === applicantCategory)
    );
  }, [formConfig, applicantCategory]);

  const totalDays = useMemo(() => countDaysInclusive(fromDate, toDate), [fromDate, toDate]);

  const canReviewRequest = useCallback(
    (req: OdLeaveRequestItem): boolean => {
      if (req.status === 'approved' || req.status === 'rejected') return false;
      if (req.applicantUserId === user.id && !isHod) return false;
      if (isHod) return req.status === 'pending_hod' || req.status === 'pending_advisor';
      if (isClassAdvisor) {
        return req.applicantCategory === 'student' && req.status === 'pending_advisor';
      }
      return false;
    },
    [isHod, isClassAdvisor, user.id]
  );

  const pendingActionCount = useMemo(
    () => requests.filter((r) => canReviewRequest(r)).length,
    [requests, canReviewRequest]
  );

  const pendingAlterationsCount = useMemo(
    () => alterations.filter((a) => a.status === 'pending_hod').length,
    [alterations]
  );

  const handleSubmitAlteration = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const chosenSub = alterSubName.trim();
    if (!chosenSub) {
      setError('Please select or type the substitute faculty name.');
      return;
    }
    const slot = selectedAlterSlotId
      ? alterSlots.find((s) => String(s.id) === selectedAlterSlotId) ?? null
      : null;
    const candidate = alterCandidates.find(
      (c) => c.fullName.toLowerCase() === chosenSub.toLowerCase()
    );
    setAlterSubmitting(true);
    try {
      await api.createFacultyAlteration(token, {
        timetableSlotId: slot?.id ?? null,
        alterationDate: alterDate,
        substituteFacultyName: chosenSub,
        substituteUserId: candidate?.userId ?? null,
        substituteEmail: candidate?.email ?? '',
        substitutePhone: candidate?.phone ?? '',
        reasonCategory: alterReason,
        reasonNote: alterNote.trim(),
        dayOfWeek: slot?.dayOfWeek ?? alterManualDay,
        periodNumber: slot?.periodNumber ?? alterManualPeriod,
        subjectCode: slot?.subjectCode ?? (alterManualSubject.trim().slice(0, 12) || 'ALT'),
        subjectName: slot?.subjectName ?? (alterManualSubject.trim() || 'Scheduled Lecture'),
        yearOfStudy: slot?.yearOfStudy ?? yearOfStudy,
        section: slot?.section ?? section,
        roomNo: slot?.roomNo ?? '',
      });
      setAlterSubName('');
      setAlterNote('');
      setAlterManualSubject('');
      setSelectedAlterSlotId('');
      setNotice(
        isHod
          ? `Faculty alteration approved & active (${chosenSub}).`
          : `Faculty alteration request sent to HOD for permission (${chosenSub}).`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit faculty alteration.');
    } finally {
      setAlterSubmitting(false);
    }
  };

  const handleDecideAlteration = async (id: number, decision: 'approve' | 'reject') => {
    setAlterDecidingId(id);
    setError(null);
    setNotice(null);
    try {
      await api.decideFacultyAlteration(token, id, decision, alterRemarksById[id] || '');
      setNotice(
        decision === 'approve'
          ? 'Faculty alteration approved and synced to timetable.'
          : 'Faculty alteration request rejected.'
      );
      await loadData();
      if (onAttendanceUpdated) onAttendanceUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update alteration request.');
    } finally {
      setAlterDecidingId(null);
    }
  };

  const filteredRequests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return requests.filter((r) => {
      if (typeFilter !== 'all' && r.requestType !== typeFilter) return false;
      if (statusFilter === 'action_needed' && !canReviewRequest(r)) return false;
      if (statusFilter === 'approved' && r.status !== 'approved') return false;
      if (statusFilter === 'rejected' && r.status !== 'rejected') return false;
      if (q) {
        const hay = `${r.applicantName} ${r.rollOrEmployeeId} ${r.mobileNumber} ${r.reason} ${r.yearOfStudy} ${r.section}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, typeFilter, statusFilter, searchQuery, canReviewRequest]);

  const handleUploadFile = async (file: File | undefined, kind: 'document' | 'photo') => {
    if (!file) return;
    setError(null);
    if (kind === 'document') setUploadingDoc(true);
    else setUploadingPhoto(true);

    try {
      const uploaded = await api.uploadOdLeaveAttachment(token, file, kind);
      if (kind === 'document') {
        setDocUpload({
          fileKey: uploaded.fileKey,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
        });
      } else {
        if (photoUpload?.localPreviewUrl) {
          URL.revokeObjectURL(photoUpload.localPreviewUrl);
        }
        setPhotoUpload({
          fileKey: uploaded.fileKey,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          localPreviewUrl: URL.createObjectURL(file),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File upload failed.');
    } finally {
      if (kind === 'document') setUploadingDoc(false);
      else setUploadingPhoto(false);
    }
  };

  const handleSubmitApplication = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      const res = await api.submitOdLeaveRequest(token, {
        requestType,
        applicantName: applicantName.trim(),
        rollOrEmployeeId: rollOrEmployeeId.trim().toUpperCase(),
        mobileNumber: mobileNumber.trim(),
        yearOfStudy: isStudent ? yearOfStudy.trim() : '',
        section: isStudent ? section.trim().toUpperCase() : '',
        fromDate,
        toDate,
        reason: reason.trim(),
        customFields: customValues,
        documentFileKey: docUpload?.fileKey || '',
        documentFileName: docUpload?.fileName || '',
        documentMimeType: docUpload?.mimeType || '',
        photoFileKey: photoUpload?.fileKey || '',
        photoFileName: photoUpload?.fileName || '',
        photoMimeType: photoUpload?.mimeType || '',
      });

      const nextStageLabel =
        res.request.status === 'pending_advisor'
          ? 'Routed to your Respected Class Advisor first, then HOD for final approval.'
          : 'Routed directly to HOD for approval.';

      setNotice(
        `${requestType === 'od' ? 'OD (On-Duty)' : 'Leave'} application #${res.request.id} submitted successfully! ${nextStageLabel}`
      );
      setReason('');
      setCustomValues({});
      setDocUpload(null);
      if (photoUpload?.localPreviewUrl) URL.revokeObjectURL(photoUpload.localPreviewUrl);
      setPhotoUpload(null);
      await loadData();
      setActiveTab('requests');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit application.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecision = async (reqItem: OdLeaveRequestItem, decision: 'approve' | 'reject') => {
    setError(null);
    setNotice(null);
    setDecidingId(reqItem.id);
    try {
      const remarks = remarksById[reqItem.id] ?? '';
      const res = await api.decideOdLeaveRequest(token, reqItem.id, { decision, remarks });
      const updated = res.request;
      if (decision === 'reject') {
        setNotice(`Request #${updated.id} (${updated.applicantName}) has been rejected.`);
      } else if (updated.status === 'pending_hod') {
        setNotice(
          `Class Advisor approved #${updated.id} (${updated.applicantName}) — forwarded to HOD for final permission.`
        );
      } else {
        const markText =
          updated.requestType === 'od'
            ? `Attendance marked as OD for ${updated.attendanceDaysMarked} day(s) (${updated.fromDate} to ${updated.toDate}).`
            : `Attendance marked as ABSENT (Approved Leave) for ${updated.attendanceDaysMarked} day(s) (${updated.fromDate} to ${updated.toDate}).`;
        setNotice(`HOD granted permission for #${updated.id} (${updated.applicantName}). ${markText}`);
        onAttendanceUpdated?.();
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process approval.');
    } finally {
      setDecidingId(null);
    }
  };

  const handleOpenAttachmentPreview = async (
    fileKey: string,
    fileName: string,
    mimeType: string
  ) => {
    try {
      const url = await api.fetchOdLeaveAttachmentBlobUrl(token, fileKey, fileName);
      const isImage = mimeType.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(fileName);
      setPreviewModal({ title: fileName, url, isImage });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview attachment.');
    }
  };

  const closePreviewModal = () => {
    if (previewModal?.url) URL.revokeObjectURL(previewModal.url);
    setPreviewModal(null);
  };

  // HOD Form Customizer Helpers
  const handleAddCustomField = () => {
    if (!draftConfig) return;
    const newField: OdLeaveFormFieldConfig = {
      id: `custom_${Date.now().toString(36)}`,
      label: 'New Custom Field',
      type: 'text',
      required: false,
      enabled: true,
      appliesTo: 'all',
      placeholder: 'Enter details',
      options: [],
    };
    setDraftConfig({ ...draftConfig, fields: [...draftConfig.fields, newField] });
  };

  const updateDraftField = (index: number, patch: Partial<OdLeaveFormFieldConfig>) => {
    if (!draftConfig) return;
    const next = draftConfig.fields.map((f, idx) => (idx === index ? { ...f, ...patch } : f));
    setDraftConfig({ ...draftConfig, fields: next });
  };

  const removeDraftField = (index: number) => {
    if (!draftConfig) return;
    setDraftConfig({
      ...draftConfig,
      fields: draftConfig.fields.filter((_, idx) => idx !== index),
    });
  };

  const handleSaveFormConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!draftConfig) return;
    setError(null);
    setNotice(null);
    setSavingConfig(true);
    try {
      const res = await api.updateOdLeaveFormConfig(token, {
        requireClassAdvisorForStudents: draftConfig.requireClassAdvisorForStudents,
        allowDocumentUpload: draftConfig.allowDocumentUpload,
        requireDocumentUploadForOd: draftConfig.requireDocumentUploadForOd,
        requireDocumentUploadForLeave: draftConfig.requireDocumentUploadForLeave,
        allowPhotoUpload: draftConfig.allowPhotoUpload,
        requirePhotoUpload: draftConfig.requirePhotoUpload,
        maxOdDays: draftConfig.maxOdDays,
        maxLeaveDays: draftConfig.maxLeaveDays,
        declarationText: draftConfig.declarationText,
        fields: draftConfig.fields,
      });
      setFormConfig(res.config);
      setDraftConfig(res.config);
      setNotice('OD & Leave application form customization saved and applied for all students and faculty.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save form customization.');
    } finally {
      setSavingConfig(false);
    }
  };

  const fieldLabelLookup = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of formConfig?.fields ?? []) {
      map[f.id] = f.label;
    }
    return map;
  }, [formConfig]);

  return (
    <div className="space-y-6">
      {/* Top Workflow Banner + Active Today Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-indigo-700" />
              <h2 className="text-base font-semibold text-slate-900">
                OD (On-Duty) & Leave Permission Portal
              </h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>Students:</strong> Routed through <strong>Respected Class Advisor</strong> →{' '}
              <strong>HOD</strong>. <strong>Department Faculty:</strong> Routed directly to{' '}
              <strong>HOD</strong>. Once granted, attendance is automatically marked as{' '}
              <span className="font-semibold text-indigo-700">OD</span> or{' '}
              <span className="font-semibold text-rose-700">Absent (Leave)</span> across every day
              until the granted end date.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('apply')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'apply'
                  ? 'bg-white text-indigo-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Apply OD / Leave
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'requests'
                  ? 'bg-white text-indigo-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{isHod || isClassAdvisor ? 'Approval Queue & Logs' : 'My Applications'}</span>
              {pendingActionCount > 0 && (
                <span className="font-mono text-[11px] font-semibold text-amber-700">
                  ({pendingActionCount})
                </span>
              )}
            </button>
            {isFacultyRole && (
              <button
                type="button"
                onClick={() => setActiveTab('alterations')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeTab === 'alterations'
                    ? 'bg-white text-indigo-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <span>Alter Faculty</span>
                {isHod && pendingAlterationsCount > 0 && (
                  <span className="font-mono text-[11px] font-semibold text-amber-700">
                    ({pendingAlterationsCount})
                  </span>
                )}
              </button>
            )}
            {isHod && (
              <button
                type="button"
                onClick={() => setActiveTab('customize')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeTab === 'customize'
                    ? 'bg-white text-indigo-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Customize Form (HOD)
              </button>
            )}
          </div>
        </div>

        {/* Active Granted OD / Leave Today */}
        {activeToday.length > 0 && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
              Active Granted OD / Leave Today ({serverDate}) — Auto-Marked in Attendance
            </div>
            <div className="flex flex-wrap gap-2">
              {activeToday.map((item) => (
                <div
                  key={item.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                    item.requestType === 'od'
                      ? 'bg-indigo-50 border-indigo-200 text-indigo-950'
                      : 'bg-rose-50 border-rose-200 text-rose-950'
                  }`}
                >
                  <span className="font-semibold">
                    {item.requestType === 'od' ? 'OD' : 'ABSENT (LEAVE)'}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="font-medium">{item.applicantName}</span>
                  <span className="font-mono text-[11px] opacity-80">({item.rollOrEmployeeId})</span>
                  <span className="font-mono text-[11px] opacity-75">
                    until {item.toDate}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="w-4 h-4 text-rose-500" />
          </button>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X className="w-4 h-4 text-emerald-500" />
          </button>
        </div>
      )}

      {/* ============================================================
          TAB 1: APPLY FOR OD / LEAVE
      ============================================================ */}
      {activeTab === 'apply' && (
        <form
          onSubmit={handleSubmitApplication}
          className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {isStudent
                  ? 'Student OD / Leave Application Form'
                  : 'Department Faculty OD / Leave Application Form'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isStudent && formConfig?.requireClassAdvisorForStudents
                  ? 'Approval Route: Step 1 Class Advisor → Step 2 HOD Final Permission'
                  : 'Approval Route: Direct HOD Permission'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => setRequestType('od')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors ${
                  requestType === 'od'
                    ? 'bg-indigo-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                On-Duty (OD)
              </button>
              <button
                type="button"
                onClick={() => setRequestType('leave')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-md transition-colors ${
                  requestType === 'leave'
                    ? 'bg-rose-700 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Leave (Absent)
              </button>
            </div>
          </div>

          {/* Core Required Identity & Date Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Full Name <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                placeholder="Applicant full name"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {isStudent ? 'Roll Number' : 'Employee / Staff ID'}{' '}
                <span className="text-rose-600">*</span>
              </label>
              <input
                type="text"
                required
                value={rollOrEmployeeId}
                onChange={(e) => setRollOrEmployeeId(e.target.value)}
                placeholder={isStudent ? 'e.g. 23EIE014' : 'e.g. ESEC-EIE-04'}
                className="w-full px-3 py-2 text-sm font-mono uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Mobile Number <span className="text-rose-600">*</span>
              </label>
              <input
                type="tel"
                required
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
              />
            </div>

            {isStudent && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Year of Study
                  </label>
                  <select
                    value={yearOfStudy}
                    onChange={(e) => setYearOfStudy(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  >
                    <option value="I Year">I Year</option>
                    <option value="II Year">II Year</option>
                    <option value="III Year">III Year</option>
                    <option value="IV Year">IV Year</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Section</label>
                  <input
                    type="text"
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    placeholder="A"
                    maxLength={8}
                    className="w-full px-3 py-2 text-sm uppercase border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-2.5 sm:col-span-2 lg:col-span-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  From Date <span className="text-rose-600">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    if (toDate < e.target.value) setToDate(e.target.value);
                  }}
                  className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  To Date <span className="text-rose-600">*</span>
                </label>
                <input
                  type="date"
                  required
                  min={fromDate}
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <CalendarDays className="w-4 h-4 text-indigo-700 shrink-0" />
            <span>
              Requested Duration:{' '}
              <strong className="font-mono">{totalDays} day(s)</strong> (Max allowed by HOD:{' '}
              <strong className="font-mono">
                {requestType === 'od'
                  ? formConfig?.maxOdDays ?? 10
                  : formConfig?.maxLeaveDays ?? 15}{' '}
                days
              </strong>
              )
            </span>
            <span className="text-slate-300">·</span>
            <span>
              Attendance Auto-Mark upon HOD Approval:{' '}
              <strong
                className={requestType === 'od' ? 'text-indigo-700' : 'text-rose-700'}
              >
                {requestType === 'od'
                  ? 'Marked as OD (On-Duty)'
                  : 'Marked as ABSENT (Approved Leave)'}
              </strong>
            </span>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Detailed Reason for {requestType === 'od' ? 'On-Duty (OD)' : 'Leave'}{' '}
              <span className="text-rose-600">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                requestType === 'od'
                  ? 'Specify event name, participating college/organization, competition or official academic duty details...'
                  : 'Specify personal, medical, or family reason for leave...'
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
            />
          </div>

          {/* HOD-Customized Extra Fields */}
          {activeFieldsForApplicant.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Department Required Details (Configured by HOD)
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeFieldsForApplicant.map((field) => (
                  <div
                    key={field.id}
                    className={field.type === 'textarea' ? 'sm:col-span-2' : ''}
                  >
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {field.label}{' '}
                      {field.required && <span className="text-rose-600">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        rows={2}
                        required={field.required}
                        value={customValues[field.id] ?? ''}
                        onChange={(e) =>
                          setCustomValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    ) : field.type === 'select' ? (
                      <select
                        required={field.required}
                        value={customValues[field.id] ?? ''}
                        onChange={(e) =>
                          setCustomValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="">{field.placeholder || 'Select an option'}</option>
                        {field.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'phone' ? 'tel' : field.type}
                        required={field.required}
                        value={customValues[field.id] ?? ''}
                        onChange={(e) =>
                          setCustomValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Supporting Document & Proof Photo Upload Section */}
          {(formConfig?.allowDocumentUpload !== false || formConfig?.allowPhotoUpload !== false) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              {formConfig?.allowDocumentUpload !== false && (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <FileText className="w-4 h-4 text-indigo-700" />
                      <span>
                        Supporting Document / Letter
                        {((requestType === 'od' && formConfig?.requireDocumentUploadForOd) ||
                          (requestType === 'leave' && formConfig?.requireDocumentUploadForLeave)) && (
                          <span className="text-rose-600"> *</span>
                        )}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">PDF, DOCX, JPG, PNG</span>
                  </div>

                  {docUpload ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs">
                      <span className="truncate font-medium text-emerald-900">
                        {docUpload.fileName}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDocUpload(null)}
                        className="text-slate-400 hover:text-rose-600 shrink-0"
                        aria-label="Remove uploaded document"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 px-3 py-3 border border-dashed border-slate-300 hover:border-indigo-400 bg-white rounded-lg cursor-pointer text-xs font-medium text-slate-700 transition-colors">
                      <Upload className="w-4 h-4 text-indigo-600" />
                      <span>
                        {uploadingDoc ? 'Uploading file...' : 'Choose Brochure, Letter, or Medical Cert'}
                      </span>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp"
                        className="hidden"
                        disabled={uploadingDoc}
                        onChange={(e) => {
                          handleUploadFile(e.target.files?.[0], 'document');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              )}

              {formConfig?.allowPhotoUpload !== false && (
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                      <Camera className="w-4 h-4 text-amber-600" />
                      <span>
                        Photo Proof / Permission Letter Photo
                        {formConfig?.requirePhotoUpload && (
                          <span className="text-rose-600"> *</span>
                        )}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">Camera or Image</span>
                  </div>

                  {photoUpload ? (
                    <div className="flex items-center gap-3 p-2 bg-white border border-emerald-200 rounded-lg">
                      <img
                        src={photoUpload.localPreviewUrl}
                        alt="Proof preview"
                        className="w-12 h-12 rounded object-cover border border-slate-200 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-emerald-900 truncate">
                          {photoUpload.fileName}
                        </div>
                        <div className="text-[11px] text-slate-500">Attached photo proof</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(photoUpload.localPreviewUrl);
                          setPhotoUpload(null);
                        }}
                        className="text-slate-400 hover:text-rose-600 shrink-0 p-1"
                        aria-label="Remove proof photo"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 px-3 py-3 border border-dashed border-slate-300 hover:border-amber-400 bg-white rounded-lg cursor-pointer text-xs font-medium text-slate-700 transition-colors">
                      <ImageIcon className="w-4 h-4 text-amber-600" />
                      <span>
                        {uploadingPhoto ? 'Uploading photo...' : 'Upload or Capture Proof Photo'}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingPhoto}
                        onChange={(e) => {
                          handleUploadFile(e.target.files?.[0], 'photo');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Declaration + Submit */}
          {formConfig?.declarationText && (
            <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-950 leading-relaxed">
              <strong>Declaration:</strong> {formConfig.declarationText}
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={submitting || uploadingDoc || uploadingPhoto || totalDays <= 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors"
            >
              <FileCheck2 className="w-4 h-4" />
              {submitting
                ? 'Submitting Application...'
                : `Submit ${requestType === 'od' ? 'OD (On-Duty)' : 'Leave'} Request`}
            </button>
          </div>
        </form>
      )}

      {/* ============================================================
          TAB 2: REQUESTS & MULTI-STAGE APPROVAL QUEUE
      ============================================================ */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, roll/emp ID, mobile, or reason..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'od' | 'leave')}
                className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="all">All Types (OD & Leave)</option>
                <option value="od">OD (On-Duty) Only</option>
                <option value="leave">Leave Only</option>
              </select>

              <div className="inline-flex bg-slate-100 p-0.5 rounded-lg">
                {(
                  [
                    { id: 'all', label: 'All' },
                    ...(isHod || isClassAdvisor
                      ? [{ id: 'action_needed' as const, label: `Action (${pendingActionCount})` }]
                      : []),
                    { id: 'approved', label: 'Granted' },
                    { id: 'rejected', label: 'Rejected' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStatusFilter(item.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      statusFilter === item.id
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

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Loading OD & Leave applications...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800">No OD or Leave applications found</p>
              <p className="text-xs text-slate-500">
                Submit a new request using the &quot;Apply OD / Leave&quot; tab or adjust your filters.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((req) => {
                const reviewable = canReviewRequest(req);
                const statusBadge =
                  req.status === 'approved'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : req.status === 'rejected'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : req.status === 'pending_hod'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-sky-50 text-sky-800 border-sky-200';
                const statusLabel =
                  req.status === 'approved'
                    ? 'Permission Granted'
                    : req.status === 'rejected'
                    ? 'Rejected'
                    : req.status === 'pending_hod'
                    ? 'Awaiting HOD Approval'
                    : 'Awaiting Class Advisor';

                return (
                  <div
                    key={req.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
                  >
                    {/* Header Row */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded border ${
                              req.requestType === 'od'
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            {req.requestType === 'od' ? 'On-Duty (OD)' : 'Leave'}
                          </span>
                          <span className="text-sm font-semibold text-slate-900">
                            {req.applicantName}
                          </span>
                          <span className="font-mono text-xs text-slate-600">
                            {req.rollOrEmployeeId}
                          </span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-600">
                            {ROLE_LABELS[req.applicantRole as UserRole] ?? req.applicantRole}
                          </span>
                          {req.yearOfStudy && (
                            <span className="text-xs text-slate-500">
                              ({req.yearOfStudy} {req.section})
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                          <span className="font-mono font-medium text-slate-800">
                            {req.fromDate} → {req.toDate} ({req.totalDays}{' '}
                            {req.totalDays === 1 ? 'day' : 'days'})
                          </span>
                          <span>·</span>
                          <span>Mobile: {req.mobileNumber}</span>
                          <span>·</span>
                          <span className="text-slate-400">Applied {req.createdAt}</span>
                        </div>
                      </div>

                      <span
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border whitespace-nowrap self-start ${statusBadge}`}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    {/* Reason & Custom Fields */}
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2.5">
                      <p className="text-xs text-slate-800 leading-relaxed">
                        <strong className="text-slate-900">Reason:</strong> {req.reason}
                      </p>

                      {Object.keys(req.customFields).length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-slate-200/70">
                          {Object.entries(req.customFields).map(([k, v]) => (
                            <div key={k} className="text-xs">
                              <span className="text-slate-500">
                                {fieldLabelLookup[k] || k.replace(/_/g, ' ')}:{' '}
                              </span>
                              <span className="font-medium text-slate-800">{v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Attachments */}
                      {(req.documentFileKey || req.photoFileKey) && (
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/70">
                          {req.documentFileKey && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs">
                              <FileText className="w-3.5 h-3.5 text-indigo-600" />
                              <span className="max-w-[180px] truncate text-slate-700">
                                {req.documentFileName || 'Document'}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  api.downloadOdLeaveAttachment(
                                    token,
                                    req.documentFileKey,
                                    req.documentFileName || 'document'
                                  )
                                }
                                className="text-indigo-700 hover:underline font-medium inline-flex items-center gap-0.5 ml-1"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                            </div>
                          )}

                          {req.photoFileKey && (
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-md text-xs">
                              <ImageIcon className="w-3.5 h-3.5 text-amber-600" />
                              <span className="max-w-[160px] truncate text-slate-700">
                                {req.photoFileName || 'Proof Photo'}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenAttachmentPreview(
                                    req.photoFileKey,
                                    req.photoFileName || 'Proof Photo',
                                    req.photoMimeType
                                  )
                                }
                                className="text-indigo-700 hover:underline font-medium inline-flex items-center gap-0.5 ml-1"
                              >
                                <Eye className="w-3 h-3" />
                                View
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 2-Stage Approval Chain Status */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      {req.applicantCategory === 'student' && (
                        <div className="p-3 rounded-lg border border-slate-200 bg-white flex items-start gap-2.5">
                          <UserCheck
                            className={`w-4 h-4 shrink-0 mt-0.5 ${
                              req.advisorStatus === 'approved'
                                ? 'text-emerald-600'
                                : req.advisorStatus === 'rejected'
                                ? 'text-rose-600'
                                : 'text-sky-600'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">
                              Stage 1: Class Advisor ({req.advisorStatus.replace('_', ' ')})
                            </div>
                            {req.advisorReviewedBy ? (
                              <div className="text-slate-600 mt-0.5">
                                By {req.advisorReviewedBy}
                                {req.advisorRemarks ? ` — "${req.advisorRemarks}"` : ''}
                              </div>
                            ) : (
                              <div className="text-slate-500 mt-0.5">
                                {req.advisorStatus === 'not_required'
                                  ? 'Bypassed per HOD form policy'
                                  : 'Waiting for respected Class Advisor review'}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div
                        className={`p-3 rounded-lg border border-slate-200 bg-white flex items-start gap-2.5 ${
                          req.applicantCategory === 'faculty' ? 'sm:col-span-2' : ''
                        }`}
                      >
                        <ShieldCheck
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            req.hodStatus === 'approved'
                              ? 'text-emerald-600'
                              : req.hodStatus === 'rejected'
                              ? 'text-rose-600'
                              : 'text-amber-600'
                          }`}
                        />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {req.applicantCategory === 'student'
                              ? `Stage 2: HOD Final Permission (${req.hodStatus})`
                              : `HOD Direct Permission (${req.hodStatus})`}
                          </div>
                          {req.hodReviewedBy ? (
                            <div className="text-slate-600 mt-0.5">
                              By {req.hodReviewedBy}
                              {req.hodRemarks ? ` — "${req.hodRemarks}"` : ''}
                            </div>
                          ) : (
                            <div className="text-slate-500 mt-0.5">
                              Waiting for HOD final approval
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Auto-Attendance Marked Confirmation */}
                    {req.status === 'approved' && req.attendanceMarkedStatus && (
                      <div
                        className={`px-3.5 py-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                          req.attendanceMarkedStatus === 'od'
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-950'
                            : 'bg-rose-50 border-rose-200 text-rose-950'
                        }`}
                      >
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>
                          Attendance automatically synced:{' '}
                          <strong>
                            {req.attendanceMarkedStatus === 'od'
                              ? 'Marked as OD (On-Duty)'
                              : 'Marked as ABSENT (Approved Leave)'}
                          </strong>{' '}
                          for <strong>{req.attendanceDaysMarked} day(s)</strong> ({req.fromDate} to{' '}
                          {req.toDate}).
                        </span>
                      </div>
                    )}

                    {/* Approval Action Bar (Class Advisor / HOD) */}
                    {reviewable && (
                      <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center gap-2.5">
                        <input
                          type="text"
                          value={remarksById[req.id] ?? ''}
                          onChange={(e) =>
                            setRemarksById((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder={
                            isClassAdvisor
                              ? 'Optional Class Advisor remarks before forwarding to HOD...'
                              : 'Optional HOD approval / rejection remarks...'
                          }
                          maxLength={240}
                          className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={decidingId === req.id}
                            onClick={() => handleDecision(req, 'approve')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {decidingId === req.id
                              ? 'Saving...'
                              : isClassAdvisor
                              ? 'Approve & Forward to HOD'
                              : req.requestType === 'od'
                              ? 'Grant OD & Mark Attendance'
                              : 'Grant Leave & Mark Absent'}
                          </button>
                          <button
                            type="button"
                            disabled={decidingId === req.id}
                            onClick={() => handleDecision(req, 'reject')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-50 rounded-lg whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================
          TAB 3: HOD CUSTOMIZE APPLICATION FORM & POLICIES
      ============================================================ */}
      {activeTab === 'customize' && isHod && draftConfig && (
        <form
          onSubmit={handleSaveFormConfig}
          className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-indigo-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  HOD OD & Leave Application Form Customizer
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Customize approval rules, mandatory uploads, day limits, and custom input fields for
                both students and department faculty.
              </p>
            </div>
            {formConfig?.updatedAt && (
              <span className="text-[11px] font-mono text-slate-500">
                Last updated: {formConfig.updatedAt}
              </span>
            )}
          </div>

          {/* Workflow & Upload Policies */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Approval Workflow & Duration Limits
              </h4>
              <label className="flex items-start gap-2.5 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftConfig.requireClassAdvisorForStudents}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      requireClassAdvisorForStudents: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded border-slate-300 text-indigo-700"
                />
                <span>
                  <strong>Require Class Advisor approval first for Students</strong> (Faculty always
                  route directly to HOD)
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Max OD Days / Request
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draftConfig.maxOdDays}
                    onChange={(e) =>
                      setDraftConfig({ ...draftConfig, maxOdDays: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Max Leave Days / Request
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={draftConfig.maxLeaveDays}
                    onChange={(e) =>
                      setDraftConfig({
                        ...draftConfig,
                        maxLeaveDays: Number(e.target.value) || 1,
                      })
                    }
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                File & Photo Upload Rules
              </h4>
              <label className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftConfig.allowDocumentUpload}
                  onChange={(e) =>
                    setDraftConfig({ ...draftConfig, allowDocumentUpload: e.target.checked })
                  }
                  className="rounded border-slate-300 text-indigo-700"
                />
                <span>Allow Supporting Document Upload (PDF / DOCX / Image)</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 pl-5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!draftConfig.allowDocumentUpload}
                  checked={draftConfig.requireDocumentUploadForOd}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      requireDocumentUploadForOd: e.target.checked,
                    })
                  }
                  className="rounded border-slate-300 text-indigo-700"
                />
                <span>Mandatory document for OD requests</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 pl-5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!draftConfig.allowDocumentUpload}
                  checked={draftConfig.requireDocumentUploadForLeave}
                  onChange={(e) =>
                    setDraftConfig({
                      ...draftConfig,
                      requireDocumentUploadForLeave: e.target.checked,
                    })
                  }
                  className="rounded border-slate-300 text-indigo-700"
                />
                <span>Mandatory document for Leave requests</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-800 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftConfig.allowPhotoUpload}
                  onChange={(e) =>
                    setDraftConfig({ ...draftConfig, allowPhotoUpload: e.target.checked })
                  }
                  className="rounded border-slate-300 text-indigo-700"
                />
                <span>Allow Photo Proof / Letter Snapshot Upload</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 pl-5 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!draftConfig.allowPhotoUpload}
                  checked={draftConfig.requirePhotoUpload}
                  onChange={(e) =>
                    setDraftConfig({ ...draftConfig, requirePhotoUpload: e.target.checked })
                  }
                  className="rounded border-slate-300 text-indigo-700"
                />
                <span>Make proof photo mandatory</span>
              </label>
            </div>
          </div>

          {/* Declaration Text */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Applicant Declaration Statement
            </label>
            <textarea
              rows={2}
              value={draftConfig.declarationText}
              onChange={(e) =>
                setDraftConfig({ ...draftConfig, declarationText: e.target.value })
              }
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Dynamic Custom Fields List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Customizable Extra Application Fields ({draftConfig.fields.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Core fields (Name, Roll/Emp ID, Mobile, Dates, Reason) are always included. Add or
                  edit extra department fields below.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddCustomField}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom Field
              </button>
            </div>

            <div className="space-y-3">
              {draftConfig.fields.map((field, idx) => (
                <div
                  key={field.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Field Label
                      </label>
                      <input
                        type="text"
                        required
                        value={field.label}
                        onChange={(e) => updateDraftField(idx, { label: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Input Type
                      </label>
                      <select
                        value={field.type}
                        onChange={(e) =>
                          updateDraftField(idx, { type: e.target.value as OdLeaveFieldType })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      >
                        <option value="text">Short Text</option>
                        <option value="textarea">Long Paragraph</option>
                        <option value="phone">Phone Number</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                        <option value="select">Dropdown Select</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Show For
                      </label>
                      <select
                        value={field.appliesTo}
                        onChange={(e) =>
                          updateDraftField(idx, {
                            appliesTo: e.target.value as 'all' | 'student' | 'faculty',
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      >
                        <option value="all">Both Students & Faculty</option>
                        <option value="student">Students Only</option>
                        <option value="faculty">Department Faculty Only</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Placeholder Hint
                      </label>
                      <input
                        type="text"
                        value={field.placeholder}
                        onChange={(e) => updateDraftField(idx, { placeholder: e.target.value })}
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      />
                    </div>
                  </div>

                  {field.type === 'select' && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Dropdown Options (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={field.options.join(', ')}
                        onChange={(e) =>
                          updateDraftField(idx, {
                            options: e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="Option 1, Option 2, Option 3"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-4 text-xs text-slate-700">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={(e) => updateDraftField(idx, { enabled: e.target.checked })}
                          className="rounded border-slate-300 text-indigo-700"
                        />
                        <span>Enabled</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateDraftField(idx, { required: e.target.checked })}
                          className="rounded border-slate-300 text-indigo-700"
                        />
                        <span>Required</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDraftField(idx)}
                      className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="submit"
              disabled={savingConfig}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {savingConfig ? 'Saving Customization...' : 'Save HOD Form Customization'}
            </button>
          </div>
        </form>
      )}

      {/* Faculty Alteration Tab (Busy / OD / Absent -> HOD Permission) */}
      {activeTab === 'alterations' && isFacultyRole && (
        <div className="space-y-5">
          <form
            onSubmit={handleSubmitAlteration}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-indigo-700" />
                  Request Faculty Class Alteration
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Alter your assigned period with another faculty when Busy, On Duty (OD), or Absent. All requests route to HOD for permission.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              <label className="space-y-1">
                <span className="block font-medium text-slate-700">Scheduled Period (Optional)</span>
                <select
                  value={selectedAlterSlotId}
                  onChange={(e) => setSelectedAlterSlotId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                >
                  <option value="">-- Enter custom class / period --</option>
                  {alterSlots.map((slot) => (
                    <option key={slot.id} value={String(slot.id)}>
                      {slot.dayOfWeek} · Hr {slot.periodNumber} ({slot.startTime}–{slot.endTime}) · {slot.subjectCode} ({slot.facultyName})
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700">Alteration Date</span>
                <input
                  type="date"
                  required
                  value={alterDate}
                  onChange={(e) => setAlterDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                />
              </label>

              <label className="space-y-1">
                <span className="block font-medium text-slate-700">Reason Category</span>
                <select
                  value={alterReason}
                  onChange={(e) => setAlterReason(e.target.value as 'busy' | 'od' | 'absent')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                >
                  <option value="busy">Busy / Official Work</option>
                  <option value="od">On Duty (OD)</option>
                  <option value="absent">Absent / Leave</option>
                </select>
              </label>

              {!selectedAlterSlotId && (
                <>
                  <label className="space-y-1">
                    <span className="block font-medium text-slate-700">Day of Week</span>
                    <select
                      value={alterManualDay}
                      onChange={(e) => setAlterManualDay(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                    >
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="block font-medium text-slate-700">Period / Hour (1–12)</span>
                    <select
                      value={alterManualPeriod}
                      onChange={(e) => setAlterManualPeriod(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p}>
                          Hr {p}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="block font-medium text-slate-700">Subject / Class Name</span>
                    <input
                      type="text"
                      value={alterManualSubject}
                      onChange={(e) => setAlterManualSubject(e.target.value)}
                      placeholder="e.g. EI3401 Process Control"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                    />
                  </label>
                </>
              )}

              <label className="space-y-1">
                <span className="block font-medium text-slate-700">Substitute Faculty *</span>
                <input
                  type="text"
                  required
                  list="od-alter-candidates"
                  value={alterSubName}
                  onChange={(e) => setAlterSubName(e.target.value)}
                  placeholder="Select or type substitute faculty..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                />
                <datalist id="od-alter-candidates">
                  {alterCandidates.map((c, idx) => (
                    <option key={idx} value={c.fullName}>
                      {c.designation || c.role}
                    </option>
                  ))}
                </datalist>
              </label>

              <label className="space-y-1 sm:col-span-2">
                <span className="block font-medium text-slate-700">Reason / Coordination Note for HOD</span>
                <input
                  type="text"
                  value={alterNote}
                  onChange={(e) => setAlterNote(e.target.value)}
                  placeholder="e.g. Lab inspection / OD at Anna University; substitute faculty confirmed"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                />
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={alterSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-semibold disabled:opacity-60"
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                {alterSubmitting
                  ? 'Submitting...'
                  : isHod
                  ? 'Approve & Apply Alteration'
                  : 'Request HOD Permission'}
              </button>
            </div>
          </form>

          {/* Alterations List & HOD Approval Queue */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Faculty Alterations Log ({alterations.length})
              </h4>
              {isHod && pendingAlterationsCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[11px] font-semibold">
                  {pendingAlterationsCount} Pending HOD Approval
                </span>
              )}
            </div>

            {alterations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No faculty alteration requests recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {alterations.map((alt) => (
                  <div key={alt.id} className="p-4 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {alt.requestingFacultyName} → {alt.substituteFacultyName}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px] uppercase">
                          {alt.reasonCategory}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded font-semibold text-[10px] uppercase ${
                            alt.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : alt.status === 'rejected'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {alt.status === 'pending_hod' ? 'Pending HOD' : alt.status}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">
                        {alt.alterationDate} · {alt.dayOfWeek} Hr {alt.periodNumber}
                      </span>
                    </div>

                    <div className="text-slate-600">
                      <span className="font-mono font-semibold text-indigo-800">{alt.subjectCode}</span>{' '}
                      {alt.subjectName} · {alt.yearOfStudy} Sec {alt.section}
                      {alt.roomNo ? ` · Room ${alt.roomNo}` : ''}
                    </div>
                    {alt.reasonNote && (
                      <p className="text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5">
                        {alt.reasonNote}
                      </p>
                    )}
                    {alt.hodReviewedBy && (
                      <p className="text-[11px] text-slate-500">
                        Reviewed by {alt.hodReviewedBy}
                        {alt.hodRemarks ? ` — "${alt.hodRemarks}"` : ''}
                      </p>
                    )}

                    {isHod && alt.status === 'pending_hod' && (
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <input
                          type="text"
                          value={alterRemarksById[alt.id] || ''}
                          onChange={(e) =>
                            setAlterRemarksById((prev) => ({ ...prev, [alt.id]: e.target.value }))
                          }
                          placeholder="Optional HOD remarks..."
                          className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={alterDecidingId === alt.id}
                            onClick={() => handleDecideAlteration(alt.id, 'approve')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold disabled:opacity-60"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={alterDecidingId === alt.id}
                            onClick={() => handleDecideAlteration(alt.id, 'reject')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-60"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Attachment Preview Modal */}
      {previewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-xl max-w-2xl w-full overflow-hidden shadow-2xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 truncate">
                {previewModal.title}
              </span>
              <button
                type="button"
                onClick={closePreviewModal}
                className="p-1 text-slate-500 hover:text-slate-900"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center max-h-[75vh] overflow-auto">
              {previewModal.isImage ? (
                <img
                  src={previewModal.url}
                  alt={previewModal.title}
                  className="max-w-full max-h-[68vh] rounded-lg object-contain"
                />
              ) : (
                <iframe
                  src={previewModal.url}
                  title={previewModal.title}
                  className="w-full h-[65vh] rounded border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
