import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import {
  Building,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Mail,
  MapPin,
  Navigation,
  RotateCcw,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  ROLE_LABELS,
  type BootstrapStatus,
  type PinnedLocationConfig,
  type ServerTimePayload,
  type UserProfile,
  type UserRole,
} from '../types';
import { ChromaGradeMark } from './ChromaGradeMark';
import { ClassroomMapPicker } from './ClassroomMapPicker';
import { OfflineIndicator } from './OfflineIndicator';
import { PWAInstallButton } from './PWAInstallButton';

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

const CAMPUS_IMAGE_URL = '/src/assets/images/chromagrade_campus_atrium_1795283295260.jpg';
const HERO_VIDEO_URL =
  '/assets/aistudio/Website_hero_motion_background_a__5bdc99cd_1080p_4e59c4d7.mp4';

interface AuthPortalProps {
  serverTime: ServerTimePayload | null;
  displayTime: string;
  onAuthenticated: (token: string, user: UserProfile) => void;
}

type AuthMode = 'login' | 'register' | 'setup_hod' | 'check_status';

export function AuthPortal({
  serverTime,
  displayTime,
  onAuthenticated,
}: AuthPortalProps) {
  const [bootstrap, setBootstrap] = useState<BootstrapStatus | null>(null);
  const [mode, setMode] = useState<AuthMode>('login');
  const [videoError, setVideoError] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // HOD First-Run Setup state
  const [hodName, setHodName] = useState('');
  const [hodEmail, setHodEmail] = useState('');
  const [hodDepartment, setHodDepartment] = useState('Computer Science & Engineering');
  const [hodPassword, setHodPassword] = useState('');

  // Registration form state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<UserRole>('class_advisor');
  const [regDepartment, setRegDepartment] = useState('Computer Science & Engineering');
  const [regId, setRegId] = useState('');
  const [regYear, setRegYear] = useState('III Year');
  const [regSection, setRegSection] = useState('A');
  const [regPhone, setRegPhone] = useState('');

  // Student Registration Biometric & HOD-Pinned Classroom Environment state
  const [pinnedLocation, setPinnedLocation] = useState<PinnedLocationConfig | null>(null);
  const [regFaceImage, setRegFaceImage] = useState<string | null>(null);
  const [regEnvImage, setRegEnvImage] = useState<string | null>(null);
  const [regCoords, setRegCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(
    null
  );
  const [regGpsLoading, setRegGpsLoading] = useState(false);
  const [regGpsError, setRegGpsError] = useState<string | null>(null);
  const regVideoRef = useRef<HTMLVideoElement | null>(null);
  const regStreamRef = useRef<MediaStream | null>(null);
  const [regCameraActive, setRegCameraActive] = useState(false);
  const [regFacingMode, setRegFacingMode] = useState<'user' | 'environment'>('user');
  const [regCameraError, setRegCameraError] = useState<string | null>(null);

  // Status check state
  const [statusEmail, setStatusEmail] = useState('');
  const [statusResult, setStatusResult] = useState<Awaited<
    ReturnType<typeof api.checkRegistrationStatus>
  > | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pendingStatusHint, setPendingStatusHint] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showHodPassword, setShowHodPassword] = useState(false);
  const autoSyncAttemptedRef = useRef(false);

  const stopRegCamera = useCallback(() => {
    if (regStreamRef.current) {
      regStreamRef.current.getTracks().forEach((t) => t.stop());
      regStreamRef.current = null;
    }
    if (regVideoRef.current) {
      regVideoRef.current.srcObject = null;
    }
    setRegCameraActive(false);
  }, []);

  useEffect(() => {
    return () => stopRegCamera();
  }, [stopRegCamera]);

  useEffect(() => {
    if (mode !== 'register') {
      stopRegCamera();
    }
  }, [mode, stopRegCamera]);

  useEffect(() => {
    api
      .getBootstrapStatus()
      .then((res) => {
        setBootstrap(res);
        setHodDepartment(res.departmentName);
        setRegDepartment(res.departmentName);
        if (!res.hodExists && !res.envPasscodeConfigured) {
          setMode('setup_hod');
        }
      })
      .catch(() => {
        // Handled cleanly
      });

    api
      .getPublicPinnedLocation()
      .then((res) => setPinnedLocation(res.pinnedLocation))
      .catch(() => {
        // Handled cleanly
      });

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser || autoSyncAttemptedRef.current) return;
      try {
        if (sessionStorage.getItem('chromagrade_signed_out') === '1') return;
      } catch {
        // Ignore storage restrictions
      }
      autoSyncAttemptedRef.current = true;
      setSubmitting(true);
      setErrorMsg(null);
      setPendingStatusHint(false);
      try {
        const idToken = await firebaseUser.getIdToken(true);
        const res = await api.syncFirebaseLogin(idToken);
        onAuthenticated(res.token, res.user);
      } catch (err) {
        if (err instanceof ApiError && err.accountStatus === 'pending') {
          if (firebaseUser.email) setStatusEmail(firebaseUser.email);
          setPendingStatusHint(true);
          setErrorMsg(err.message);
        }
      } finally {
        setSubmitting(false);
      }
    });

    return () => unsubscribe();
  }, [onAuthenticated]);

  const isStudentRegistration = regRole === 'student' || regRole === 'class_rep';
  const needsClassFields = isStudentRegistration || regRole === 'class_advisor';

  const regDistanceMeters = useMemo(() => {
    if (
      !regCoords ||
      !pinnedLocation?.configured ||
      pinnedLocation.latitude === null ||
      pinnedLocation.longitude === null
    ) {
      return null;
    }
    return haversineMeters(
      regCoords.lat,
      regCoords.lng,
      pinnedLocation.latitude,
      pinnedLocation.longitude
    );
  }, [regCoords, pinnedLocation]);

  const regInsidePinnedZone = useMemo(() => {
    if (!pinnedLocation?.configured) return true;
    if (regDistanceMeters === null) return false;
    return regDistanceMeters <= pinnedLocation.radiusMeters;
  }, [pinnedLocation, regDistanceMeters]);

  const handleVerifyRegGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setRegGpsError('Geolocation is not supported in this browser.');
      return;
    }
    setRegGpsLoading(true);
    setRegGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setRegCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy || 0),
        });
        setRegGpsLoading(false);
      },
      (err) => {
        setRegGpsError(
          err.message ||
            'Location permission denied. Enable GPS inside the HOD-pinned classroom to register.'
        );
        setRegGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  };

  const startRegCamera = async (desired: 'user' | 'environment' = regFacingMode) => {
    setRegCameraError(null);
    stopRegCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Live camera is not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: desired },
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      regStreamRef.current = stream;
      setRegFacingMode(desired);
      setRegCameraActive(true);
      requestAnimationFrame(() => {
        if (regVideoRef.current) {
          regVideoRef.current.srcObject = stream;
          regVideoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setRegCameraError(
        err instanceof Error
          ? err.message
          : 'Camera permission denied. Allow camera access to register your face and classroom.'
      );
    }
  };

  const captureRegPhoto = (kind: 'face' | 'environment') => {
    const video = regVideoRef.current;
    if (!video || video.videoWidth === 0) {
      setRegCameraError('Wait for the live camera stream to start before capturing.');
      return;
    }
    if (kind === 'environment' && pinnedLocation?.configured && !regInsidePinnedZone) {
      setRegCameraError(
        `Verify your GPS inside the HOD-pinned classroom "${pinnedLocation.label}" (${pinnedLocation.radiusMeters}m radius) before capturing the classroom environment photo.`
      );
      return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 560 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    if (kind === 'face') {
      setRegFaceImage(dataUrl);
    } else {
      setRegEnvImage(dataUrl);
    }
    setRegCameraError(null);
  };

  const formatFirebaseAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Google Sign-In window was closed before completing. Try again or sign in with your institutional email / Roll ID and password below.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Your browser blocked the Google Sign-In popup. Allow popups for this site and click again, or sign in with your institutional email and password below.';
    }
    if (code === 'auth/unauthorized-domain') {
      return `Google Sign-In is not authorized for ${window.location.hostname}. Please sign in using your institutional email / Roll ID and password below, or register a new account.`;
    }
    if (code === 'auth/network-request-failed') {
      return 'Network error while contacting Google authentication. Check your connection and try again.';
    }
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return 'Google Sign-In failed. Please try again or use your institutional email and password.';
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPendingStatusHint(false);
    setSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      try {
        sessionStorage.removeItem('chromagrade_signed_out');
      } catch {
        // Ignore storage restrictions
      }
      const idToken = await cred.user.getIdToken(true);
      const res = await api.syncFirebaseLogin(idToken);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.accountStatus === 'pending') {
          if (auth.currentUser?.email) {
            setStatusEmail(auth.currentUser.email);
          }
          setPendingStatusHint(true);
        }
        setErrorMsg(err.message);
      } else {
        setErrorMsg(formatFirebaseAuthError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const cleanedIdentifier = loginEmail.trim();
    if (!cleanedIdentifier || !loginPassword) {
      setErrorMsg('Enter both your institutional email (or Roll / Employee ID) and password.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setPendingStatusHint(false);
    setSubmitting(true);
    try {
      try {
        sessionStorage.removeItem('chromagrade_signed_out');
      } catch {
        // Ignore storage restrictions
      }
      const res = await api.login(cleanedIdentifier, loginPassword);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.accountStatus === 'pending') {
          if (cleanedIdentifier.includes('@')) {
            setStatusEmail(cleanedIdentifier.toLowerCase());
          }
          setPendingStatusHint(true);
        }
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Unable to sign in right now. Please check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrapHod = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    try {
      const res = await api.bootstrapHod({
        fullName: hodName,
        email: hodEmail,
        password: hodPassword,
        department: hodDepartment,
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to initialize HOD account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (isStudentRegistration) {
      if (!regFaceImage || !regEnvImage) {
        setErrorMsg(
          'Capture both (1) Live Face Photo and (2) Classroom Environment Photo before submitting student registration.'
        );
        return;
      }
      if (pinnedLocation?.configured && !regInsidePinnedZone) {
        setErrorMsg(
          `Verify your GPS inside the HOD-pinned classroom location "${pinnedLocation.label}" (within ${pinnedLocation.radiusMeters}m) before registering.`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await api.register({
        fullName: regName,
        email: regEmail,
        password: regPassword,
        role: regRole,
        department: regDepartment,
        staffOrRollId: regId,
        yearOfStudy: needsClassFields ? regYear : '',
        section: needsClassFields ? regSection : '',
        phone: regPhone,
        faceImageData: isStudentRegistration ? regFaceImage ?? undefined : undefined,
        environmentImageData: isStudentRegistration ? regEnvImage ?? undefined : undefined,
        latitude: isStudentRegistration ? regCoords?.lat ?? null : null,
        longitude: isStudentRegistration ? regCoords?.lng ?? null : null,
      });
      setSuccessMsg(res.message);
      setStatusEmail(regEmail);
      setRegName('');
      setRegEmail('');
      setRegPassword('');
      setRegId('');
      setRegPhone('');
      setRegFaceImage(null);
      setRegEnvImage(null);
      stopRegCamera();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusCheck = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusResult(null);
    setSubmitting(true);
    try {
      const res = await api.checkRegistrationStatus(statusEmail);
      setStatusResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not look up registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const showHodSetupTab = bootstrap && !bootstrap.hodExists && !bootstrap.envPasscodeConfigured;

  return (
    <div className="min-h-screen bg-slate-50 grid grid-cols-1 lg:grid-cols-12 items-stretch">
      {/* Left architectural showcase panel */}
      <aside className="relative lg:col-span-5 bg-slate-900 text-white flex flex-col justify-between p-8 lg:p-12 overflow-hidden min-h-[280px]">
        {!videoError ? (
          <video
            autoPlay
            loop
            muted
            playsInline
            poster={CAMPUS_IMAGE_URL}
            onError={() => setVideoError(true)}
            aria-label="ChromaGrade campus motion background"
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          >
            <source src={HERO_VIDEO_URL} type="video/mp4" />
          </video>
        ) : (
          !imageError && (
            <img
              src={CAMPUS_IMAGE_URL}
              alt="Modern engineering department sunlit atrium"
              referrerPolicy="no-referrer"
              onError={() => setImageError(true)}
              className="absolute inset-0 w-full h-full object-cover opacity-55"
            />
          )
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-900/75 to-slate-950/60"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center justify-between gap-3 pt-safe">
          <ChromaGradeMark size="md" inverted />
          <PWAInstallButton variant="inverted" />
        </div>

        <div className="relative z-10 my-10 space-y-5 max-w-md">
          <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight text-white">
            Department operations, communities, and dual-camera attendance.
          </h1>
          <p className="text-sm lg:text-base text-slate-200 leading-relaxed">
            Built for Heads of Department, Class Advisors, Faculty, and Students. Document-only roster ingestion, real-time WhatsApp-style communities, and daily timetable attendance verified by live face and environment captures.
          </p>
        </div>

        <div className="relative z-10 pt-6 border-t border-white/15 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>Authoritative Server Clock</span>
            <span className="font-mono tabular-nums text-slate-200">
              {serverTime?.academicTimezone ?? 'Syncing...'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-mono text-2xl font-medium tabular-nums text-white">
              {displayTime}
            </span>
            <span className="text-xs text-slate-300 truncate">
              {serverTime
                ? serverTime.activePeriod
                  ? `${serverTime.activePeriod.label} · ${serverTime.activePeriod.startTime}–${serverTime.activePeriod.endTime}`
                  : serverTime.formattedDate
                : 'Connecting to server time'}
            </span>
          </div>
        </div>
      </aside>

      {/* Right authentication & registration panel */}
      <main className="lg:col-span-7 flex flex-col justify-center px-5 py-8 sm:px-12 lg:px-16 bg-white pb-safe">
        <OfflineIndicator />
        <div className="w-full max-w-xl mx-auto">
          <div className="lg:hidden mb-4 flex items-center justify-between">
            <ChromaGradeMark size="sm" showSubline />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                {mode === 'setup_hod' && 'Initialize HOD Account'}
                {mode === 'login' && 'Sign in to ChromaGrade'}
                {mode === 'register' && 'Register for Portal Access'}
                {mode === 'check_status' && 'Check Approval & Email Intimation'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {mode === 'setup_hod' &&
                  'Create the Head of Department account or sign in with Google to initialize the department.'}
                {mode === 'login' &&
                  'Sign in with Google or your approved institutional email / Roll ID and password.'}
                {mode === 'register' &&
                  'Submit your details for HOD approval. An email intimation confirms when you can sign in.'}
                {mode === 'check_status' &&
                  'Look up your registration approval status and read your approval email intimation.'}
              </p>
            </div>
          </div>

          {/* Interactive mode switcher */}
          <div className="mt-6 flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {showHodSetupTab && (
              <button
                type="button"
                onClick={() => {
                  setMode('setup_hod');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mode === 'setup_hod'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Setup HOD
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('check_status');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'check_status'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Approval Status
            </button>
          </div>

          {/* Google Sign-In option on Login & HOD Setup */}
          {(mode === 'login' || mode === 'setup_hod') && (
            <div className="mt-5">
              <button
                type="button"
                disabled={submitting}
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.615 24 12.255 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 0 0 0 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.64 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
                  />
                </svg>
                <span>Continue with Google Account</span>
              </button>
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-slate-400">or use institutional credentials</span>
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 space-y-2"
            >
              <div>{errorMsg}</div>
              {pendingStatusHint && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('check_status');
                    setErrorMsg(null);
                    setPendingStatusHint(false);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-900 underline underline-offset-2 hover:text-red-700"
                >
                  Check Approval Status & Email Intimation →
                </button>
              )}
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="mt-4 p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900 space-y-2"
            >
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                <span>{successMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMode('check_status');
                  setSuccessMsg(null);
                }}
                className="text-xs font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
              >
                Check approval status & email intimation
              </button>
            </div>
          )}

          {/* Setup HOD Form */}
          {mode === 'setup_hod' && (
            <form onSubmit={handleBootstrapHod} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    HOD Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={hodName}
                    onChange={(e) => setHodName(e.target.value)}
                    placeholder="Dr. S. Ramanathan"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Department Name
                  </label>
                  <input
                    type="text"
                    required
                    value={hodDepartment}
                    onChange={(e) => setHodDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  HOD Institutional Email
                </label>
                <input
                  type="email"
                  required
                  value={hodEmail}
                  onChange={(e) => setHodEmail(e.target.value)}
                  placeholder="hod.cse@chromagrade.edu"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Choose HOD Password
                </label>
                <div className="relative">
                  <input
                    type={showHodPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={hodPassword}
                    onChange={(e) => setHodPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowHodPassword((v) => !v)}
                    aria-label={showHodPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    {showHodPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {submitting ? 'Initializing...' : 'Create HOD Account & Enter'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-sm font-medium text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
                >
                  Register as Staff or Student
                </button>
              </div>
            </form>
          )}

          {/* Sign In Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Institutional Email or Roll / Employee ID
                </label>
                <input
                  type="text"
                  autoComplete="username"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@esec.ac.in or 22CSE001 / HOD-001"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((v) => !v)}
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {submitting ? 'Signing in...' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMsg(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  Register New Account
                </button>
              </div>
            </form>
          )}

          {/* Register Form */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="mt-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Prof. Arvind Narayanan"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Role
                  </label>
                  <select
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as UserRole)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  >
                    <option value="class_advisor">{ROLE_LABELS.class_advisor}</option>
                    <option value="dept_staff">{ROLE_LABELS.dept_staff}</option>
                    <option value="other_dept_staff">{ROLE_LABELS.other_dept_staff}</option>
                    <option value="student">{ROLE_LABELS.student}</option>
                    <option value="class_rep">{ROLE_LABELS.class_rep}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email Address (for Approval Intimation)
                  </label>
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="user@chromagrade.edu"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    {regRole === 'student' || regRole === 'class_rep'
                      ? 'Student Roll Number'
                      : 'Employee ID'}
                  </label>
                  <input
                    type="text"
                    required
                    value={regId}
                    onChange={(e) => setRegId(e.target.value)}
                    placeholder={
                      regRole === 'student' || regRole === 'class_rep'
                        ? '22CSE019'
                        : 'CSE-FAC-112'
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    {regRole === 'other_dept_staff' ? 'Home Department' : 'Department'}
                  </label>
                  <input
                    type="text"
                    required
                    value={regDepartment}
                    onChange={(e) => setRegDepartment(e.target.value)}
                    placeholder="Computer Science & Engineering"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    placeholder="+91 98401 00000"
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              {needsClassFields && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      {regRole === 'class_advisor' ? 'Advising Year' : 'Year of Study'}
                    </label>
                    <select
                      value={regYear}
                      onChange={(e) => setRegYear(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                    >
                      <option value="I Year">I Year</option>
                      <option value="II Year">II Year</option>
                      <option value="III Year">III Year</option>
                      <option value="IV Year">IV Year</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Section
                    </label>
                    <select
                      value={regSection}
                      onChange={(e) => setRegSection(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                    >
                      <option value="A">Section A</option>
                      <option value="B">Section B</option>
                      <option value="C">Section C</option>
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Create Password
                </label>
                <div className="relative">
                  <input
                    type={showRegPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Minimum 6 characters (used after HOD approval)"
                    className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword((v) => !v)}
                    aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-700"
                  >
                    {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Mandatory Student Face & HOD-Pinned Classroom Environment Registration */}
              {isStudentRegistration && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Face & Classroom Environment Registration (Required)
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Register your live face and classroom photo at the HOD-pinned campus location for daily dual-camera attendance verification.
                      </p>
                    </div>
                  </div>

                  {/* HOD-Pinned Location Geofence Check */}
                  <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800">
                        <MapPin className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                        <span>
                          {pinnedLocation?.configured
                            ? `HOD Pinned Classroom: ${pinnedLocation.label} (${pinnedLocation.radiusMeters}m radius)`
                            : 'Classroom GPS Location Check'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={regGpsLoading}
                        onClick={handleVerifyRegGps}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md whitespace-nowrap"
                      >
                        <Navigation className="w-3 h-3" />
                        {regGpsLoading ? 'Verifying GPS...' : 'Verify My Classroom GPS'}
                      </button>
                    </div>

                    {regGpsError && (
                      <div className="text-[11px] text-rose-700">{regGpsError}</div>
                    )}

                    {regCoords && (
                      <div
                        className={`text-[11px] font-medium ${
                          regInsidePinnedZone ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {pinnedLocation?.configured
                          ? regInsidePinnedZone
                            ? `Verified inside HOD-pinned classroom (${regDistanceMeters}m away · limit ${pinnedLocation.radiusMeters}m)`
                            : `Outside HOD-pinned classroom (${regDistanceMeters}m away · move within ${pinnedLocation.radiusMeters}m to capture environment photo)`
                          : `GPS locked (${regCoords.lat}, ${regCoords.lng} · ±${regCoords.accuracy}m)`}
                      </div>
                    )}

                    {(pinnedLocation?.configured || regCoords) && (
                      <div className="pt-1">
                        <ClassroomMapPicker
                          readOnly
                          latitude={pinnedLocation?.latitude ?? regCoords?.lat ?? null}
                          longitude={pinnedLocation?.longitude ?? regCoords?.lng ?? null}
                          radiusMeters={pinnedLocation?.radiusMeters ?? 150}
                          label={pinnedLocation?.label || 'Pinned Classroom Zone'}
                          currentLatitude={regCoords?.lat ?? null}
                          currentLongitude={regCoords?.lng ?? null}
                          height="180px"
                        />
                      </div>
                    )}
                  </div>

                  {/* Live Camera Feed & 2 Capture Controls */}
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-700">
                        Live Camera Capture (No gallery uploads)
                      </span>
                      <div className="flex items-center gap-1.5">
                        {!regCameraActive ? (
                          <button
                            type="button"
                            onClick={() => startRegCamera('user')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-md"
                          >
                            <Camera className="w-3.5 h-3.5" />
                            Start Camera
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                startRegCamera(regFacingMode === 'user' ? 'environment' : 'user')
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                            >
                              <RotateCcw className="w-3 h-3" />
                              {regFacingMode === 'user' ? 'Rear Lens' : 'Front Lens'}
                            </button>
                            <button
                              type="button"
                              onClick={stopRegCamera}
                              className="px-2.5 py-1.5 text-[11px] font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md"
                            >
                              Stop
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {regCameraActive && (
                      <div className="relative aspect-video bg-slate-900 rounded-lg overflow-hidden border border-slate-200">
                        <video
                          ref={regVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {regCameraError && (
                      <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-2">
                        {regCameraError}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={!regCameraActive}
                        onClick={() => captureRegPhoto('face')}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg"
                      >
                        <User className="w-3.5 h-3.5" />
                        {regFaceImage ? 'Retake 1. Face Photo' : '1. Capture Face Photo'}
                      </button>
                      <button
                        type="button"
                        disabled={
                          !regCameraActive ||
                          Boolean(pinnedLocation?.configured && !regInsidePinnedZone)
                        }
                        onClick={() => captureRegPhoto('environment')}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-45 rounded-lg"
                      >
                        <Building className="w-3.5 h-3.5" />
                        {regEnvImage
                          ? 'Retake 2. Class Environment'
                          : '2. Capture Class Environment'}
                      </button>
                    </div>

                    {/* Captured Previews */}
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-600">
                          1. Registered Face {regFaceImage ? '· Ready' : '· Required'}
                        </div>
                        <div className="aspect-[4/3] rounded-md border border-slate-200 bg-white overflow-hidden flex items-center justify-center">
                          {regFaceImage ? (
                            <img
                              src={regFaceImage}
                              alt="Registered student face"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400 px-2 text-center">
                              Capture face photo
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-600">
                          2. Classroom Env {regEnvImage ? '· Ready' : '· Required'}
                        </div>
                        <div className="aspect-[4/3] rounded-md border border-slate-200 bg-white overflow-hidden flex items-center justify-center">
                          {regEnvImage ? (
                            <img
                              src={regEnvImage}
                              alt="Registered classroom environment"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-[10px] text-slate-400 px-2 text-center">
                              Capture at HOD pinned location
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  {submitting ? 'Submitting...' : 'Submit Registration for HOD Approval'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
                >
                  Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* Check Approval Status & Email Intimation */}
          {mode === 'check_status' && (
            <div className="mt-6 space-y-5">
              <form onSubmit={handleStatusCheck} className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  required
                  value={statusEmail}
                  onChange={(e) => setStatusEmail(e.target.value)}
                  placeholder="Enter your registered email"
                  className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                />
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {submitting ? 'Checking...' : 'Check Status'}
                </button>
              </form>

              {statusResult && (
                <div className="border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {statusResult.fullName}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ROLE_LABELS[statusResult.role]} · {statusResult.department}
                      </p>
                    </div>
                    <div className="text-xs font-medium">
                      {statusResult.status === 'approved' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <CheckCircle2 className="w-4 h-4" />
                          Approved by {statusResult.approvedBy ?? 'HOD'}
                        </span>
                      )}
                      {statusResult.status === 'pending' && (
                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                          <Clock className="w-4 h-4" />
                          Pending HOD Approval
                        </span>
                      )}
                      {statusResult.status === 'rejected' && (
                        <span className="text-red-700">Declined by HOD</span>
                      )}
                    </div>
                  </div>

                  {statusResult.intimation ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                        <Mail className="w-4 h-4 text-indigo-700" />
                        <span>Approval Email Intimation Dispatched</span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900">
                        Subject: {statusResult.intimation.subject}
                      </p>
                      <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-200 rounded-md p-3.5 leading-relaxed">
                        {statusResult.intimation.body}
                      </pre>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-slate-500">
                          {statusResult.intimation.deliveryDetail}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setLoginEmail(statusResult.email);
                            setMode('login');
                          }}
                          className="text-xs font-medium text-indigo-700 hover:text-indigo-900 whitespace-nowrap"
                        >
                          Proceed to Sign In →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Once the Head of Department approves your request, an email intimation will appear here and allow you to sign in with your registered credentials.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
