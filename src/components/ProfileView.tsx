import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Crown,
  IdCard,
  KeyRound,
  Lock,
  Mail,
  Phone,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Unlock,
  Upload,
  User as UserIcon,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import type {
  BiometricLockUserSummary,
  BiometricUnlockRequestItem,
  HodDelegationInfo,
  UserProfile,
} from '../types';

interface ProfileViewProps {
  user: UserProfile;
  token: string;
  onUserUpdated: (user: UserProfile) => void;
}

const ROLE_LABEL: Record<string, string> = {
  hod: 'Head of Department (HOD)',
  class_advisor: 'Class Advisor',
  dept_staff: 'Department Faculty',
  other_dept_staff: 'Visiting / Other-Dept Faculty',
  class_rep: 'Class Representative (CR)',
  student: 'Student',
};

export function ProfileView({ user, token, onUserUpdated }: ProfileViewProps) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone || '');
  const [designation, setDesignation] = useState(user.designation || '');
  const [specialization, setSpecialization] = useState(user.specialization || '');
  const [bio, setBio] = useState(user.bio || '');
  const [transitBuffer, setTransitBuffer] = useState(user.transitBufferMinutes ?? 15);
  const [photoPreview, setPhotoPreview] = useState(user.profileImageData || '');

  const [savingProfile, setSavingProfile] = useState(false);
  const [lockingFace, setLockingFace] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Camera capture state for unregistered users
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // HOD delegation state
  const [activeDelegation, setActiveDelegation] = useState<HodDelegationInfo | null>(
    user.delegationInfo ?? null
  );
  const [delegationCandidates, setDelegationCandidates] = useState<UserProfile[]>([]);
  const [selectedDelegateId, setSelectedDelegateId] = useState<number | ''>('');
  const [delegationReason, setDelegationReason] = useState('HOD on Official Leave');
  const [delegating, setDelegating] = useState(false);

  // Institutional password setup / update state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Biometric Unlock Permission state (Students, Faculty & HOD)
  const [unlockRequests, setUnlockRequests] = useState<BiometricUnlockRequestItem[]>([]);
  const [biometricUsers, setBiometricUsers] = useState<BiometricLockUserSummary[]>([]);
  const [unlockReason, setUnlockReason] = useState('');
  const [requestingUnlock, setRequestingUnlock] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<number | null>(null);
  const [decidingReqId, setDecidingReqId] = useState<string | null>(null);
  const [bioSearch, setBioSearch] = useState('');
  const [bioRoleFilter, setBioRoleFilter] = useState<'all' | 'students' | 'faculty_hod'>('all');

  useEffect(() => {
    setFullName(user.fullName);
    setPhone(user.phone || '');
    setDesignation(user.designation || '');
    setSpecialization(user.specialization || '');
    setBio(user.bio || '');
    setTransitBuffer(user.transitBufferMinutes ?? 15);
    setPhotoPreview(user.profileImageData || '');
  }, [user]);

  const loadBiometricGovernance = useCallback(async () => {
    try {
      const res = await api.getBiometricUnlockState(token);
      setUnlockRequests(res.requests || []);
      setBiometricUsers(res.users || []);
    } catch {
      // Non-blocking
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    api
      .getHodDelegation(token)
      .then((res) => {
        if (!active) return;
        setActiveDelegation(res.activeDelegation);
        setDelegationCandidates(res.candidates);
      })
      .catch(() => null);
    void loadBiometricGovernance();
    return () => {
      active = false;
    };
  }, [token, user.role, loadBiometricGovernance]);

  // Live WS sync for HOD biometric unlock grants/requests
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
          if (data.type === 'biometric:unlock_changed') {
            void loadBiometricGovernance();
            if (data.userId === user.id) {
              api
                .getMyProfile(token)
                .then((r) => onUserUpdated(r.user))
                .catch(() => null);
            }
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
  }, [token, user.id, loadBiometricGovernance, onUserUpdated]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const startCamera = async () => {
    if (user.faceRegisteredLocked) return;
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to access device camera.'
      );
    }
  };

  const captureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setPhotoPreview(canvas.toDataURL('image/jpeg', 0.85));
    }
    stopCamera();
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (user.faceRegisteredLocked) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      setErrorMessage('Profile image must be under 2.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || fullName.trim().length < 2) {
      setErrorMessage('Full name must be at least 2 characters.');
      return;
    }
    setSavingProfile(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const payload: Parameters<typeof api.updateMyProfile>[1] = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        designation: designation.trim(),
        specialization: specialization.trim(),
        bio: bio.trim(),
        transitBufferMinutes: transitBuffer,
      };
      if (!user.faceRegisteredLocked && photoPreview) {
        payload.profileImageData = photoPreview;
      }
      const res = await api.updateMyProfile(token, payload);
      onUserUpdated(res.user);
      setStatusMessage('Profile details updated across the portal & records directory.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save profile changes.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLockFacePhoto = async () => {
    if (!photoPreview || !photoPreview.startsWith('data:image/')) {
      setErrorMessage('Capture or upload a clear portrait image first before locking face registration.');
      return;
    }
    setLockingFace(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.registerAndLockFace(token, photoPreview);
      onUserUpdated(res.user);
      setStatusMessage(
        'Face registration photo saved and permanently locked for attendance verification.'
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to lock face photo.');
    } finally {
      setLockingFace(false);
    }
  };

  const handleDelegateHod = async () => {
    if (!selectedDelegateId) {
      setErrorMessage('Choose a faculty member or Class Advisor to transfer HOD control.');
      return;
    }
    setDelegating(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.delegateHodControl(token, {
        delegateUserId: Number(selectedDelegateId),
        reason: delegationReason.trim() || 'HOD on Leave — Acting HOD Delegation',
      });
      setActiveDelegation(res.delegation);
      onUserUpdated(res.user);
      setStatusMessage(
        `Full HOD control transferred to ${res.delegation.delegateName}. You can restore control anytime.`
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to delegate HOD control.');
    } finally {
      setDelegating(false);
    }
  };

  const handleRestoreHod = async () => {
    setDelegating(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.restoreHodControl(token);
      setActiveDelegation(null);
      onUserUpdated(res.user);
      setStatusMessage('Original HOD role and governance control restored successfully.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to restore HOD control.');
    } finally {
      setDelegating(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setStatusMessage(null);
    if (newPassword.length < 6) {
      setErrorMessage('New institutional password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation do not match.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await api.updateMyPassword(token, {
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatusMessage(
        res.message || 'Institutional password saved. You can now sign in with email or Roll / Employee ID.'
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to save password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRequestBiometricUnlock = async () => {
    setRequestingUnlock(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await api.requestBiometricUnlock(
        token,
        unlockReason.trim() || 'Requesting HOD permission to unlock & retake biometric photo'
      );
      setUnlockReason('');
      setStatusMessage('Biometric photo unlock request sent to HOD for permission.');
      await loadBiometricGovernance();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to send unlock request.');
    } finally {
      setRequestingUnlock(false);
    }
  };

  const handleHodToggleBiometricLock = async (targetUserId: number, nextLocked: boolean) => {
    setTogglingUserId(targetUserId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.setHodBiometricLock(token, {
        targetUserId,
        locked: nextLocked,
        remarks: nextLocked
          ? 'Re-locked by HOD'
          : 'HOD permission granted to unlock & retake biometric photo',
      });
      if (targetUserId === user.id) {
        onUserUpdated(res.user);
      }
      setStatusMessage(
        nextLocked
          ? `Biometric photo locked for ${res.user.fullName}.`
          : `Biometric photo unlocked for ${res.user.fullName}. They can now retake and re-lock their photo.`
      );
      await loadBiometricGovernance();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to update biometric lock.');
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleDecideUnlockRequest = async (requestId: string, decision: 'approve' | 'reject') => {
    setDecidingReqId(requestId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await api.decideBiometricUnlockRequest(token, requestId, decision);
      if (res.user && res.user.id === user.id) {
        onUserUpdated(res.user);
      }
      setStatusMessage(
        decision === 'approve'
          ? `Approved & unlocked biometric photo for ${res.request.fullName}.`
          : `Rejected biometric unlock request for ${res.request.fullName}.`
      );
      await loadBiometricGovernance();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unable to decide unlock request.');
    } finally {
      setDecidingReqId(null);
    }
  };

  const myPendingUnlockRequest = useMemo(
    () => unlockRequests.find((r) => r.userId === user.id && r.status === 'pending') ?? null,
    [unlockRequests, user.id]
  );

  const pendingUnlockRequests = useMemo(
    () => unlockRequests.filter((r) => r.status === 'pending'),
    [unlockRequests]
  );

  const filteredBiometricUsers = useMemo(() => {
    const q = bioSearch.trim().toLowerCase();
    return biometricUsers.filter((u) => {
      const isStu = u.role === 'student' || u.role === 'class_rep';
      if (bioRoleFilter === 'students' && !isStu) return false;
      if (bioRoleFilter === 'faculty_hod' && isStu) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.staffOrRollId.toLowerCase().includes(q)
      );
    });
  }, [biometricUsers, bioSearch, bioRoleFilter]);

  const canSeeDelegationCard =
    user.role === 'hod' ||
    (activeDelegation &&
      (activeDelegation.originalHodUserId === user.id ||
        activeDelegation.delegateUserId === user.id));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900">My Profile & Account Governance</h2>
        <p className="text-xs text-slate-600 mt-1">
          Everyone (including HOD, faculty, advisors, CRs, and students) can update their display name and contact info. Biometric photos remain locked after face registration until HOD grants permission to unlock for retake (HOD can unlock for students, faculty, and themselves).
        </p>
      </div>

      {statusMessage && (
        <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="flex items-center gap-2.5 bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-xl text-xs font-medium">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Card: Photo & Biometric Face Lock */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex flex-col items-center text-center">
            {photoPreview ? (
              <img
                src={photoPreview}
                alt={user.fullName}
                className="w-32 h-32 rounded-2xl object-cover border-2 border-indigo-200 shadow-sm"
              />
            ) : (
              <div className="w-32 h-32 rounded-2xl bg-indigo-50 border-2 border-dashed border-indigo-200 flex flex-col items-center justify-center text-indigo-500">
                <UserIcon className="w-10 h-10 mb-1" />
                <span className="text-[10px] font-medium">No Photo Set</span>
              </div>
            )}

            <h3 className="mt-3 text-base font-bold text-slate-900">{user.fullName}</h3>
            <p className="text-xs font-semibold text-indigo-700">
              {ROLE_LABEL[user.role] || user.role}
            </p>
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-mono">
              <IdCard className="w-3.5 h-3.5 text-slate-500" />
              {user.staffOrRollId || 'UNASSIGNED'}
            </div>
          </div>

          {user.faceRegisteredLocked ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-900 space-y-2.5">
              <div className="font-bold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-emerald-700" />
                Biometric Photo Locked
              </div>
              <p className="text-[11px] leading-relaxed text-emerald-800">
                Your face baseline is registered{user.faceRegisteredAt ? ` (${user.faceRegisteredAt})` : ''}. Photo and ID are locked for camera attendance integrity until HOD grants unlock permission to retake.
              </p>

              {user.role === 'hod' ? (
                <button
                  type="button"
                  onClick={() => handleHodToggleBiometricLock(user.id, false)}
                  disabled={togglingUserId === user.id}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {togglingUserId === user.id
                    ? 'Unlocking...'
                    : 'Unlock My Biometric Photo (HOD) to Retake'}
                </button>
              ) : myPendingUnlockRequest ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900 space-y-1">
                  <div className="font-semibold">Pending HOD Unlock Permission</div>
                  <p className="text-amber-800">
                    Requested {myPendingUnlockRequest.requestedAt} — once HOD approves, Retake Camera controls will unlock automatically.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 pt-1 border-t border-emerald-200/70">
                  <input
                    type="text"
                    value={unlockReason}
                    onChange={(e) => setUnlockReason(e.target.value)}
                    placeholder="Reason to retake photo (e.g. blurry / lighting)..."
                    className="w-full rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[11px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={handleRequestBiometricUnlock}
                    disabled={requestingUnlock}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-xs font-semibold shadow-xs disabled:opacity-60"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    {requestingUnlock
                      ? 'Sending Request...'
                      : 'Request HOD Permission to Unlock & Retake'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 pt-2 border-t border-slate-100">
              <p className="text-[11px] text-slate-600">
                {photoPreview
                  ? 'Review your captured portrait, retake if needed, then lock it for dual-camera attendance:'
                  : 'Capture or upload your portrait below before locking it for dual-camera attendance:'}
              </p>

              {cameraOpen ? (
                <div className="space-y-2">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full rounded-xl border border-slate-300 bg-black aspect-video object-cover"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={captureSnapshot}
                      className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                    >
                      {photoPreview ? 'Retake Capture' : 'Capture Photo'}
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={startCamera}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold"
                  >
                    {photoPreview ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5" />
                        Retake Photo
                      </>
                    ) : (
                      <>
                        <Camera className="w-3.5 h-3.5" />
                        Camera
                      </>
                    )}
                  </button>
                  <label className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {photoPreview ? 'Replace File' : 'Upload'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFilePick}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {photoPreview && photoPreview.startsWith('data:image/') && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleLockFacePhoto}
                    disabled={lockingFace}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {lockingFace ? 'Locking Photo...' : 'Register & Lock Face Photo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoPreview('')}
                    className="w-full py-1.5 px-3 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 text-[11px] font-medium"
                  >
                    Clear Preview
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 space-y-1">
            <div className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate">{user.email}</span>
            </div>
            <div>Department: <span className="font-medium text-slate-700">{user.department}</span></div>
            {user.yearOfStudy && (
              <div>Cohort: <span className="font-medium text-slate-700">{user.yearOfStudy} {user.section}</span></div>
            )}
          </div>
        </div>

        {/* Right Card: Editable Details & HOD Leave Control Delegation */}
        <div className="lg:col-span-2 space-y-6">
          <form
            onSubmit={handleSaveProfile}
            className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">Edit Personal & Academic Details</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Display Full Name (Editable by All Roles)
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Mobile / Wake-Up Call Number
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98XXXXXXXX"
                    className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Designation / Academic Title
                </label>
                <input
                  type="text"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder="e.g., Assistant Professor / Student"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Specialization / Class Focus
                </label>
                <input
                  type="text"
                  value={specialization}
                  onChange={(e) => setSpecialization(e.target.value)}
                  placeholder="e.g., AI & Systems / III Year A"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                About / Office Hours / Notes
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share research focus, lab availability, or student bio..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <label className="font-semibold">Transit Alert Buffer (mins):</label>
                <input
                  type="number"
                  min={0}
                  max={60}
                  value={transitBuffer}
                  onChange={(e) => setTransitBuffer(Number(e.target.value))}
                  className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {savingProfile ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </div>
          </form>

          {/* Institutional Password Setup / Change */}
          <form
            onSubmit={handleSavePassword}
            className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-700" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Institutional Sign-In Password
                </h3>
                <p className="text-[11px] text-slate-500">
                  Set a password if you signed in with Google, or update your existing password. Leave Current Password blank if none is set yet.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Password (Optional for Google accounts)
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Existing password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingPassword}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {savingPassword ? 'Saving Password...' : 'Save Institutional Password'}
              </button>
            </div>
          </form>

          {/* HOD Biometric Photo Unlock Permissions (Students, Faculty & HOD) */}
          {user.role === 'hod' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                    <Unlock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      HOD Biometric Photo Unlock Permissions
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Approve unlock requests or directly unlock biometric photos for any student, faculty, advisor, or HOD to allow photo retake.
                    </p>
                  </div>
                </div>
                {pendingUnlockRequests.length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 text-[11px] font-bold">
                    {pendingUnlockRequests.length} Pending Request{pendingUnlockRequests.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Pending Requests Queue */}
              {pendingUnlockRequests.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                    Pending Student / Faculty Unlock Requests
                  </div>
                  <div className="space-y-2">
                    {pendingUnlockRequests.map((req) => (
                      <div
                        key={req.id}
                        className="bg-white border border-amber-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {req.fullName}{' '}
                            <span className="font-mono text-[11px] text-slate-500">
                              ({req.staffOrRollId || req.email})
                            </span>
                          </div>
                          <div className="text-[11px] text-indigo-700 font-medium">
                            {ROLE_LABEL[req.role] || req.role} · Requested {req.requestedAt}
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">{req.reason}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={decidingReqId === req.id}
                            onClick={() => handleDecideUnlockRequest(req.id, 'approve')}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-semibold disabled:opacity-60"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Approve & Unlock
                          </button>
                          <button
                            type="button"
                            disabled={decidingReqId === req.id}
                            onClick={() => handleDecideUnlockRequest(req.id, 'reject')}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold disabled:opacity-60"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Direct HOD Unlock Control for All Users (Students, Faculty & HOD) */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={bioSearch}
                      onChange={(e) => setBioSearch(e.target.value)}
                      placeholder="Search student, faculty, advisor, or HOD by name / ID / email..."
                      className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-[11px] shrink-0">
                    {(
                      [
                        ['all', 'All'],
                        ['students', 'Students'],
                        ['faculty_hod', 'Faculty & HOD'],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setBioRoleFilter(key)}
                        className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                          bioRoleFilter === key
                            ? 'bg-white text-indigo-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {filteredBiometricUsers.length === 0 ? (
                    <div className="p-5 text-center text-xs text-slate-500">
                      No matching approved accounts found.
                    </div>
                  ) : (
                    filteredBiometricUsers.map((u) => (
                      <div
                        key={u.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {u.profileImageData ? (
                            <img
                              src={u.profileImageData}
                              alt={u.fullName}
                              className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-600 font-bold text-[11px] flex items-center justify-center shrink-0">
                              {u.fullName
                                .split(' ')
                                .filter(Boolean)
                                .slice(0, 2)
                                .map((p) => p[0]?.toUpperCase() || '')
                                .join('') || 'U'}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                              {u.fullName}
                              {u.id === user.id && (
                                <span className="ml-1.5 text-[10px] font-bold text-indigo-700">
                                  (You)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {ROLE_LABEL[u.role] || u.role} ·{' '}
                              <span className="font-mono">{u.staffOrRollId || u.email}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              u.faceRegisteredLocked
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
                            }`}
                          >
                            {u.faceRegisteredLocked ? 'Locked' : 'Unlocked'}
                          </span>

                          {u.faceRegisteredLocked ? (
                            <button
                              type="button"
                              disabled={togglingUserId === u.id}
                              onClick={() => handleHodToggleBiometricLock(u.id, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold disabled:opacity-60"
                            >
                              <Unlock className="w-3 h-3" />
                              {togglingUserId === u.id ? 'Unlocking...' : 'Unlock'}
                            </button>
                          ) : u.profileImageData ? (
                            <button
                              type="button"
                              disabled={togglingUserId === u.id}
                              onClick={() => handleHodToggleBiometricLock(u.id, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-semibold disabled:opacity-60"
                            >
                              <Lock className="w-3 h-3" />
                              Re-Lock
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">Can Retake</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* HOD Role / Full Control Delegation on Leave */}
          {canSeeDelegationCard && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50/70 rounded-2xl border border-amber-200 shadow-xs p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 text-amber-800 flex items-center justify-center">
                  <Crown className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    HOD Leave Control & Role Delegation
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Transfer full HOD governance & app permissions to a faculty member or Class Advisor while on leave, and restore anytime.
                  </p>
                </div>
              </div>

              {activeDelegation && activeDelegation.status === 'active' ? (
                <div className="bg-white rounded-xl border border-amber-300 p-4 space-y-3">
                  <div className="text-xs space-y-1">
                    <p className="font-bold text-amber-900">
                      Active Delegation: {activeDelegation.delegateName} is currently Acting HOD
                    </p>
                    <p className="text-slate-600">
                      Original HOD: <span className="font-semibold">{activeDelegation.originalHodName}</span> ({activeDelegation.originalHodEmail})
                    </p>
                    <p className="text-slate-600">Reason: {activeDelegation.reason}</p>
                    <p className="text-[11px] text-slate-400">Started: {activeDelegation.delegatedAt}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRestoreHod}
                    disabled={delegating}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {delegating ? 'Restoring...' : 'Restore Original HOD Control'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Select Acting Staff Member
                      </label>
                      <select
                        value={selectedDelegateId}
                        onChange={(e) =>
                          setSelectedDelegateId(e.target.value ? Number(e.target.value) : '')
                        }
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                      >
                        <option value="">-- Choose Approved Faculty / Advisor --</option>
                        {delegationCandidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fullName} ({ROLE_LABEL[c.role] || c.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Leave Reason / Duration Note
                      </label>
                      <input
                        type="text"
                        value={delegationReason}
                        onChange={(e) => setDelegationReason(e.target.value)}
                        placeholder="e.g., HOD on Conference Leave till Friday"
                        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleDelegateHod}
                    disabled={delegating || !selectedDelegateId}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    {delegating ? 'Transferring HOD Control...' : 'Delegate Full HOD Control'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
