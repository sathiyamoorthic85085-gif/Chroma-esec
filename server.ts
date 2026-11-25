import 'dotenv/config';
import crypto from 'crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import express from 'express';
import fs from 'fs';
import http from 'http';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  buildAttendanceCsvBuffer,
  buildAttendancePdfBuffer,
  buildAttendanceXlsxBuffer,
  buildBatchComparisonPdfBuffer,
  buildMonthlySummaryCsvBuffer,
  buildMonthlySummaryPdfBuffer,
  buildMonthlySummaryXlsxBuffer,
} from './server/attendanceExporter.ts';
import { runDailyDepartmentArchival, startDailyArchivalScheduler } from './server/archivalService.ts';
import { verifyDualCameraAttendance } from './server/attendanceVision.ts';
import {
  buildCsvTemplateBuffer,
  buildPdfTemplateBuffer,
  buildXlsxTemplateBuffer,
  parseUploadedDocument,
} from './server/documentParser.ts';
import { dispatchApprovalIntimationEmail } from './server/emailService.ts';
import { computeServerTimeStatus, isValidTimezone } from './server/serverTime.ts';
import { wsHub } from './server/wsHub.ts';
import { db } from './src/db/index.ts';
import {
  acknowledgePowerBoostMessage,
  calculateDistanceMeters,
  canUserCreateCommunity,
  canUserManageCommunity,
  checkInAcademicGoalToday,
  commitDocumentRowsToDb,
  createAcademicCalendarEvent,
  createBiometricUnlockRequest,
  createChatMessageInDb,
  createCommunityInDb,
  createFacultyAlterationRequest,
  createFacultyDelayAlert,
  createOdLeaveRequest,
  createSession,
  decideBiometricUnlockRequestInDb,
  decideFacultyAlteration,
  decideOdLeaveRequest,
  delegateHodRoleInDb,
  deleteAcademicCalendarEvent,
  deleteSession,
  deleteTimetableSlot,
  ensureBaselineData,
  enumerateDateRangeInclusive,
  evaluateSessionAttendanceStatus,
  findUserByEmail,
  findUserByEmailOrIdentifier,
  findUserById,
  findUserWithMetaById,
  generateSessionToken,
  getAcademicGoalForUser,
  getActiveHodDelegation,
  getBatchComparisonAnalytics,
  getDepartmentalPerformanceSummary,
  getHodCount,
  getLowAttendanceRiskStudents,
  getOdLeaveFormConfig,
  getOdLeaveRequestById,
  getPinnedLocationConfig,
  getPowerBoostEngagementSummary,
  getSenderMetaLookup,
  getSetting,
  getStudentAchievements,
  getStudentBiometricProfile,
  getTopPerformersAndStudyBuddies,
  hashPassword,
  listAcademicCalendarEvents,
  listActiveApprovedOdLeaveForDate,
  listActivePowerBoostAlertsForUser,
  listApprovedStaffForDelegation,
  listArchivalLogs,
  listAttendanceRecords,
  listAttendanceSummaryForMonth,
  listBiometricUnlockRequests,
  listCommunitiesForUser,
  listDepartmentStaff,
  listDepartmentStudents,
  listEmailIntimations,
  listFacultyAlterationsForUser,
  listFacultyDelayAlertsForUser,
  listGroupMessages,
  listHodDirectoryRecords,
  listOdLeaveRequestsForUser,
  listOtherDepartmentStaff,
  listRegistrations,
  listStudentBiometricSummaries,
  listStudentUserIdsNeedingGoalNudge,
  listSubstituteCandidates,
  listTimetableSlots,
  listUploadBatches,
  listUsersBiometricLockStatus,
  mapChatMessageRow,
  mapUser,
  recordAttendanceRiskAlertIfNeeded,
  registerAndLockUserFace,
  restoreHodRoleInDb,
  runAutoFacultyDelayScan,
  runDeduplicationSweep,
  saveOdLeaveFormConfig,
  savePinnedLocationConfig,
  saveTimetableSlot,
  setSetting,
  setUserBiometricLockInDb,
  setUserPasswordInDb,
  stopPowerBoostMessage,
  syncFirebaseUserToDb,
  updateCommunityInDb,
  updateFacultyDelayAlertStatus,
  updateUserProfileInDb,
  updateUserTransitBuffer,
  upsertAcademicGoalForUser,
  upsertAttendanceRecord,
  upsertStudentBiometricProfile,
  upsertStudentFromRegistration,
  verifyPassword,
} from './src/db/repository.ts';
import {
  chatMessages,
  communities,
  communityGroups,
  emailIntimations,
  messageAcknowledgements,
  sessions,
  timetableSlots,
  users,
} from './src/db/schema.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  type AuthenticatedRequest,
  extractBearerToken,
  requireAuth,
  requireRoles,
} from './src/middleware/auth.ts';
import type {
  AcademicEventCategory,
  AttendancePersonType,
  ChatAttachmentPayload,
  ChatAttachmentType,
  CommunityCategory,
  UploadModule,
  UserRole,
} from './src/types.ts';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
  next();
});

app.use(express.json({ limit: '15mb' }));

// Sliding-window auth rate limiter (per client IP + optional identifier so campus NAT doesn't lock out unrelated users)
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_MAX = 30;
const authRateBuckets = new Map<string, number[]>();

function buildAuthRateKey(req: express.Request): string {
  const ip = req.ip || 'unknown';
  const rawIdent = String(req.body?.email ?? req.body?.identifier ?? '').trim().toLowerCase();
  return rawIdent ? `${ip}:${rawIdent}` : ip;
}

function clearAuthRateBucket(req: express.Request): void {
  authRateBuckets.delete(buildAuthRateKey(req));
}

function authRateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const key = buildAuthRateKey(req);
  const now = Date.now();
  const timestamps = (authRateBuckets.get(key) || []).filter((ts) => now - ts < AUTH_RATE_WINDOW_MS);
  if (timestamps.length >= AUTH_RATE_MAX) {
    res.status(429).json({
      error: 'Too many authentication attempts. Please wait a few minutes and try again.',
    });
    return;
  }
  timestamps.push(now);
  authRateBuckets.set(key, timestamps);
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const CHAT_UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'chat');
fs.mkdirSync(CHAT_UPLOADS_DIR, { recursive: true });

const OD_LEAVE_UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'od-leave');
fs.mkdirSync(OD_LEAVE_UPLOADS_DIR, { recursive: true });

const POWER_BOOST_ROLES: UserRole[] = ['hod', 'class_advisor', 'class_rep'];

const ALLOWED_OD_DOC_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.txt',
]);

const ALLOWED_OD_PHOTO_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

const ALLOWED_CHAT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.txt',
  '.zip',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.webm',
  '.ogg',
  '.mp4',
  '.m4a',
  '.mp3',
  '.wav',
]);

const INLINE_SAFE_MIME_PREFIXES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'audio/'];

function sanitizeHttpUrl(raw: unknown): string {
  const str = String(raw ?? '').trim();
  if (!str) return '';
  try {
    const parsed = new URL(str);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function detectFirstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match ? sanitizeHttpUrl(match[0]) : '';
}

const VALID_MODULES: UploadModule[] = [
  'department_students',
  'department_staff',
  'other_department_staff',
  'class_representatives',
  'timetable',
];

const ADVISOR_ALLOWED_MODULES: UploadModule[] = [
  'department_students',
  'class_representatives',
  'timetable',
];

// ============================================================
// 1. Authoritative Server Time Endpoint
// ============================================================
app.get('/api/health', async (_req, res) => {
  try {
    await ensureBaselineData();
    res.json({ ok: true, service: 'academia-esec', status: 'healthy' });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: 'academia-esec',
      error: error instanceof Error ? error.message : 'Service unavailable',
    });
  }
});

app.get('/api/config/public', (_req, res) => {
  const googleMapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
    '';
  res.json({ googleMapsApiKey });
});

app.get('/api/server-time', async (_req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    res.json(computeServerTimeStatus(tz, dept));
  } catch (error) {
    console.error('Server time error:', error);
    res.json(computeServerTimeStatus('Asia/Kolkata', 'Computer Science & Engineering'));
  }
});

// ============================================================
// 2. Authentication, Google Firebase Sync & Registration
// ============================================================
app.get('/api/auth/bootstrap-status', async (_req, res) => {
  try {
    await ensureBaselineData();
    const hodCount = await getHodCount();
    const envPasscodeConfigured = Boolean(process.env.HOD_ADMIN_PASSCODE?.trim());
    const departmentName = await getSetting('department_name', 'Computer Science & Engineering');
    const academicTimezone = await getSetting('academic_timezone', 'Asia/Kolkata');
    res.json({
      hodExists: hodCount > 0,
      envPasscodeConfigured,
      departmentName,
      academicTimezone,
    });
  } catch (error) {
    console.error('Bootstrap status failed:', error);
    res.status(500).json({ error: 'Unable to check portal initialization status.' });
  }
});

app.post('/api/auth/firebase-sync', async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Firebase ID token.' });
      return;
    }

    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email) {
      res.status(400).json({ error: 'Google account must provide an email address.' });
      return;
    }

    const syncedUser = await syncFirebaseUserToDb({
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name || decoded.email.split('@')[0],
      photoUrl: decoded.picture,
    });

    if (syncedUser.status === 'pending') {
      res.status(403).json({
        error:
          'Your Google account is registered and awaiting HOD approval. You will receive an email intimation once approved.',
        accountStatus: 'pending',
        user: syncedUser,
      });
      return;
    }

    if (syncedUser.status === 'rejected') {
      res.status(403).json({
        error: 'Your access request was declined by the HOD.',
        accountStatus: 'rejected',
      });
      return;
    }

    const sessionToken = await createSession(syncedUser.id);
    res.json({ token: sessionToken, user: syncedUser });
  } catch (error) {
    console.error('Firebase sync failed:', error);
    const code = (error as { code?: string })?.code ?? '';
    if (code === 'auth/id-token-expired' || code === 'auth/id-token-revoked') {
      res.status(401).json({ error: 'Google Sign-In session expired. Please click Continue with Google Account again.' });
      return;
    }
    res.status(401).json({ error: 'Could not verify Google Sign-In credentials. Ensure your Google account is authorized or sign in with your institutional email and password.' });
  }
});

app.post('/api/auth/bootstrap-hod', authRateLimit, async (req, res) => {
  try {
    await ensureBaselineData();
    const envPasscode = process.env.HOD_ADMIN_PASSCODE?.trim();
    const hodCount = await getHodCount();

    if (hodCount > 0 || envPasscode) {
      res.status(403).json({ error: 'HOD administrator account has already been initialized.' });
      return;
    }

    const fullName = String(req.body?.fullName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const department =
      String(req.body?.department ?? '').trim() ||
      (await getSetting('department_name', 'Computer Science & Engineering'));

    if (!fullName || !email || !email.includes('@') || password.length < 6) {
      res.status(400).json({
        error: 'Provide a valid full name, email address, and password (minimum 6 characters).',
      });
      return;
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const [created] = await db
      .insert(users)
      .values({
        fullName,
        email,
        passwordHash: hashPassword(password),
        role: 'hod',
        department,
        staffOrRollId: 'HOD-001',
        status: 'approved',
        approvedBy: 'Initial Setup',
        approvedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      })
      .returning();

    await setSetting('department_name', department);

    // Seed 2 realistic pending registration requests if none exist yet so HOD can test approval & email intimation
    const pendingRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.status, 'pending'))
      .limit(1);

    if (pendingRows.length === 0) {
      const placeholderHash = hashPassword(generateSessionToken());
      await db
        .insert(users)
        .values([
          {
            fullName: 'Prof. Arvind Narayanan',
            email: 'arvind.n@chromagrade.edu',
            passwordHash: placeholderHash,
            role: 'class_advisor',
            department,
            staffOrRollId: 'CSE-FAC-102',
            yearOfStudy: 'III Year',
            section: 'A',
            phone: '+91 98401 22102',
            status: 'pending',
          },
          {
            fullName: 'Aarav Prakash',
            email: 'aarav.22cse@chromagrade.edu',
            passwordHash: placeholderHash,
            role: 'class_rep',
            department,
            staffOrRollId: '22CSE001',
            yearOfStudy: 'III Year',
            section: 'A',
            phone: '+91 97901 10001',
            status: 'pending',
          },
        ])
        .onConflictDoNothing();
    }

    const token = await createSession(created.id);
    const enriched = (await findUserWithMetaById(created.id)) ?? mapUser(created);
    res.status(201).json({ token, user: enriched });
  } catch (error) {
    console.error('Bootstrap HOD failed:', error);
    res.status(500).json({ error: 'Unable to initialize HOD account.' });
  }
});

app.get('/api/auth/pinned-location', async (_req, res) => {
  try {
    const config = await getPinnedLocationConfig();
    res.json({ pinnedLocation: config });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to fetch pinned classroom location.' });
  }
});

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  try {
    await ensureBaselineData();
    const fullName = String(req.body?.fullName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? '').trim() as UserRole;
    const department =
      String(req.body?.department ?? '').trim() ||
      (await getSetting('department_name', 'Computer Science & Engineering'));
    const staffOrRollId = String(req.body?.staffOrRollId ?? '').trim().toUpperCase();
    const yearOfStudy = String(req.body?.yearOfStudy ?? '').trim();
    const section = String(req.body?.section ?? '').trim().toUpperCase();
    const phone = String(req.body?.phone ?? '').trim();

    const faceImageData = String(req.body?.faceImageData ?? '').trim();
    const environmentImageData = String(req.body?.environmentImageData ?? '').trim();
    const rawLat = req.body?.latitude;
    const rawLng = req.body?.longitude;
    const hasCoords =
      rawLat !== undefined &&
      rawLat !== null &&
      rawLat !== '' &&
      rawLng !== undefined &&
      rawLng !== null &&
      rawLng !== '' &&
      Number.isFinite(Number(rawLat)) &&
      Number.isFinite(Number(rawLng));
    const latitude = hasCoords ? Number(rawLat) : null;
    const longitude = hasCoords ? Number(rawLng) : null;

    const allowedRoles: UserRole[] = [
      'class_advisor',
      'dept_staff',
      'other_dept_staff',
      'student',
      'class_rep',
    ];

    if (!fullName || !email || !email.includes('@') || password.length < 6) {
      res.status(400).json({
        error: 'Full name, valid email, and password (at least 6 characters) are required.',
      });
      return;
    }
    if (!allowedRoles.includes(role)) {
      res.status(400).json({ error: 'Select a valid academic role for registration.' });
      return;
    }
    if (!staffOrRollId) {
      res.status(400).json({ error: 'Employee ID or Student Roll Number is required.' });
      return;
    }

    const isStudentRole = role === 'student' || role === 'class_rep';
    const pinnedLocation = await getPinnedLocationConfig();
    let distanceMeters: number | null = null;
    let locationVerified = false;

    if (isStudentRole) {
      if (!faceImageData || !environmentImageData) {
        res.status(400).json({
          error:
            'Students and Class Representatives must capture both (1) Live Face Photo and (2) Classroom Environment Photo during registration.',
        });
        return;
      }

      if (
        pinnedLocation.configured &&
        pinnedLocation.latitude !== null &&
        pinnedLocation.longitude !== null
      ) {
        if (latitude === null || longitude === null) {
          res.status(400).json({
            error: `Enable GPS location at "${pinnedLocation.label}" (within ${pinnedLocation.radiusMeters}m of HOD pinned location) before registering your classroom environment photo.`,
          });
          return;
        }
        distanceMeters = calculateDistanceMeters(
          latitude,
          longitude,
          pinnedLocation.latitude,
          pinnedLocation.longitude
        );
        if (distanceMeters > pinnedLocation.radiusMeters) {
          res.status(400).json({
            error: `You are ${distanceMeters}m away from the HOD-pinned classroom location "${pinnedLocation.label}" (allowed radius: ${pinnedLocation.radiusMeters}m). Move inside the pinned classroom zone and recapture.`,
          });
          return;
        }
        locationVerified = true;
      } else if (latitude !== null && longitude !== null) {
        locationVerified = true;
      }
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      res.status(409).json({
        error:
          existing.status === 'pending'
            ? 'This email is already registered and awaiting HOD approval.'
            : 'An account with this email is already registered.',
      });
      return;
    }

    const [created] = await db
      .insert(users)
      .values({
        fullName,
        email,
        passwordHash: hashPassword(password),
        role,
        department,
        staffOrRollId,
        yearOfStudy,
        section,
        phone,
        status: 'pending',
      })
      .returning();

    // Automatically add registering students & class reps to main Department Students + Biometric Baselines
    if (isStudentRole) {
      await upsertStudentFromRegistration({
        rollNo: staffOrRollId,
        fullName,
        email,
        department,
        yearOfStudy: yearOfStudy || 'I Year',
        section: section || 'A',
        phone,
        isClassRep: role === 'class_rep',
      });

      await upsertStudentBiometricProfile({
        rollNo: staffOrRollId,
        email,
        fullName,
        department,
        yearOfStudy: yearOfStudy || 'I Year',
        section: section || 'A',
        faceImageData,
        environmentImageData,
        capturedLatitude: latitude !== null ? String(latitude) : '',
        capturedLongitude: longitude !== null ? String(longitude) : '',
        distanceMeters,
        locationVerified,
        pinnedLocationLabel: pinnedLocation.label,
      });

      await registerAndLockUserFace({
        userId: created.id,
        faceImageData,
      });
    }

    const enrichedCreated = (await findUserWithMetaById(created.id)) ?? mapUser(created);
    res.status(201).json({
      user: enrichedCreated,
      message: isStudentRole
        ? 'Registration submitted! Your student record, live face baseline, and verified classroom environment photo are saved and locked. Once the HOD approves your account, an email intimation will notify you to sign in.'
        : 'Registration submitted. Once the HOD approves your request, an email intimation will notify you to sign in with your registered credentials.',
    });
  } catch (error) {
    console.error('Register failed:', error);
    res.status(500).json({ error: 'Unable to submit registration.' });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  try {
    await ensureBaselineData();
    const rawIdentifier = String(req.body?.email ?? req.body?.identifier ?? '').trim();
    const email = rawIdentifier.toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!rawIdentifier || !password) {
      res.status(400).json({ error: 'Institutional email (or Roll / Employee ID) and password are required.' });
      return;
    }

    const envPasscode = process.env.HOD_ADMIN_PASSCODE?.trim();
    const existing = await findUserByEmailOrIdentifier(rawIdentifier);

    if (!existing && envPasscode && password === envPasscode && email.includes('@')) {
      const hodCount = await getHodCount();
      if (hodCount === 0) {
        const dept = await getSetting('department_name', 'Computer Science & Engineering');
        const [created] = await db
          .insert(users)
          .values({
            fullName: 'Head of Department',
            email,
            passwordHash: hashPassword(password),
            role: 'hod',
            department: dept,
            staffOrRollId: 'HOD-001',
            status: 'approved',
            approvedBy: 'Environment Config',
            approvedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          })
          .returning();
        const token = await createSession(created.id);
        const enriched = (await findUserWithMetaById(created.id)) ?? mapUser(created);
        clearAuthRateBucket(req);
        res.json({ token, user: enriched });
        return;
      }
    }

    if (!existing) {
      res.status(401).json({
        error: 'No matching account found or password is incorrect. Double-check your email / Roll ID or register a new account.',
      });
      return;
    }

    const isHodEnvOverride =
      existing.role === 'hod' && Boolean(envPasscode) && password === envPasscode;
    if (!isHodEnvOverride && !existing.passwordHash) {
      res.status(401).json({
        error:
          'This account was created via Google Sign-In and does not have an institutional password yet. Click "Continue with Google Account" above to sign in (you can then set a password under My Profile).',
      });
      return;
    }

    const passwordOk = isHodEnvOverride || verifyPassword(password, existing.passwordHash);

    if (!passwordOk) {
      res.status(401).json({ error: 'Invalid email / ID or password.' });
      return;
    }

    if (existing.status === 'pending') {
      res.status(403).json({
        error:
          'Your registration is awaiting HOD approval. You will receive an email intimation once approved to sign in with your credentials.',
        accountStatus: 'pending',
      });
      return;
    }

    if (existing.status === 'rejected') {
      res.status(403).json({
        error: 'Your registration request was declined by the HOD.',
        accountStatus: 'rejected',
      });
      return;
    }

    const token = await createSession(existing.id);
    const enrichedUser = (await findUserWithMetaById(existing.id)) ?? mapUser(existing);
    clearAuthRateBucket(req);
    res.json({ token, user: enrichedUser });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Unable to sign in right now.' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.sessionToken) {
    await deleteSession(req.sessionToken);
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

app.get('/api/auth/registration-status', async (req, res) => {
  try {
    const email = String(req.query.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      res.status(400).json({ error: 'Enter a valid registered email address.' });
      return;
    }

    const userRow = await findUserByEmail(email);
    if (!userRow) {
      res.status(404).json({ error: 'No registration found for this email address.' });
      return;
    }

    const intimations = await db
      .select()
      .from(emailIntimations)
      .where(eq(emailIntimations.recipientEmail, email))
      .orderBy(desc(emailIntimations.id))
      .limit(1);

    const latest = intimations[0];
    res.json({
      fullName: userRow.fullName,
      email: userRow.email,
      role: userRow.role,
      department: userRow.department,
      status: userRow.status,
      approvedBy: userRow.approvedBy ?? null,
      approvedAt: userRow.approvedAt ?? null,
      createdAt: userRow.createdAt.toISOString().replace('T', ' ').slice(0, 19),
      intimation: latest
        ? {
            subject: latest.subject,
            body: latest.body,
            deliveryStatus: latest.deliveryStatus,
            deliveryDetail: latest.deliveryDetail,
            createdAt: latest.createdAt.toISOString().replace('T', ' ').slice(0, 19),
          }
        : null,
    });
  } catch (error) {
    console.error('Registration status lookup failed:', error);
    res.status(500).json({ error: 'Could not check registration status.' });
  }
});

// ============================================================
// 3. HOD Governance: Approvals, Email Intimations, Settings & Dedupe
// ============================================================
app.get('/api/hod/registrations', requireAuth, requireRoles('hod'), async (_req, res) => {
  try {
    const registrations = await listRegistrations();
    res.json({ registrations });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load registrations.' });
  }
});

app.post(
  '/api/hod/registrations/:id/approve',
  requireAuth,
  requireRoles('hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const targetId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(targetId)) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }

      const existing = await findUserById(targetId);
      if (!existing || existing.role === 'hod') {
        res.status(404).json({ error: 'Registration record not found.' });
        return;
      }

      const approverName = req.user!.fullName;
      const nowStamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const [updated] = await db
        .update(users)
        .set({ status: 'approved', approvedBy: approverName, approvedAt: nowStamp })
        .where(eq(users.id, targetId))
        .returning();

      const approvedUser = (await findUserWithMetaById(updated.id)) ?? mapUser(updated);
      // Ensure approved student/class_rep is synced into the main department_students directory
      if ((approvedUser.role === 'student' || approvedUser.role === 'class_rep') && approvedUser.staffOrRollId) {
        await upsertStudentFromRegistration({
          rollNo: approvedUser.staffOrRollId,
          fullName: approvedUser.fullName,
          email: approvedUser.email,
          department: approvedUser.department,
          yearOfStudy: approvedUser.yearOfStudy || 'I Year',
          section: approvedUser.section || 'A',
          phone: approvedUser.phone,
          isClassRep: approvedUser.role === 'class_rep',
        });
      }
      const portalUrl = process.env.APP_URL?.trim() || `${req.protocol}://${req.get('host')}`;
      const dispatch = await dispatchApprovalIntimationEmail({
        recipientEmail: approvedUser.email,
        recipientName: approvedUser.fullName,
        role: approvedUser.role,
        department: approvedUser.department,
        staffOrRollId: approvedUser.staffOrRollId,
        approvedByName: approverName,
        portalUrl,
      });

      const [intimationRow] = await db
        .insert(emailIntimations)
        .values({
          recipientEmail: approvedUser.email,
          recipientName: approvedUser.fullName,
          role: approvedUser.role,
          subject: dispatch.subject,
          body: dispatch.body,
          deliveryStatus: dispatch.deliveryStatus,
          deliveryDetail: dispatch.deliveryDetail,
          triggeredByName: approverName,
        })
        .returning();

      res.json({
        user: approvedUser,
        intimation: {
          id: intimationRow.id,
          recipientEmail: intimationRow.recipientEmail,
          recipientName: intimationRow.recipientName,
          role: intimationRow.role as UserRole,
          subject: intimationRow.subject,
          body: intimationRow.body,
          deliveryStatus: intimationRow.deliveryStatus,
          deliveryDetail: intimationRow.deliveryDetail,
          triggeredByName: intimationRow.triggeredByName,
          createdAt: intimationRow.createdAt.toISOString().replace('T', ' ').slice(0, 19),
        },
      });
    } catch (error) {
      console.error('Approve registration failed:', error);
      res.status(500).json({ error: 'Unable to approve registration.' });
    }
  }
);

app.post(
  '/api/hod/registrations/:id/reject',
  requireAuth,
  requireRoles('hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const targetId = Number.parseInt(String(req.params.id), 10);
      if (!Number.isFinite(targetId)) {
        res.status(400).json({ error: 'Invalid user ID.' });
        return;
      }

      const existing = await findUserById(targetId);
      if (!existing || existing.role === 'hod') {
        res.status(404).json({ error: 'Registration record not found.' });
        return;
      }

      const [updated] = await db
        .update(users)
        .set({
          status: 'rejected',
          approvedBy: req.user!.fullName,
          approvedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        })
        .where(eq(users.id, targetId))
        .returning();

      await db.delete(sessions).where(eq(sessions.userId, targetId));
      res.json({ user: mapUser(updated) });
    } catch (error) {
      console.error('Reject registration failed:', error);
      res.status(500).json({ error: 'Unable to decline registration.' });
    }
  }
);

app.get('/api/hod/intimations', requireAuth, requireRoles('hod'), async (_req, res) => {
  try {
    const intimations = await listEmailIntimations();
    res.json({ intimations });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load intimations.' });
  }
});

app.patch('/api/hod/settings', requireAuth, requireRoles('hod'), async (req, res) => {
  try {
    const tz = String(req.body?.academicTimezone ?? '').trim();
    const dept = String(req.body?.departmentName ?? '').trim();

    if (tz) {
      if (!isValidTimezone(tz)) {
        res.status(400).json({ error: 'Invalid IANA timezone identifier.' });
        return;
      }
      await setSetting('academic_timezone', tz);
    }
    if (dept) {
      await setSetting('department_name', dept);
    }

    const updatedTz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const updatedDept = await getSetting('department_name', 'Computer Science & Engineering');
    res.json({
      academicTimezone: updatedTz,
      departmentName: updatedDept,
      serverTime: computeServerTimeStatus(updatedTz, updatedDept),
    });
  } catch (error) {
    console.error('Update settings failed:', error);
    res.status(500).json({ error: 'Failed to update department settings.' });
  }
});

app.post('/api/hod/deduplicate', requireAuth, requireRoles('hod'), async (_req, res) => {
  try {
    const report = await runDeduplicationSweep();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Deduplication failed.' });
  }
});

// ============================================================
// 4. Academic Directories & Timetable APIs
// ============================================================
app.get('/api/records/students', requireAuth, async (_req, res) => {
  try {
    const students = await listDepartmentStudents();
    res.json({ students });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch students.' });
  }
});

app.get('/api/records/department-staff', requireAuth, async (_req, res) => {
  try {
    const staff = await listDepartmentStaff();
    res.json({ staff });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch department staff.' });
  }
});

app.get('/api/records/other-department-staff', requireAuth, async (_req, res) => {
  try {
    const staff = await listOtherDepartmentStaff();
    res.json({ staff });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch other department staff.' });
  }
});

app.get('/api/records/timetable', requireAuth, async (_req, res) => {
  try {
    const slots = await listTimetableSlots();
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    res.json({ serverTime: computeServerTimeStatus(tz, dept), slots });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch timetable.' });
  }
});

const VALID_TIMETABLE_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseTimetableSlotBody(body: Record<string, unknown>, defaultDept: string) {
  const department = String(body?.department ?? defaultDept).trim() || defaultDept;
  const yearOfStudy = String(body?.yearOfStudy ?? '').trim();
  const section = String(body?.section ?? '').trim().toUpperCase();
  const dayOfWeek = String(body?.dayOfWeek ?? '').trim();
  const periodNumber = Number(body?.periodNumber);
  const startTime = String(body?.startTime ?? '').trim();
  const endTime = String(body?.endTime ?? '').trim();
  const subjectCode = String(body?.subjectCode ?? '').trim().toUpperCase();
  const subjectName = String(body?.subjectName ?? '').trim();
  const facultyName = String(body?.facultyName ?? '').trim();
  const facultyType: 'department' | 'other_department' =
    body?.facultyType === 'other_department' ? 'other_department' : 'department';
  const roomNo = String(body?.roomNo ?? '').trim();

  if (!yearOfStudy || !section) {
    return { error: 'Year of study and section are required.' };
  }
  if (!VALID_TIMETABLE_DAYS.includes(dayOfWeek)) {
    return { error: 'Day of week must be Monday through Saturday.' };
  }
  if (!Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 12) {
    return { error: 'Period number must be between 1 and 12.' };
  }
  if (!subjectCode || !subjectName || !facultyName) {
    return { error: 'Subject code, subject name, and faculty name are required.' };
  }
  if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) {
    return { error: 'Start time and end time must use valid HH:MM format.' };
  }
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  if (sh * 60 + sm >= eh * 60 + em) {
    return { error: 'End time must be later than start time.' };
  }

  return {
    data: {
      department,
      yearOfStudy,
      section,
      dayOfWeek,
      periodNumber,
      startTime,
      endTime,
      subjectCode,
      subjectName,
      facultyName,
      facultyType,
      roomNo,
    },
  };
}

app.post(
  '/api/records/timetable',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'student', 'class_rep'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const defaultDept = await getSetting('department_name', req.user?.department || 'Computer Science & Engineering');
      const parsed = parseTimetableSlotBody(req.body ?? {}, defaultDept);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const slot = await saveTimetableSlot(parsed.data);
      res.status(201).json({ slot });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save timetable slot.' });
    }
  }
);

app.put(
  '/api/records/timetable/:id',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'student', 'class_rep'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid timetable slot ID.' });
        return;
      }
      const defaultDept = await getSetting('department_name', req.user?.department || 'Computer Science & Engineering');
      const parsed = parseTimetableSlotBody(req.body ?? {}, defaultDept);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const slot = await saveTimetableSlot(parsed.data, id);
      res.json({ slot });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update timetable slot.' });
    }
  }
);

app.delete(
  '/api/records/timetable/:id',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'student', 'class_rep'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid timetable slot ID.' });
        return;
      }
      const deleted = await deleteTimetableSlot(id);
      if (!deleted) {
        res.status(404).json({ error: 'Timetable slot not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete timetable slot.' });
    }
  }
);

app.get('/api/records/batches', requireAuth, async (_req, res) => {
  try {
    const batches = await listUploadBatches();
    res.json({ batches });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch upload batches.' });
  }
});

// ============================================================
// 5. Document-Only Record Ingestion APIs
// ============================================================
app.post(
  '/api/uploads/parse',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'student', 'class_rep'),
  upload.single('document'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const targetModule = String(req.body?.targetModule ?? '') as UploadModule;
      if (!VALID_MODULES.includes(targetModule)) {
        res.status(400).json({ error: 'Select a valid target record module.' });
        return;
      }
      if (
        (req.user!.role === 'class_advisor' ||
          req.user!.role === 'student' ||
          req.user!.role === 'class_rep') &&
        !ADVISOR_ALLOWED_MODULES.includes(targetModule)
      ) {
        res.status(403).json({
          error:
            'Class Advisors, Students, and Class Representatives can upload Student lists, Class Representative rosters, and Timetable documents.',
        });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'Attach a document file (.xlsx, .xls, .pdf, .docx, or .csv).' });
        return;
      }

      const defaultDept = await getSetting('department_name', 'Computer Science & Engineering');
      const preview = await parseUploadedDocument(
        req.file.buffer,
        req.file.originalname,
        targetModule,
        defaultDept
      );
      res.json(preview);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to parse uploaded document.',
      });
    }
  }
);

app.post(
  '/api/uploads/commit',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'student', 'class_rep'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const targetModule = String(req.body?.targetModule ?? '') as UploadModule;
      const originalFilename = String(req.body?.originalFilename ?? '').trim();
      const fileType = String(req.body?.fileType ?? '').trim().toLowerCase();
      const rows = Array.isArray(req.body?.rows)
        ? (req.body.rows as Record<string, unknown>[])
        : [];

      if (!VALID_MODULES.includes(targetModule)) {
        res.status(400).json({ error: 'Invalid target record module.' });
        return;
      }
      if (
        (req.user!.role === 'class_advisor' ||
          req.user!.role === 'student' ||
          req.user!.role === 'class_rep') &&
        !ADVISOR_ALLOWED_MODULES.includes(targetModule)
      ) {
        res.status(403).json({ error: 'You are not authorized to commit records to this module.' });
        return;
      }
      if (!originalFilename || rows.length === 0) {
        res.status(400).json({ error: 'No parsed document records provided for import.' });
        return;
      }

      const defaultDept = await getSetting('department_name', 'Computer Science & Engineering');
      const result = await commitDocumentRowsToDb({
        targetModule,
        originalFilename,
        fileType,
        rows,
        uploadedByName: req.user!.fullName,
        uploadedByRole: req.user!.role,
        defaultDepartment: defaultDept,
      });

      res.status(201).json({
        ok: true,
        ...result,
        message: `Imported ${result.recordsInserted} new and updated ${result.recordsUpdated} existing unique record(s) from ${originalFilename}.`,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to commit document records.',
      });
    }
  }
);

app.get('/api/templates/:module/:format', requireAuth, async (req, res) => {
  try {
    const mod = String(req.params.module) as UploadModule;
    const format = String(req.params.format).toLowerCase();

    if (!VALID_MODULES.includes(mod)) {
      res.status(400).json({ error: 'Unknown module.' });
      return;
    }

    if (format === 'xlsx') {
      const buf = await buildXlsxTemplateBuffer(mod);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="ChromaGrade_${mod}_template.xlsx"`);
      res.send(buf);
      return;
    }
    if (format === 'pdf') {
      const buf = buildPdfTemplateBuffer(mod);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ChromaGrade_${mod}_template.pdf"`);
      res.send(buf);
      return;
    }
    if (format === 'csv') {
      const buf = buildCsvTemplateBuffer(mod);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="ChromaGrade_${mod}_template.csv"`);
      res.send(buf);
      return;
    }
    res.status(400).json({ error: 'Supported template formats: xlsx, pdf, csv.' });
  } catch (error) {
    console.error('Template generation error:', error);
    res.status(500).json({ error: 'Could not generate sample template.' });
  }
});

// ============================================================
// 6. WhatsApp-Style Communities, Groups & Real-Time Messaging APIs
// ============================================================
app.get('/api/communities', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const items = await listCommunitiesForUser(req.user!);
    res.json({
      communities: items,
      canCreateCommunity: canUserCreateCommunity(req.user!.role),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load communities.' });
  }
});

app.post('/api/communities', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!canUserCreateCommunity(req.user!.role)) {
      res.status(403).json({
        error: 'Only authenticated department members can create communities.',
      });
      return;
    }

    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const category = (String(req.body?.category ?? 'department').trim() ||
      'department') as CommunityCategory;
    const announcementOnly = Boolean(req.body?.announcementOnly);

    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Community name must be between 2 and 80 characters.' });
      return;
    }

    const department = await getSetting('department_name', req.user!.department);
    const created = await createCommunityInDb({
      name,
      description,
      department,
      category,
      announcementOnly,
      user: req.user!,
    });

    wsHub.emitCommunityChanged();
    res.status(201).json({ community: created });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unable to create community.',
    });
  }
});

app.patch('/api/communities/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const communityId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(communityId)) {
      res.status(400).json({ error: 'Invalid community ID.' });
      return;
    }

    const allowed = await canUserManageCommunity(req.user!, communityId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have authority to edit this community.' });
      return;
    }

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
    const description =
      req.body?.description !== undefined ? String(req.body.description).trim() : undefined;
    const category =
      req.body?.category !== undefined ? (String(req.body.category) as CommunityCategory) : undefined;
    const announcementOnly =
      req.body?.announcementOnly !== undefined ? Boolean(req.body.announcementOnly) : undefined;

    if (name !== undefined && (name.length < 2 || name.length > 80)) {
      res.status(400).json({ error: 'Community name must be between 2 and 80 characters.' });
      return;
    }

    const updated = await updateCommunityInDb(communityId, {
      name,
      description,
      category,
      announcementOnly,
    });
    if (!updated) {
      res.status(404).json({ error: 'Community not found.' });
      return;
    }

    wsHub.emitCommunityChanged();
    res.json({ ok: true, community: updated });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update community.' });
  }
});

app.delete('/api/communities/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const communityId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(communityId)) {
      res.status(400).json({ error: 'Invalid community ID.' });
      return;
    }

    const allowed = await canUserManageCommunity(req.user!, communityId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have authority to delete this community.' });
      return;
    }

    await db.delete(communities).where(eq(communities.id, communityId));
    wsHub.emitCommunityChanged();
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete community error:', error);
    res.status(500).json({ error: 'Unable to delete community.' });
  }
});

app.post('/api/communities/:id/groups', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const communityId = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(communityId)) {
      res.status(400).json({ error: 'Invalid community ID.' });
      return;
    }

    const allowed = await canUserManageCommunity(req.user!, communityId);
    if (!allowed) {
      res.status(403).json({ error: 'Only community admins or HOD can add groups.' });
      return;
    }

    const name = String(req.body?.name ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const groupType = req.body?.groupType === 'announcements' ? 'announcements' : 'group';
    const onlyAdminsCanPost =
      groupType === 'announcements' ? true : Boolean(req.body?.onlyAdminsCanPost);

    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: 'Group name must be between 2 and 80 characters.' });
      return;
    }

    const [created] = await db
      .insert(communityGroups)
      .values({
        communityId,
        name,
        description,
        groupType,
        onlyAdminsCanPost,
        createdByUserId: req.user!.id,
      })
      .returning();

    wsHub.emitCommunityChanged();
    res.status(201).json({ group: created });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(400).json({ error: 'Unable to create group (ensure group name is unique in this community).' });
  }
});

app.patch('/api/communities/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const groupId = Number.parseInt(String(req.params.groupId), 10);
    if (!Number.isFinite(groupId)) {
      res.status(400).json({ error: 'Invalid group ID.' });
      return;
    }

    const existing = await db
      .select()
      .from(communityGroups)
      .where(eq(communityGroups.id, groupId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const allowed = await canUserManageCommunity(req.user!, existing[0].communityId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have authority to edit this group.' });
      return;
    }

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
    const description =
      req.body?.description !== undefined ? String(req.body.description).trim() : undefined;
    const onlyAdminsCanPost =
      req.body?.onlyAdminsCanPost !== undefined ? Boolean(req.body.onlyAdminsCanPost) : undefined;

    const [updated] = await db
      .update(communityGroups)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(onlyAdminsCanPost !== undefined ? { onlyAdminsCanPost } : {}),
        updatedAt: new Date(),
      })
      .where(eq(communityGroups.id, groupId))
      .returning();

    wsHub.emitCommunityChanged();
    res.json({ group: updated });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(400).json({ error: 'Unable to update group.' });
  }
});

app.delete('/api/communities/groups/:groupId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const groupId = Number.parseInt(String(req.params.groupId), 10);
    if (!Number.isFinite(groupId)) {
      res.status(400).json({ error: 'Invalid group ID.' });
      return;
    }

    const existing = await db
      .select()
      .from(communityGroups)
      .where(eq(communityGroups.id, groupId))
      .limit(1);
    if (!existing[0]) {
      res.status(404).json({ error: 'Group not found.' });
      return;
    }

    const allowed = await canUserManageCommunity(req.user!, existing[0].communityId);
    if (!allowed) {
      res.status(403).json({ error: 'You do not have authority to delete this group.' });
      return;
    }

    await db.delete(communityGroups).where(eq(communityGroups.id, groupId));
    wsHub.emitCommunityChanged();
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ error: 'Unable to delete group.' });
  }
});

app.get('/api/communities/groups/:groupId/messages', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const groupId = Number.parseInt(String(req.params.groupId), 10);
    if (!Number.isFinite(groupId)) {
      res.status(400).json({ error: 'Invalid group ID.' });
      return;
    }
    const messages = await listGroupMessages(groupId, req.user!.id);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load messages.' });
  }
});

// Secure chat attachment upload (Documents, Photos, Voice Notes)
app.post(
  '/api/communities/groups/:groupId/attachments',
  requireAuth,
  upload.single('file'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const groupId = Number.parseInt(String(req.params.groupId), 10);
      if (!Number.isFinite(groupId)) {
        res.status(400).json({ error: 'Invalid group ID.' });
        return;
      }

      const groupRows = await db
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, groupId))
        .limit(1);
      const group = groupRows[0];
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }

      if (group.onlyAdminsCanPost) {
        const canManage = await canUserManageCommunity(req.user!, group.communityId);
        if (!canManage && req.user!.role !== 'class_advisor') {
          res.status(403).json({
            error: 'Only community admins, HOD, or Class Advisors can post attachments in this channel.',
          });
          return;
        }
      }

      if (!req.file) {
        res.status(400).json({ error: 'Attach a document, photo, or voice recording file.' });
        return;
      }

      const rawName = path.basename(req.file.originalname || 'attachment');
      const ext = path.extname(rawName).toLowerCase() || '.bin';
      if (!ALLOWED_CHAT_EXTENSIONS.has(ext)) {
        res.status(400).json({
          error: `File type "${ext}" is not permitted. Supported: PDF, Word, Excel, PowerPoint, CSV, TXT, ZIP, PNG/JPG/WEBP/GIF photos, and audio voice notes.`,
        });
        return;
      }

      const fileKey = `${crypto.randomUUID()}${ext}`;
      const targetPath = path.resolve(CHAT_UPLOADS_DIR, fileKey);
      if (!targetPath.startsWith(CHAT_UPLOADS_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid file destination.' });
        return;
      }

      fs.writeFileSync(targetPath, req.file.buffer);

      const mimeType = req.file.mimetype || 'application/octet-stream';
      const inferredKind: ChatAttachmentType =
        mimeType.startsWith('image/') && !mimeType.includes('svg')
          ? 'photo'
          : mimeType.startsWith('audio/')
          ? 'voice'
          : 'document';

      res.status(201).json({
        attachmentType: inferredKind,
        attachment: {
          fileKey,
          fileName: rawName.slice(0, 160),
          mimeType,
          fileSize: req.file.size,
        },
      });
    } catch (error) {
      console.error('Chat attachment upload failed:', error);
      res.status(500).json({ error: 'Unable to upload attachment.' });
    }
  }
);

// Authenticated attachment download / inline media preview (path-confined)
app.get('/api/communities/attachments/:fileKey', requireAuth, (req, res) => {
  try {
    const fileKey = path.basename(String(req.params.fileKey ?? ''));
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fileKey)) {
      res.status(400).json({ error: 'Invalid attachment key.' });
      return;
    }

    const fullPath = path.resolve(CHAT_UPLOADS_DIR, fileKey);
    if (!fullPath.startsWith(CHAT_UPLOADS_DIR + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const ext = path.extname(fileKey).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.mp4': 'audio/mp4',
      '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.pdf': 'application/pdf',
      '.csv': 'text/csv; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.zip': 'application/zip',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const isInlineSafe = INLINE_SAFE_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix));
    const requestedName = String(req.query.name ?? fileKey).replace(/["\r\n]/g, '').slice(0, 140);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${isInlineSafe && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${requestedName}"`
    );
    res.sendFile(fullPath);
  } catch (error) {
    console.error('Attachment download failed:', error);
    res.status(500).json({ error: 'Unable to retrieve attachment.' });
  }
});

app.get('/api/communities/power-boost/active', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const alerts = await listActivePowerBoostAlertsForUser(req.user!.id);
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load Power Boost alerts.' });
  }
});

app.get('/api/communities/calls/active', requireAuth, (_req, res) => {
  res.json({ activeCalls: wsHub.getActiveCallsSnapshot() });
});

app.post(
  '/api/communities/groups/:groupId/messages',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const groupId = Number.parseInt(String(req.params.groupId), 10);
      if (!Number.isFinite(groupId)) {
        res.status(400).json({ error: 'Invalid group ID.' });
        return;
      }

      const groupRows = await db
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, groupId))
        .limit(1);
      const group = groupRows[0];
      if (!group) {
        res.status(404).json({ error: 'Group not found.' });
        return;
      }

      if (group.onlyAdminsCanPost) {
        const canManage = await canUserManageCommunity(req.user!, group.communityId);
        if (!canManage && req.user!.role !== 'class_advisor') {
          res.status(403).json({
            error: 'Only community admins, HOD, or Class Advisors can post in this announcement group.',
          });
          return;
        }
      }

      const validAttachmentTypes: ChatAttachmentType[] = [
        'none',
        'document',
        'photo',
        'contact',
        'location',
        'voice',
        'shared_link',
        'call_invite',
      ];
      const rawAttachType = String(req.body?.attachmentType ?? 'none') as ChatAttachmentType;
      const attachmentType: ChatAttachmentType = validAttachmentTypes.includes(rawAttachType)
        ? rawAttachType
        : 'none';

      let attachment: ChatAttachmentPayload | null = null;
      if (attachmentType !== 'none' && req.body?.attachment && typeof req.body.attachment === 'object') {
        const raw = req.body.attachment as Record<string, unknown>;
        if (attachmentType === 'document' || attachmentType === 'photo' || attachmentType === 'voice') {
          const fk = path.basename(String(raw.fileKey ?? ''));
          if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fk)) {
            res.status(400).json({ error: 'Invalid attachment reference.' });
            return;
          }
          attachment = {
            fileKey: fk,
            fileName: String(raw.fileName ?? fk).slice(0, 160),
            mimeType: String(raw.mimeType ?? 'application/octet-stream').slice(0, 100),
            fileSize: Number(raw.fileSize || 0),
            durationSec: raw.durationSec ? Number(raw.durationSec) : undefined,
          };
        } else if (attachmentType === 'contact') {
          const contactName = String(raw.contactName ?? '').trim().slice(0, 120);
          if (!contactName) {
            res.status(400).json({ error: 'Contact name is required.' });
            return;
          }
          attachment = {
            contactName,
            contactRole: String(raw.contactRole ?? '').trim().slice(0, 80),
            contactDepartment: String(raw.contactDepartment ?? '').trim().slice(0, 120),
            contactId: String(raw.contactId ?? '').trim().slice(0, 60),
            contactEmail: String(raw.contactEmail ?? '').trim().slice(0, 120),
            contactPhone: String(raw.contactPhone ?? '').trim().slice(0, 40),
          };
        } else if (attachmentType === 'location') {
          const latitude = Number(raw.latitude);
          const longitude = Number(raw.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
            return;
          }
          attachment = {
            latitude: Number(latitude.toFixed(6)),
            longitude: Number(longitude.toFixed(6)),
            accuracyMeters: raw.accuracyMeters ? Math.round(Number(raw.accuracyMeters)) : undefined,
            locationLabel: String(raw.locationLabel ?? 'Live Campus Location').trim().slice(0, 160),
            isLiveLocation: Boolean(raw.isLiveLocation),
          };
        } else if (attachmentType === 'shared_link') {
          const safeUrl = sanitizeHttpUrl(raw.url);
          if (!safeUrl) {
            res.status(400).json({ error: 'Provide a valid http:// or https:// URL to share.' });
            return;
          }
          let hostname = 'Web Link';
          try {
            hostname = new URL(safeUrl).hostname.replace(/^www\./, '');
          } catch {
            // fallback
          }
          attachment = {
            url: safeUrl,
            title: String(raw.title ?? hostname).trim().slice(0, 160),
            sourceApp: String(raw.sourceApp ?? hostname).trim().slice(0, 80),
          };
        } else if (attachmentType === 'call_invite') {
          attachment = {
            callMode: raw.callMode === 'audio' ? 'audio' : 'video',
            callRoomId: `group-${groupId}`,
          };
        }
      }

      const rawContent = String(req.body?.content ?? '').trim();
      const defaultFallbackContent =
        attachmentType === 'document'
          ? `Shared document: ${attachment?.fileName ?? 'File'}`
          : attachmentType === 'photo'
          ? `Shared photo: ${attachment?.fileName ?? 'Image'}`
          : attachmentType === 'voice'
          ? 'Sent a voice message'
          : attachmentType === 'contact'
          ? `Shared contact: ${attachment?.contactName ?? 'Contact'}`
          : attachmentType === 'location'
          ? `Shared live location: ${attachment?.locationLabel ?? 'Campus'}`
          : attachmentType === 'shared_link'
          ? attachment?.title || attachment?.url || 'Shared link'
          : attachmentType === 'call_invite'
          ? attachment?.callMode === 'audio'
            ? 'Started a Group Audio Call'
            : 'Started a Group Video Call (Meet)'
          : '';

      const content = rawContent || defaultFallbackContent;
      if (!content || content.length > 2000) {
        res.status(400).json({ error: 'Message must be between 1 and 2000 characters.' });
        return;
      }

      // Power Boost Mode validation (only HOD, Class Advisor, Class Rep)
      const requestedPowerBoost = Boolean(req.body?.powerBoostEnabled);
      if (requestedPowerBoost && !POWER_BOOST_ROLES.includes(req.user!.role)) {
        res.status(403).json({
          error: 'Power Boost repeat notifications can only be enabled by HOD, Class Advisors, or Class Representatives.',
        });
        return;
      }

      const powerBoostIntervalMinutes = requestedPowerBoost
        ? Math.max(1, Math.min(240, Number(req.body?.powerBoostIntervalMinutes || 5)))
        : 0;
      const durationHours = Number(req.body?.powerBoostDurationHours ?? 24);
      const powerBoostExpiresAt =
        requestedPowerBoost && Number.isFinite(durationHours) && durationHours > 0
          ? new Date(Date.now() + Math.min(durationHours, 168) * 60 * 60 * 1000)
          : null;
      const explicitActionUrl = sanitizeHttpUrl(req.body?.powerBoostActionUrl);
      const powerBoostActionUrl = requestedPowerBoost
        ? explicitActionUrl ||
          (attachmentType === 'shared_link' ? attachment?.url ?? '' : '') ||
          detectFirstUrl(content)
        : '';

      const replyToId =
        typeof req.body?.replyToId === 'number' ? req.body.replyToId : null;
      const messageType =
        attachmentType === 'call_invite'
          ? 'call_invite'
          : group.groupType === 'announcements'
          ? 'announcement'
          : 'text';

      const created = await createChatMessageInDb({
        groupId,
        user: req.user!,
        content,
        messageType,
        attachmentType,
        attachment,
        powerBoostEnabled: requestedPowerBoost,
        powerBoostIntervalMinutes,
        powerBoostExpiresAt,
        powerBoostActionUrl,
        replyToId,
      });

      const parentCommunity = await db
        .select({ name: communities.name })
        .from(communities)
        .where(eq(communities.id, group.communityId))
        .limit(1);

      wsHub.emitMessageCreated(created, {
        groupName: group.name,
        communityName: parentCommunity[0]?.name ?? '',
      });

      // If replying directly to an active Power Boost message, automatically acknowledge it to stop alerts for this user
      if (replyToId) {
        const parentRows = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.id, replyToId))
          .limit(1);
        if (parentRows[0]?.powerBoostEnabled && parentRows[0].senderUserId !== req.user!.id) {
          const ackResult = await acknowledgePowerBoostMessage({
            messageId: replyToId,
            user: req.user!,
            responseNote: `Replied: ${content.slice(0, 120)}`,
          });
          if (ackResult) {
            wsHub.emitPowerBoostAcknowledged(
              ackResult.groupId,
              replyToId,
              ackResult.acknowledgement
            );
          }
        }
      }

      res.status(201).json({ message: created });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to send message.' });
    }
  }
);

app.post(
  '/api/communities/messages/:messageId/acknowledge',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const messageId = Number.parseInt(String(req.params.messageId), 10);
      if (!Number.isFinite(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const responseNote = String(req.body?.responseNote ?? '').trim() || 'Responded / Completed';
      const result = await acknowledgePowerBoostMessage({
        messageId,
        user: req.user!,
        responseNote,
      });

      if (!result) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      wsHub.emitPowerBoostAcknowledged(result.groupId, messageId, result.acknowledgement);
      res.json({ ok: true, acknowledgement: result.acknowledgement });
    } catch (error) {
      console.error('Power Boost acknowledge error:', error);
      res.status(500).json({ error: 'Unable to record response.' });
    }
  }
);

app.post(
  '/api/communities/messages/:messageId/power-boost/stop',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const messageId = Number.parseInt(String(req.params.messageId), 10);
      if (!Number.isFinite(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const msgRows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);
      const msg = msgRows[0];
      if (!msg) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      const groupRows = await db
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, msg.groupId))
        .limit(1);
      const isAdmin = groupRows[0]
        ? await canUserManageCommunity(req.user!, groupRows[0].communityId)
        : false;
      const isAuthor = msg.senderUserId === req.user!.id;

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ error: 'Only the sender or community admin can stop Power Boost.' });
        return;
      }

      const groupId = await stopPowerBoostMessage(messageId);
      if (groupId !== null) {
        wsHub.emitPowerBoostStopped(groupId, messageId);
      }
      res.json({ ok: true });
    } catch (error) {
      console.error('Stop Power Boost error:', error);
      res.status(500).json({ error: 'Unable to stop Power Boost mode.' });
    }
  }
);

app.get(
  '/api/communities/power-boost/stats',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const rawGroupId = req.query.groupId;
      const parsedGroupId =
        typeof rawGroupId === 'string' && rawGroupId.trim() !== ''
          ? Number.parseInt(rawGroupId, 10)
          : undefined;
      if (parsedGroupId !== undefined && !Number.isFinite(parsedGroupId)) {
        res.status(400).json({ error: 'Invalid groupId filter.' });
        return;
      }
      const summary = await getPowerBoostEngagementSummary(parsedGroupId);
      res.json(summary);
    } catch (error) {
      console.error('Power Boost stats error:', error);
      res.status(500).json({ error: 'Unable to load Power Boost engagement statistics.' });
    }
  }
);

app.patch(
  '/api/communities/messages/:messageId',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const messageId = Number.parseInt(String(req.params.messageId), 10);
      if (!Number.isFinite(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const msgRows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);
      const msg = msgRows[0];
      if (!msg) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      const groupRows = await db
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, msg.groupId))
        .limit(1);
      const isAdmin = groupRows[0]
        ? await canUserManageCommunity(req.user!, groupRows[0].communityId)
        : false;
      const isAuthor = msg.senderUserId === req.user!.id;

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ error: 'You cannot edit this message.' });
        return;
      }

      const content =
        req.body?.content !== undefined ? String(req.body.content).trim() : msg.content;
      const isPinned =
        req.body?.isPinned !== undefined && isAdmin ? Boolean(req.body.isPinned) : msg.isPinned;

      if (!content || content.length > 2000) {
        res.status(400).json({ error: 'Message content must be 1-2000 characters.' });
        return;
      }

      const [updated] = await db
        .update(chatMessages)
        .set({
          content,
          isPinned,
          editedAt: content !== msg.content ? new Date() : msg.editedAt,
        })
        .where(eq(chatMessages.id, messageId))
        .returning();

      const ackRows = await db
        .select()
        .from(messageAcknowledgements)
        .where(eq(messageAcknowledgements.messageId, messageId));

      const senderMetaLookup = await getSenderMetaLookup(
        updated.senderUserId !== null ? [updated.senderUserId] : []
      );
      const mapped = mapChatMessageRow(
        updated,
        ackRows.map((a) => ({
          id: a.id,
          messageId: a.messageId,
          userId: a.userId,
          userName: a.userName,
          userRole: a.userRole,
          responseNote: a.responseNote,
          acknowledgedAt: a.acknowledgedAt.toISOString().replace('T', ' ').slice(0, 19),
        })),
        req.user!.id,
        updated.senderUserId !== null ? senderMetaLookup.get(updated.senderUserId) : undefined
      );

      wsHub.emitMessageUpdated(mapped);
      res.json({ message: mapped });
    } catch (error) {
      console.error('Update message error:', error);
      res.status(500).json({ error: 'Failed to update message.' });
    }
  }
);

app.delete(
  '/api/communities/messages/:messageId',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const messageId = Number.parseInt(String(req.params.messageId), 10);
      if (!Number.isFinite(messageId)) {
        res.status(400).json({ error: 'Invalid message ID.' });
        return;
      }

      const msgRows = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, messageId))
        .limit(1);
      const msg = msgRows[0];
      if (!msg) {
        res.status(404).json({ error: 'Message not found.' });
        return;
      }

      const groupRows = await db
        .select()
        .from(communityGroups)
        .where(eq(communityGroups.id, msg.groupId))
        .limit(1);
      const isAdmin = groupRows[0]
        ? await canUserManageCommunity(req.user!, groupRows[0].communityId)
        : false;
      const isAuthor = msg.senderUserId === req.user!.id;

      if (!isAuthor && !isAdmin) {
        res.status(403).json({ error: 'You cannot delete this message.' });
        return;
      }

      await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
      wsHub.emitMessageDeleted(msg.groupId, messageId);
      res.json({ ok: true });
    } catch (error) {
      console.error('Delete message error:', error);
      res.status(500).json({ error: 'Failed to delete message.' });
    }
  }
);

// ============================================================
// 7. Daily Timetable Dual-Camera Attendance APIs (2 Live Photos)
// ============================================================
app.get('/api/attendance/today', requireAuth, async (_req, res) => {
  try {
    await ensureBaselineData();
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);

    const allSlots = await listTimetableSlots();
    const todaySlots = allSlots.filter((s) => s.dayOfWeek === serverTime.weekday);
    const records = await listAttendanceRecords({ date: serverTime.isoDate });

    res.json({
      serverTime,
      todaySlots,
      allSlots,
      records,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load daily attendance.',
    });
  }
});

app.get('/api/attendance/history', requireAuth, async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date).trim() : undefined;
    const personType =
      req.query.personType === 'student' || req.query.personType === 'faculty'
        ? (req.query.personType as AttendancePersonType)
        : undefined;
    const records = await listAttendanceRecords({ date, personType });
    res.json({ records });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load attendance history.',
    });
  }
});

app.get('/api/attendance/monthly-trends', requireAuth, async (req, res) => {
  try {
    await ensureBaselineData();
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);

    const rawMonth = req.query.month ? String(req.query.month).trim() : serverTime.isoDate.slice(0, 7);
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : serverTime.isoDate.slice(0, 7);
    const personType =
      req.query.personType === 'student' || req.query.personType === 'faculty'
        ? (req.query.personType as AttendancePersonType)
        : undefined;

    const [yearNum, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
    const monthDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
    const monthLabel = new Intl.DateTimeFormat('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(monthDate);
    const shortMonth = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      timeZone: 'UTC',
    }).format(monthDate);

    const rows = await listAttendanceSummaryForMonth(month, personType);

    const bucketMap = new Map<
      string,
      { present: number; rejected: number; studentsPresent: number; facultyPresent: number }
    >();

    for (const row of rows) {
      const bucket = bucketMap.get(row.attendanceDate) ?? {
        present: 0,
        rejected: 0,
        studentsPresent: 0,
        facultyPresent: 0,
      };
      if (row.status === 'present' || row.status === 'late') {
        bucket.present += 1;
        if (row.personType === 'student') bucket.studentsPresent += 1;
        else if (row.personType === 'faculty') bucket.facultyPresent += 1;
      } else {
        bucket.rejected += 1;
      }
      bucketMap.set(row.attendanceDate, bucket);
    }

    let totalPresent = 0;
    let totalRejected = 0;
    let studentPresent = 0;
    let facultyPresent = 0;
    let activeDays = 0;

    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = String(day).padStart(2, '0');
      const dateKey = `${month}-${dayStr}`;
      const bucket = bucketMap.get(dateKey) ?? {
        present: 0,
        rejected: 0,
        studentsPresent: 0,
        facultyPresent: 0,
      };
      const total = bucket.present + bucket.rejected;
      if (total > 0) activeDays += 1;

      totalPresent += bucket.present;
      totalRejected += bucket.rejected;
      studentPresent += bucket.studentsPresent;
      facultyPresent += bucket.facultyPresent;

      days.push({
        date: dateKey,
        day,
        label: `${shortMonth} ${day}`,
        present: bucket.present,
        rejected: bucket.rejected,
        studentsPresent: bucket.studentsPresent,
        facultyPresent: bucket.facultyPresent,
        total,
        verificationRate: total > 0 ? Math.round((bucket.present / total) * 100) : null,
      });
    }

    const totalRecords = totalPresent + totalRejected;
    const overallRate = totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

    res.json({
      month,
      monthLabel,
      departmentName: dept,
      totalRecords,
      totalPresent,
      totalRejected,
      studentPresent,
      facultyPresent,
      activeDays,
      overallRate,
      days,
    });
  } catch (error) {
    console.error('Monthly attendance trends failed:', error);
    res.status(500).json({
      error:
        error instanceof Error ? error.message : 'Unable to load monthly attendance trends.',
    });
  }
});

app.get('/api/attendance/export/:format', requireAuth, async (req, res) => {
  try {
    const format = String(req.params.format ?? '').toLowerCase();
    if (format !== 'csv' && format !== 'pdf' && format !== 'xlsx') {
      res.status(400).json({ error: 'Export format must be csv, pdf, or xlsx.' });
      return;
    }

    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);

    const scopeParam = req.query.scope ? String(req.query.scope).trim().toLowerCase() : 'date';
    const exportAllDates = scopeParam === 'all_dates';
    const exportMonthlySummary = scopeParam === 'month';

    const rawDate = req.query.date ? String(req.query.date).trim() : serverTime.isoDate;
    const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : serverTime.isoDate;

    const rawMonth = req.query.month
      ? String(req.query.month).trim()
      : targetDate.slice(0, 7);
    const targetMonth = /^\d{4}-\d{2}$/.test(rawMonth)
      ? rawMonth
      : serverTime.isoDate.slice(0, 7);

    const personType =
      req.query.personType === 'student' || req.query.personType === 'faculty'
        ? (req.query.personType as AttendancePersonType)
        : undefined;

    const scopeSlug = personType ? personType : 'all';
    const scopeLabel =
      personType === 'student'
        ? 'Students Only'
        : personType === 'faculty'
        ? 'Department Faculty Only'
        : 'All Students & Faculty';

    if (exportMonthlySummary) {
      const [yearNum, monthNum] = targetMonth.split('-').map(Number);
      const monthDate = new Date(Date.UTC(yearNum, monthNum - 1, 1));
      const monthLabel = new Intl.DateTimeFormat('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(monthDate);

      const records = await listAttendanceRecords({
        month: targetMonth,
        personType,
        limit: 2500,
      });

      const meta = {
        departmentName: dept,
        attendanceDate: monthLabel,
        monthLabel,
        scopeLabel,
        generatedAt: `${serverTime.formattedDate} ${serverTime.formattedTime} (${serverTime.academicTimezone})`,
      };

      const filename = `ChromaGrade_Monthly_Summary_${targetMonth}_${scopeSlug}.${format}`;
      if (format === 'csv') {
        const buf = buildMonthlySummaryCsvBuffer(records, meta);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buf);
        return;
      }
      if (format === 'xlsx') {
        const buf = await buildMonthlySummaryXlsxBuffer(records, meta);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buf);
        return;
      }

      const buf = buildMonthlySummaryPdfBuffer(records, meta);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
      return;
    }

    const records = await listAttendanceRecords({
      date: exportAllDates ? undefined : targetDate,
      personType,
    });

    const dateLabel = exportAllDates ? 'All Recorded Dates' : targetDate;
    const dateFileSlug = exportAllDates ? 'all_dates' : targetDate;

    const meta = {
      departmentName: dept,
      attendanceDate: dateLabel,
      scopeLabel,
      generatedAt: `${serverTime.formattedDate} ${serverTime.formattedTime} (${serverTime.academicTimezone})`,
    };

    const filename = `ChromaGrade_Attendance_${dateFileSlug}_${scopeSlug}.${format}`;
    if (format === 'csv') {
      const buf = buildAttendanceCsvBuffer(records, meta);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
      return;
    }
    if (format === 'xlsx') {
      const buf = await buildAttendanceXlsxBuffer(records, meta);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(buf);
      return;
    }

    const buf = buildAttendancePdfBuffer(records, meta);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (error) {
    console.error('Attendance export failed:', error);
    res.status(500).json({ error: 'Unable to export attendance log.' });
  }
});

app.get('/api/attendance/pinned-location', requireAuth, async (_req, res) => {
  try {
    const pinnedLocation = await getPinnedLocationConfig();
    res.json({ pinnedLocation });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load pinned location.' });
  }
});

app.patch(
  '/api/attendance/pinned-location',
  requireAuth,
  requireRoles('hod', 'class_advisor'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const label = String(req.body?.label ?? '').trim() || 'Department Classroom Zone';
      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      const radiusMeters = Number(req.body?.radiusMeters ?? 200);

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        res.status(400).json({ error: 'Valid latitude (-90..90) and longitude (-180..180) are required.' });
        return;
      }

      const pinnedLocation = await savePinnedLocationConfig({
        label,
        latitude,
        longitude,
        radiusMeters: Number.isFinite(radiusMeters) ? radiusMeters : 200,
        updatedBy: req.user!.fullName,
      });

      res.json({ pinnedLocation });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to save pinned location.' });
    }
  }
);

app.get('/api/attendance/biometric-profiles', requireAuth, async (_req, res) => {
  try {
    const profiles = await listStudentBiometricSummaries();
    res.json({ profiles });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to load biometric profiles.' });
  }
});

app.get('/api/attendance/weekly-trends', requireAuth, async (req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);

    const personType =
      req.query.personType === 'student' || req.query.personType === 'faculty'
        ? (req.query.personType as AttendancePersonType)
        : undefined;

    const weeksCount = Math.max(4, Math.min(12, Number(req.query.weeks) || 6));

    // Parse current server date (YYYY-MM-DD) in UTC midnight arithmetic
    const [yr, mo, dy] = serverTime.isoDate.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(yr, mo - 1, dy));
    const dow = todayUtc.getUTCDay(); // 0=Sun, 1=Mon
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const currentWeekMonday = new Date(todayUtc);
    currentWeekMonday.setUTCDate(todayUtc.getUTCDate() + diffToMonday);

    const toIso = (d: Date) => d.toISOString().slice(0, 10);
    const fmtShortDate = (d: Date) =>
      new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(d);

    const allRecords = await listAttendanceRecords({ personType, limit: 4000 });

    // 1. Current Week Daily Fluctuation (Mon - Sat)
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekDays = dayNames.map((dayName, idx) => {
      const d = new Date(currentWeekMonday);
      d.setUTCDate(currentWeekMonday.getUTCDate() + idx);
      const iso = toIso(d);
      let present = 0;
      let rejected = 0;
      let studentsPresent = 0;
      let facultyPresent = 0;
      for (const rec of allRecords) {
        if (rec.attendanceDate === iso) {
          if (rec.status === 'present' || rec.status === 'late') {
            present++;
            if (rec.personType === 'student') studentsPresent++;
            else facultyPresent++;
          } else {
            rejected++;
          }
        }
      }
      const total = present + rejected;
      return {
        date: iso,
        dayName,
        shortDay: shortNames[idx],
        present,
        rejected,
        studentsPresent,
        facultyPresent,
        total,
        verificationRate: total > 0 ? Math.round((present / total) * 100) : 0,
      };
    });

    const currentWeekEnd = new Date(currentWeekMonday);
    currentWeekEnd.setUTCDate(currentWeekMonday.getUTCDate() + 5);
    const currentWeekRangeLabel = `${fmtShortDate(currentWeekMonday)} – ${fmtShortDate(currentWeekEnd)}`;

    // 2. Past N Weeks Department Weekly History
    const weeklyHistory = [];
    for (let w = weeksCount - 1; w >= 0; w--) {
      const wStart = new Date(currentWeekMonday);
      wStart.setUTCDate(currentWeekMonday.getUTCDate() - w * 7);
      const wEnd = new Date(wStart);
      wEnd.setUTCDate(wStart.getUTCDate() + 6);
      const startIso = toIso(wStart);
      const endIso = toIso(wEnd);

      let present = 0;
      let rejected = 0;
      let studentsPresent = 0;
      let facultyPresent = 0;

      for (const rec of allRecords) {
        if (rec.attendanceDate >= startIso && rec.attendanceDate <= endIso) {
          if (rec.status === 'present' || rec.status === 'late') {
            present++;
            if (rec.personType === 'student') studentsPresent++;
            else facultyPresent++;
          } else {
            rejected++;
          }
        }
      }
      const total = present + rejected;
      weeklyHistory.push({
        weekStart: startIso,
        weekEnd: endIso,
        label: w === 0 ? `This Wk (${fmtShortDate(wStart)})` : fmtShortDate(wStart),
        present,
        rejected,
        studentsPresent,
        facultyPresent,
        total,
        verificationRate: total > 0 ? Math.round((present / total) * 100) : 0,
      });
    }

    const totalPresent = weeklyHistory.reduce((acc, w) => acc + w.present, 0);
    const totalRejected = weeklyHistory.reduce((acc, w) => acc + w.rejected, 0);
    const studentPresent = weeklyHistory.reduce((acc, w) => acc + w.studentsPresent, 0);
    const facultyPresent = weeklyHistory.reduce((acc, w) => acc + w.facultyPresent, 0);
    const grandTotal = totalPresent + totalRejected;
    const overallRate = grandTotal > 0 ? Math.round((totalPresent / grandTotal) * 100) : 0;

    const thisWeek = weeklyHistory[weeklyHistory.length - 1];
    const prevWeek = weeklyHistory[weeklyHistory.length - 2];
    const weekOverWeekDeltaPct =
      thisWeek && prevWeek && prevWeek.present > 0
        ? Math.round(((thisWeek.present - prevWeek.present) / prevWeek.present) * 100)
        : null;

    res.json({
      departmentName: dept,
      currentWeekRangeLabel,
      totalPresent,
      totalRejected,
      studentPresent,
      facultyPresent,
      overallRate,
      weekOverWeekDeltaPct,
      currentWeekDays,
      weeklyHistory,
    });
  } catch (error) {
    console.error('Weekly attendance trends failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load weekly attendance trends.',
    });
  }
});

app.get('/api/analytics/departmental-performance', requireAuth, async (req, res) => {
  try {
    const groupBy = req.query.groupBy === 'section' ? 'section' : 'year';
    const payload = await getDepartmentalPerformanceSummary(groupBy);
    res.json(payload);
  } catch (error) {
    console.error('Departmental performance analytics failed:', error);
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Unable to load departmental performance metrics.',
    });
  }
});

// ============================================================
// Profile Transit Buffer Settings & New Analytics/Engagement Endpoints
// ============================================================
app.patch('/api/auth/profile-settings', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rawBuffer = Number(req.body?.transitBufferMinutes ?? 15);
    if (!Number.isFinite(rawBuffer) || rawBuffer < 0 || rawBuffer > 60) {
      res.status(400).json({ error: 'Transit buffer must be between 0 and 60 minutes.' });
      return;
    }
    const updated = await updateUserTransitBuffer(req.user!.id, rawBuffer);
    if (!updated) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }
    res.json({ user: updated });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to save transit buffer setting.',
    });
  }
});

// ============================================================
// Profile Editing, Biometric Photo Lock, Wake-Up Page-Call,
// HOD Leave Delegation & Faculty Alteration Workflows
// ============================================================
app.get('/api/profile/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await findUserWithMetaById(req.user!.id);
    res.json({ user: user ?? req.user! });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to fetch profile details.',
    });
  }
});

app.patch('/api/profile/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (
      req.body?.staffOrRollId !== undefined &&
      String(req.body.staffOrRollId).trim().toUpperCase() !== (req.user!.staffOrRollId || '').toUpperCase() &&
      req.user!.faceRegisteredLocked
    ) {
      res.status(403).json({
        error: 'Roll / Employee ID is locked after face registration for attendance integrity.',
      });
      return;
    }

    const updated = await updateUserProfileInDb({
      userId: req.user!.id,
      fullName: req.body?.fullName !== undefined ? String(req.body.fullName) : undefined,
      phone: req.body?.phone !== undefined ? String(req.body.phone) : undefined,
      designation: req.body?.designation !== undefined ? String(req.body.designation) : undefined,
      specialization:
        req.body?.specialization !== undefined ? String(req.body.specialization) : undefined,
      bio: req.body?.bio !== undefined ? String(req.body.bio) : undefined,
      transitBufferMinutes:
        req.body?.transitBufferMinutes !== undefined
          ? Number(req.body.transitBufferMinutes)
          : undefined,
      profileImageData:
        req.body?.profileImageData !== undefined ? String(req.body.profileImageData) : undefined,
    });
    res.json({ user: updated });
  } catch (error) {
    const status = (error as Error & { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unable to update profile.',
    });
  }
});

app.post('/api/profile/password', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const currentPassword =
      req.body?.currentPassword !== undefined ? String(req.body.currentPassword) : undefined;
    const newPassword = String(req.body?.newPassword ?? '');
    await setUserPasswordInDb({
      userId: req.user!.id,
      currentPassword,
      newPassword,
    });
    res.json({ ok: true, message: 'Institutional password saved successfully.' });
  } catch (error) {
    const status = (error as Error & { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unable to update password.',
    });
  }
});

app.post('/api/profile/register-face', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const faceImageData = String(req.body?.faceImageData ?? '').trim();
    if (!faceImageData || !faceImageData.startsWith('data:image/')) {
      res.status(400).json({ error: 'Capture or upload a valid image before locking your face photo.' });
      return;
    }
    if (req.user!.faceRegisteredLocked) {
      res.status(403).json({
        error: 'Face registration photo is already permanently locked and cannot be edited.',
      });
      return;
    }
    const updated = await registerAndLockUserFace({
      userId: req.user!.id,
      faceImageData,
    });
    res.json({ user: updated ?? req.user! });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to lock registered face photo.',
    });
  }
});

// Biometric Photo Unlock Governance (Students, Faculty & HOD)
app.get('/api/profile/biometric-unlock', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const allRequests = await listBiometricUnlockRequests();
    if (req.user!.role === 'hod') {
      const usersList = await listUsersBiometricLockStatus();
      res.json({ requests: allRequests, users: usersList });
      return;
    }
    const mine = allRequests.filter((r) => r.userId === req.user!.id);
    res.json({ requests: mine, users: [] });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load biometric unlock status.',
    });
  }
});

app.post('/api/profile/biometric-unlock/request', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user!.faceRegisteredLocked) {
      res.status(400).json({ error: 'Your biometric photo is already unlocked and ready for retake.' });
      return;
    }
    const reason = String(req.body?.reason ?? '').trim();
    const requestItem = await createBiometricUnlockRequest({
      user: req.user!,
      reason,
    });
    wsHub.broadcastAll({
      type: 'biometric:unlock_changed',
      userId: req.user!.id,
      action: 'requested',
    });
    res.status(201).json({ request: requestItem });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to submit biometric unlock request.',
    });
  }
});

app.post('/api/hod/biometric-unlock', requireAuth, requireRoles('hod'), async (req: AuthenticatedRequest, res) => {
  try {
    const targetUserId = Number(req.body?.targetUserId);
    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      res.status(400).json({ error: 'Valid targetUserId is required.' });
      return;
    }
    const locked = Boolean(req.body?.locked === true);
    const remarks = String(req.body?.remarks ?? '').trim();
    const updatedUser = await setUserBiometricLockInDb({
      targetUserId,
      locked,
      hodName: req.user!.fullName,
      remarks,
    });
    wsHub.broadcastAll({
      type: 'biometric:unlock_changed',
      userId: targetUserId,
      locked,
    });
    res.json({ user: updatedUser });
  } catch (error) {
    const status = (error as Error & { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unable to update biometric lock permission.',
    });
  }
});

app.patch('/api/hod/biometric-unlock/requests/:id', requireAuth, requireRoles('hod'), async (req: AuthenticatedRequest, res) => {
  try {
    const requestId = String(req.params.id || '').trim();
    const decision = req.body?.decision === 'reject' ? 'reject' : 'approve';
    const remarks = String(req.body?.remarks ?? '').trim();
    const result = await decideBiometricUnlockRequestInDb({
      requestId,
      decision,
      hodName: req.user!.fullName,
      remarks,
    });
    wsHub.broadcastAll({
      type: 'biometric:unlock_changed',
      userId: result.request.userId,
      locked: decision === 'approve' ? false : true,
    });
    res.json(result);
  } catch (error) {
    const status = (error as Error & { statusCode?: number }).statusCode || 500;
    res.status(status).json({
      error: error instanceof Error ? error.message : 'Unable to decide biometric unlock request.',
    });
  }
});

app.post('/api/profile/page-call', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const targetName = String(req.body?.targetName ?? '').trim();
    const targetPhone = String(req.body?.targetPhone ?? '').trim();
    const targetRole = String(req.body?.targetRole ?? '').trim();
    const targetEmail = String(req.body?.targetEmail ?? '').trim().toLowerCase();
    const targetIdRaw = req.body?.targetUserId;
    const message = String(req.body?.message ?? '').trim().slice(0, 240);

    if (!targetName) {
      res.status(400).json({ error: 'Recipient name is required to dispatch a Wake-Up Page-Call.' });
      return;
    }

    let resolvedUserId: number | null =
      typeof targetIdRaw === 'number' && Number.isFinite(targetIdRaw) ? targetIdRaw : null;
    if (!resolvedUserId && targetEmail) {
      const matched = await findUserByEmail(targetEmail);
      if (matched) resolvedUserId = matched.id;
    }

    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', req.user!.department);
    const serverTime = computeServerTimeStatus(tz, dept);

    const payload = {
      callerUserId: req.user!.id,
      callerName: req.user!.fullName,
      callerRole: req.user!.role,
      callerPhone: req.user!.phone || '',
      targetUserId: resolvedUserId,
      targetName,
      targetEmail,
      targetPhone,
      targetRole,
      reason:
        message ||
        `Urgent Wake-Up Page-Call from ${req.user!.fullName} — please respond immediately.`,
      message:
        message ||
        `Urgent Wake-Up Page-Call from ${req.user!.fullName} — please respond immediately.`,
      sentAt: `${serverTime.formattedDate} · ${serverTime.formattedTime}`,
      triggeredAt: `${serverTime.formattedDate} · ${serverTime.formattedTime}`,
    };

    wsHub.emitWakeUpPageCall(payload);
    res.status(201).json({ ok: true, pageCall: payload });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to dispatch Wake-Up Page-Call.',
    });
  }
});

app.get('/api/records/hod', requireAuth, async (_req, res) => {
  try {
    const [hodRecords, activeDelegation] = await Promise.all([
      listHodDirectoryRecords(),
      getActiveHodDelegation(),
    ]);
    res.json({ hodRecords, activeDelegation });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load HOD records.',
    });
  }
});

app.get('/api/hod/delegation', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const activeDelegation = await getActiveHodDelegation();
    const candidates =
      req.user!.role === 'hod'
        ? await listApprovedStaffForDelegation(req.user!.id)
        : [];
    res.json({ activeDelegation, candidates });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load HOD delegation details.',
    });
  }
});

app.post(
  '/api/hod/delegate',
  requireAuth,
  requireRoles('hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const delegateUserId = Number(req.body?.delegateUserId);
      const reason = String(req.body?.reason ?? '').trim();
      if (!Number.isInteger(delegateUserId) || delegateUserId <= 0) {
        res.status(400).json({ error: 'Select an approved faculty member or Class Advisor.' });
        return;
      }

      const result = await delegateHodRoleInDb({
        hodUser: req.user!,
        delegateUserId,
        reason,
      });

      wsHub.emitHodDelegationChanged(result.delegation);

      res.status(201).json({
        delegation: result.delegation,
        user: result.updatedActor,
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to delegate HOD control.',
      });
    }
  }
);

app.post('/api/hod/restore', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await restoreHodRoleInDb(req.user!);
    wsHub.emitHodDelegationChanged(result.delegation);
    res.json({
      delegation: result.delegation,
      user: result.updatedActor,
    });
  } catch (error) {
    res.status(403).json({
      error: error instanceof Error ? error.message : 'Unable to restore HOD control.',
    });
  }
});

app.get('/api/faculty-alterations', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const [alterations, candidates] = await Promise.all([
      listFacultyAlterationsForUser(req.user!),
      listSubstituteCandidates(),
    ]);
    res.json({ alterations, candidates });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load faculty alterations.',
    });
  }
});

app.post(
  '/api/faculty-alterations',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'dept_staff', 'other_dept_staff'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting(
        'department_name',
        req.user!.department || 'Computer Science & Engineering'
      );
      const serverTime = computeServerTimeStatus(tz, dept);

      const timetableSlotId =
        typeof req.body?.timetableSlotId === 'number' && Number.isFinite(req.body.timetableSlotId)
          ? req.body.timetableSlotId
          : null;
      const substituteUserId =
        typeof req.body?.substituteUserId === 'number' && Number.isFinite(req.body.substituteUserId)
          ? req.body.substituteUserId
          : null;
      const substituteFacultyName = String(req.body?.substituteFacultyName ?? '').trim();
      const rawCat = String(req.body?.reasonCategory ?? 'busy').trim().toLowerCase();
      const reasonCategory: 'busy' | 'od' | 'absent' =
        rawCat === 'od' ? 'od' : rawCat === 'absent' ? 'absent' : 'busy';
      const reasonNote = String(req.body?.reasonNote ?? '').trim();
      const alterationDate = String(req.body?.alterationDate ?? serverTime.isoDate).trim();

      if (!substituteFacultyName) {
        res.status(400).json({ error: 'Select or enter the substitute faculty member.' });
        return;
      }

      const created = await createFacultyAlterationRequest({
        timetableSlotId,
        alterationDate,
        substituteFacultyName,
        substituteUserId,
        substituteEmail: String(req.body?.substituteEmail ?? ''),
        substitutePhone: String(req.body?.substitutePhone ?? ''),
        reasonCategory,
        reasonNote,
        user: req.user!,
        departmentFallback: dept,
        dayFallback: String(req.body?.dayOfWeek ?? serverTime.weekday),
        periodFallback: Number(req.body?.periodNumber ?? serverTime.activePeriod?.periodNumber ?? 1),
        subjectCodeFallback: String(req.body?.subjectCode ?? 'CLASS'),
        subjectNameFallback: String(req.body?.subjectName ?? 'Scheduled Class'),
        yearFallback: String(req.body?.yearOfStudy ?? req.user!.yearOfStudy ?? 'III Year'),
        sectionFallback: String(req.body?.section ?? req.user!.section ?? 'A'),
        roomFallback: String(req.body?.roomNo ?? ''),
      });

      wsHub.emitFacultyAlterationChanged(created);
      res.status(201).json({ alteration: created });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error ? error.message : 'Unable to submit faculty alteration request.',
      });
    }
  }
);

app.patch(
  '/api/faculty-alterations/:id/decision',
  requireAuth,
  requireRoles('hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid faculty alteration ID.' });
        return;
      }
      const decision: 'approve' | 'reject' =
        req.body?.decision === 'reject' ? 'reject' : 'approve';
      const remarks = String(req.body?.remarks ?? '').trim();

      const updated = await decideFacultyAlteration({
        id,
        reviewer: req.user!,
        decision,
        remarks,
      });

      if (!updated) {
        res.status(404).json({ error: 'Faculty alteration request not found.' });
        return;
      }

      wsHub.emitFacultyAlterationChanged(updated);
      res.json({ alteration: updated });
    } catch (error) {
      res.status(500).json({
        error:
          error instanceof Error ? error.message : 'Unable to process faculty alteration decision.',
      });
    }
  }
);

app.get('/api/analytics/student-achievements', requireAuth, async (req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const batch = typeof req.query.batch === 'string' ? req.query.batch.trim() : 'all';
    const payload = await getStudentAchievements(serverTime.isoDate, batch || 'all');
    res.json(payload);
  } catch (error) {
    console.error('Student achievements query failed:', error);
    res.status(500).json({ error: 'Unable to load student achievements.' });
  }
});

app.get('/api/analytics/batch-comparison', requireAuth, async (req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const batchA = typeof req.query.batchA === 'string' ? req.query.batchA : undefined;
    const batchB = typeof req.query.batchB === 'string' ? req.query.batchB : undefined;
    const payload = await getBatchComparisonAnalytics(serverTime.isoDate, batchA, batchB);
    res.json(payload);
  } catch (error) {
    console.error('Batch comparison analytics failed:', error);
    res.status(500).json({ error: 'Unable to load batch comparison metrics.' });
  }
});

app.get('/api/analytics/batch-comparison/export-pdf', requireAuth, async (req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const batchA = typeof req.query.batchA === 'string' ? req.query.batchA : undefined;
    const batchB = typeof req.query.batchB === 'string' ? req.query.batchB : undefined;
    const payload = await getBatchComparisonAnalytics(serverTime.isoDate, batchA, batchB);
    const generatedAt = `${serverTime.formattedDate} ${serverTime.formattedTime} (${serverTime.academicTimezone})`;
    const pdfBuffer = buildBatchComparisonPdfBuffer(payload, generatedAt);
    const slugA = payload.batchA.batchLabel.replace(/[^a-z0-9]+/gi, '_');
    const slugB = payload.batchB.batchLabel.replace(/[^a-z0-9]+/gi, '_');
    const filename = `ChromaGrade_Batch_Comparison_${slugA}_vs_${slugB}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Batch comparison PDF export failed:', error);
    res.status(500).json({ error: 'Unable to export batch comparison PDF.' });
  }
});

app.get('/api/analytics/leaderboard-buddies', requireAuth, async (_req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const payload = await getTopPerformersAndStudyBuddies(serverTime.isoDate);
    res.json(payload);
  } catch (error) {
    console.error('Leaderboard & study buddies query failed:', error);
    res.status(500).json({ error: 'Unable to load top performers and study buddies.' });
  }
});

app.get('/api/goals/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const goal = await getAcademicGoalForUser(req.user!, serverTime.isoDate);
    res.json({ goal });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load Academic Goal Tracker.' });
  }
});

app.put('/api/goals/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const weeklyAttendanceTarget = Number(req.body?.weeklyAttendanceTarget ?? 85);
    const weeklyEngagementTarget = Number(req.body?.weeklyEngagementTarget ?? 80);
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const goal = await upsertAcademicGoalForUser({
      user: req.user!,
      todayIso: serverTime.isoDate,
      weeklyAttendanceTarget,
      weeklyEngagementTarget,
      note,
    });
    res.json({ goal });
  } catch (error) {
    res.status(500).json({ error: 'Unable to save Academic Goal targets.' });
  }
});

app.post('/api/goals/me/checkin', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const goal = await checkInAcademicGoalToday(req.user!, serverTime.isoDate, note);
    res.json({ goal });
  } catch (error) {
    res.status(500).json({ error: 'Unable to log daily goal check-in.' });
  }
});

app.post('/api/goals/nudge-check', requireAuth, async (_req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const userIds = await listStudentUserIdsNeedingGoalNudge(serverTime.isoDate);
    if (userIds.length > 0) {
      wsHub.emitGoalTrackerNudge(userIds, serverTime.isoDate);
    }
    res.json({ nudgedCount: userIds.length, isoDate: serverTime.isoDate });
  } catch (error) {
    res.status(500).json({ error: 'Unable to run daily goal nudge check.' });
  }
});

app.get('/api/academic-calendar', requireAuth, async (_req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const events = await listAcademicCalendarEvents(serverTime.isoDate);
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load academic calendar events.' });
  }
});

app.post(
  '/api/academic-calendar',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'dept_staff', 'student', 'class_rep'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const title = String(req.body?.title ?? '').trim();
      const eventDate = String(req.body?.eventDate ?? '').trim();
      const category = (['event', 'exam', 'deadline', 'holiday'].includes(
        String(req.body?.category)
      )
        ? String(req.body?.category)
        : 'event') as AcademicEventCategory;
      const yearOfStudy = String(req.body?.yearOfStudy ?? 'All Years').trim();
      const description = String(req.body?.description ?? '').trim();

      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        res.status(400).json({ error: 'Event title and valid date (YYYY-MM-DD) are required.' });
        return;
      }

      const dept = await getSetting('department_name', req.user!.department);
      const event = await createAcademicCalendarEvent({
        title,
        eventDate,
        category,
        department: dept,
        yearOfStudy,
        description,
        createdByName: req.user!.fullName,
      });
      res.status(201).json({ event });
    } catch (error) {
      res.status(500).json({ error: 'Unable to create academic calendar event.' });
    }
  }
);

app.delete(
  '/api/academic-calendar/:id',
  requireAuth,
  requireRoles('hod', 'class_advisor'),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid calendar event ID.' });
        return;
      }
      const ok = await deleteAcademicCalendarEvent(id);
      if (!ok) {
        res.status(404).json({ error: 'Calendar event not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: 'Unable to delete calendar event.' });
    }
  }
);

app.get('/api/attendance/alerts-and-risk', requireAuth, async (_req, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const lowRiskStudents = await getLowAttendanceRiskStudents(serverTime.isoDate);
    res.json({ lowRiskStudents, serverDate: serverTime.isoDate });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load attendance risk alerts.' });
  }
});

app.post(
  '/api/attendance/notify-low-risk',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'dept_staff'),
  async (_req, res) => {
    try {
      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting('department_name', 'Computer Science & Engineering');
      const serverTime = computeServerTimeStatus(tz, dept);
      const lowRiskStudents = await getLowAttendanceRiskStudents(serverTime.isoDate);
      const dispatched: unknown[] = [];

      for (const student of lowRiskStudents) {
        const logged = await recordAttendanceRiskAlertIfNeeded({
          rollNo: student.rollNo,
          todayIso: serverTime.isoDate,
        });
        if (logged) {
          dispatched.push(logged);
          wsHub.emitLowAttendanceRisk({
            rollNo: logged.rollNo,
            studentName: logged.studentName,
            yearOfStudy: logged.yearOfStudy,
            section: logged.section,
            cumulativeRate: logged.cumulativeRate,
            presentCount: logged.presentCount,
            totalSessions: logged.totalSessions,
            notifiedAt: logged.notifiedAt,
          });
        }
      }
      res.json({ notifiedCount: dispatched.length, lowRiskStudents });
    } catch (error) {
      res.status(500).json({ error: 'Unable to dispatch low-attendance risk notifications.' });
    }
  }
);

app.get('/api/hod/archival', requireAuth, requireRoles('hod', 'class_advisor'), async (_req, res) => {
  try {
    const logs = await listArchivalLogs();
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load archival history.' });
  }
});

app.post('/api/hod/archival', requireAuth, requireRoles('hod'), async (_req, res) => {
  try {
    const record = await runDailyDepartmentArchival('manual');
    res.status(201).json({ record });
  } catch (error) {
    res.status(500).json({ error: 'Unable to run manual department archival.' });
  }
});

// ============================================================
// Faculty Delay Alert Endpoints (Class Rep / Advisor / HOD -> Faculty + HOD + Advisor)
// ============================================================
app.get('/api/faculty-delays', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const newlyCreated = await runAutoFacultyDelayScan();
    for (const alert of newlyCreated) {
      wsHub.emitFacultyDelayCreated(alert);
    }
    const alerts = await listFacultyDelayAlertsForUser(req.user!);
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to fetch faculty delay alerts.' });
  }
});

app.post(
  '/api/faculty-delays',
  requireAuth,
  requireRoles('student', 'class_rep', 'class_advisor', 'hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting('department_name', req.user?.department || 'Computer Science & Engineering');
      const serverTime = computeServerTimeStatus(tz, dept);

      const timetableSlotId =
        typeof req.body?.timetableSlotId === 'number' ? req.body.timetableSlotId : null;
      let slot = null;
      if (timetableSlotId) {
        const found = await db
          .select()
          .from(timetableSlots)
          .where(eq(timetableSlots.id, timetableSlotId))
          .limit(1);
        slot = found[0] ?? null;
      }

      const facultyName = String(req.body?.facultyName ?? slot?.facultyName ?? '').trim();
      const subjectCode = String(req.body?.subjectCode ?? slot?.subjectCode ?? 'CLASS').trim();
      const subjectName = String(req.body?.subjectName ?? slot?.subjectName ?? 'Scheduled Class').trim();
      const yearOfStudy = String(req.body?.yearOfStudy ?? slot?.yearOfStudy ?? req.user!.yearOfStudy ?? '').trim();
      const section = String(req.body?.section ?? slot?.section ?? req.user!.section ?? '').trim();
      const roomNo = String(req.body?.roomNo ?? slot?.roomNo ?? '').trim();
      const dayOfWeek = String(req.body?.dayOfWeek ?? slot?.dayOfWeek ?? serverTime.weekday).trim();
      const periodNumber = Number(
        req.body?.periodNumber ?? slot?.periodNumber ?? serverTime.activePeriod?.periodNumber ?? 1
      );
      const delayMinutes = Number(req.body?.delayMinutes ?? 10);
      const note = String(req.body?.note ?? '').trim();

      if (!facultyName) {
        res.status(400).json({ error: 'Select a scheduled period or enter the respected hour faculty name.' });
        return;
      }

      const alert = await createFacultyDelayAlert({
        department: dept,
        yearOfStudy,
        section,
        dayOfWeek,
        periodNumber: Number.isFinite(periodNumber) ? periodNumber : 1,
        timetableSlotId: slot?.id ?? null,
        subjectCode,
        subjectName,
        roomNo,
        facultyName,
        user: req.user!,
        delayMinutes: Number.isFinite(delayMinutes) ? delayMinutes : 10,
        note,
      });

      wsHub.emitFacultyDelayCreated(alert);
      res.status(201).json({ alert });
    } catch (error) {
      console.error('Failed to report faculty delay:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to send faculty delay alert.' });
    }
  }
);

app.patch(
  '/api/faculty-delays/:id',
  requireAuth,
  requireRoles('hod', 'class_advisor', 'dept_staff', 'other_dept_staff'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid faculty delay alert ID.' });
        return;
      }
      const status = req.body?.status === 'resolved' ? 'resolved' : 'acknowledged';
      const updated = await updateFacultyDelayAlertStatus({
        id,
        status,
        acknowledgedByName: req.user!.fullName,
      });
      if (!updated) {
        res.status(404).json({ error: 'Faculty delay alert not found.' });
        return;
      }
      wsHub.emitFacultyDelayUpdated(updated);
      res.json({ alert: updated });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to update faculty delay alert.' });
    }
  }
);

app.post(
  '/api/attendance/verify-and-mark',
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const personType = req.body?.personType as AttendancePersonType;
      const personIdentifier = String(req.body?.personIdentifier ?? '').trim().toUpperCase();
      const personName = String(req.body?.personName ?? '').trim();
      const timetableSlotId =
        typeof req.body?.timetableSlotId === 'number' ? req.body.timetableSlotId : null;
      const faceImageData = String(req.body?.faceImageData ?? '');
      const environmentImageData = String(req.body?.environmentImageData ?? '');
      const rawLat = req.body?.latitude;
      const rawLng = req.body?.longitude;
      const hasCoords =
        rawLat !== undefined &&
        rawLat !== null &&
        rawLat !== '' &&
        rawLng !== undefined &&
        rawLng !== null &&
        rawLng !== '' &&
        Number.isFinite(Number(rawLat)) &&
        Number.isFinite(Number(rawLng));
      const latitude = hasCoords ? Number(rawLat) : null;
      const longitude = hasCoords ? Number(rawLng) : null;

      if (personType !== 'student' && personType !== 'faculty') {
        res.status(400).json({ error: 'Select student or faculty attendance mode.' });
        return;
      }
      if (!personIdentifier || !personName) {
        res.status(400).json({ error: 'Select a valid student or department faculty record.' });
        return;
      }
      if (!faceImageData || !environmentImageData) {
        res.status(400).json({
          error:
            'Two live camera photos are strictly required: (1) live face capture and (2) live work/classroom environment capture.',
        });
        return;
      }

      // Enforce HOD-pinned classroom geofence if configured
      const pinnedLocation = await getPinnedLocationConfig();
      let geofenceSummary = '';
      if (
        pinnedLocation.configured &&
        pinnedLocation.latitude !== null &&
        pinnedLocation.longitude !== null
      ) {
        if (latitude === null || longitude === null) {
          res.status(400).json({
            error: `Enable GPS location verification for "${pinnedLocation.label}" (within ${pinnedLocation.radiusMeters}m of the HOD-pinned classroom location) before marking attendance.`,
          });
          return;
        }
        const distance = calculateDistanceMeters(
          latitude,
          longitude,
          pinnedLocation.latitude,
          pinnedLocation.longitude
        );
        if (distance > pinnedLocation.radiusMeters) {
          res.status(400).json({
            error: `Outside HOD-pinned classroom geofence "${pinnedLocation.label}" (${distance}m away; allowed radius: ${pinnedLocation.radiusMeters}m). Attendance blocked.`,
          });
          return;
        }
        geofenceSummary = `Verified inside HOD-pinned zone "${pinnedLocation.label}" (${distance}m away, max ${pinnedLocation.radiusMeters}m).`;
      }

      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting('department_name', 'Computer Science & Engineering');
      const serverTime = computeServerTimeStatus(tz, dept);

      let slot = null;
      if (timetableSlotId) {
        const found = await db
          .select()
          .from(timetableSlots)
          .where(eq(timetableSlots.id, timetableSlotId))
          .limit(1);
        slot = found[0] ?? null;
      }

      const periodNumber =
        slot?.periodNumber ??
        Number(req.body?.periodNumber || serverTime.activePeriod?.periodNumber || 1);
      const subjectCode = slot?.subjectCode ?? String(req.body?.subjectCode || 'DEPT-ATT');
      const subjectName = slot?.subjectName ?? String(req.body?.subjectName || 'Daily Session');
      const yearOfStudy = slot?.yearOfStudy ?? String(req.body?.yearOfStudy || '');
      const section = slot?.section ?? String(req.body?.section || '');
      const roomNo = slot?.roomNo ?? String(req.body?.roomNo || 'Campus');
      const dayOfWeek = slot?.dayOfWeek ?? serverTime.weekday;

      // Load student's registered baseline Face & Classroom Environment photos (if enrolled during registration)
      const biometricProfile =
        personType === 'student' ? await getStudentBiometricProfile(personIdentifier) : null;

      // Run real server-side Gemini Vision inspection on BOTH live camera photos (+ registered baselines)
      const verification = await verifyDualCameraAttendance({
        faceImageData,
        environmentImageData,
        registeredFaceImageData: biometricProfile?.faceImageData ?? null,
        registeredEnvironmentImageData: biometricProfile?.environmentImageData ?? null,
        geofenceSummary,
        personType,
        personName,
        subjectName,
        roomNo,
      });

      const attendanceStatus: 'present' | 'late' | 'rejected' = verification.approvedForAttendance
        ? 'present'
        : 'rejected';

      const summarySuffix = geofenceSummary
        ? ` ${geofenceSummary}`
        : biometricProfile
        ? ' Cross-checked with registered face & classroom baseline.'
        : '';

      const savedRecord = await upsertAttendanceRecord({
        attendanceDate: serverTime.isoDate,
        dayOfWeek,
        periodNumber,
        timetableSlotId: slot?.id ?? null,
        subjectCode,
        subjectName,
        department: dept,
        yearOfStudy,
        section,
        roomNo,
        personType,
        personIdentifier,
        personName,
        markedByUserId: req.user!.id,
        markedByName: req.user!.fullName,
        status: attendanceStatus,
        faceImageData,
        environmentImageData,
        faceDetected: verification.faceDetected,
        faceConfidence: verification.faceConfidence,
        environmentVerified: verification.environmentVerified,
        environmentLabel: verification.environmentLabel,
        verificationSummary: `${verification.summary}${summarySuffix}`.slice(0, 260),
        serverTimestamp: `${serverTime.formattedDate} · ${serverTime.formattedTime} (${serverTime.academicTimezone})`,
      });

      if (verification.approvedForAttendance) {
        await registerAndLockUserFace({
          personIdentifier,
          faceImageData,
        }).catch(() => null);
      }

      let sessionAlert: {
        subjectCode: string;
        subjectName: string;
        yearOfStudy: string;
        section: string;
        periodNumber: number;
        presentCount: number;
        expectedCount: number;
        ratePct: number;
      } | null = null;
      let lowAttendanceRisk: {
        rollNo: string;
        studentName: string;
        cumulativeRate: number;
      } | null = null;

      if (personType === 'student') {
        const sessionStats = await evaluateSessionAttendanceStatus({
          attendanceDate: serverTime.isoDate,
          periodNumber,
          yearOfStudy,
          section,
        });
        if (sessionStats.ratePct < 75) {
          sessionAlert = {
            subjectCode,
            subjectName,
            yearOfStudy,
            section,
            periodNumber,
            ...sessionStats,
          };
          wsHub.emitSessionAttendanceAlert({
            ...sessionAlert,
            createdAt: `${serverTime.formattedDate} · ${serverTime.formattedTime}`,
          });
        }

        const riskLogged = await recordAttendanceRiskAlertIfNeeded({
          rollNo: personIdentifier,
          todayIso: serverTime.isoDate,
        });
        if (riskLogged && riskLogged.cumulativeRate < 75) {
          lowAttendanceRisk = {
            rollNo: riskLogged.rollNo,
            studentName: riskLogged.studentName,
            cumulativeRate: riskLogged.cumulativeRate,
          };
          wsHub.emitLowAttendanceRisk({
            rollNo: riskLogged.rollNo,
            studentName: riskLogged.studentName,
            yearOfStudy: riskLogged.yearOfStudy,
            section: riskLogged.section,
            cumulativeRate: riskLogged.cumulativeRate,
            presentCount: riskLogged.presentCount,
            totalSessions: riskLogged.totalSessions,
            notifiedAt: riskLogged.notifiedAt,
          });
        }
      }

      res.status(verification.approvedForAttendance ? 201 : 200).json({
        approved: verification.approvedForAttendance,
        verification,
        record: savedRecord,
        sessionAlert,
        lowAttendanceRisk,
      });
    } catch (error) {
      console.error('Dual-camera attendance verification failed:', error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Camera attendance verification failed. Please retry.',
      });
    }
  }
);

// ============================================================
// 7B. OD & Leave Permission Workflow + HOD Form Customization
// ============================================================
app.get('/api/od-leave/form-config', requireAuth, async (_req, res) => {
  try {
    const config = await getOdLeaveFormConfig();
    res.json({ config });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load OD/Leave form settings.',
    });
  }
});

app.put(
  '/api/od-leave/form-config',
  requireAuth,
  requireRoles('hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const body = req.body ?? {};
      const config = await saveOdLeaveFormConfig(
        {
          requireClassAdvisorForStudents: Boolean(body.requireClassAdvisorForStudents),
          allowDocumentUpload: Boolean(body.allowDocumentUpload),
          requireDocumentUploadForOd: Boolean(body.requireDocumentUploadForOd),
          requireDocumentUploadForLeave: Boolean(body.requireDocumentUploadForLeave),
          allowPhotoUpload: Boolean(body.allowPhotoUpload),
          requirePhotoUpload: Boolean(body.requirePhotoUpload),
          maxOdDays: Number(body.maxOdDays || 10),
          maxLeaveDays: Number(body.maxLeaveDays || 15),
          declarationText: String(body.declarationText ?? ''),
          fields: Array.isArray(body.fields) ? body.fields : [],
        },
        req.user!.fullName
      );
      res.json({ config });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unable to save OD/Leave form settings.',
      });
    }
  }
);

app.post(
  '/api/od-leave/attachments',
  requireAuth,
  upload.single('file'),
  async (req: AuthenticatedRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Attach a valid document or photo file.' });
        return;
      }

      const kind = String(req.body?.kind ?? 'document') === 'photo' ? 'photo' : 'document';
      const rawName = path.basename(req.file.originalname || `${kind}.bin`);
      const ext = path.extname(rawName).toLowerCase() || '.bin';

      if (kind === 'photo' && !ALLOWED_OD_PHOTO_EXTENSIONS.has(ext)) {
        res.status(400).json({
          error: 'Proof photo must be a PNG, JPG, JPEG, or WEBP image.',
        });
        return;
      }
      if (kind === 'document' && !ALLOWED_OD_DOC_EXTENSIONS.has(ext)) {
        res.status(400).json({
          error: 'Supporting file must be a PDF, DOC, DOCX, TXT, PNG, JPG, or WEBP file.',
        });
        return;
      }

      const fileKey = `${crypto.randomUUID()}${ext}`;
      const targetPath = path.resolve(OD_LEAVE_UPLOADS_DIR, fileKey);
      if (!targetPath.startsWith(OD_LEAVE_UPLOADS_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid upload destination.' });
        return;
      }

      fs.writeFileSync(targetPath, req.file.buffer);
      res.status(201).json({
        fileKey,
        fileName: rawName.slice(0, 160),
        mimeType: req.file.mimetype || 'application/octet-stream',
        fileSize: req.file.size,
      });
    } catch (error) {
      console.error('OD/Leave attachment upload failed:', error);
      res.status(500).json({ error: 'Unable to upload supporting file or photo.' });
    }
  }
);

app.get('/api/od-leave/attachments/:fileKey', requireAuth, (req, res) => {
  try {
    const fileKey = path.basename(String(req.params.fileKey ?? ''));
    if (!/^[a-f0-9-]+\.[a-z0-9]+$/i.test(fileKey)) {
      res.status(400).json({ error: 'Invalid attachment key.' });
      return;
    }

    const fullPath = path.resolve(OD_LEAVE_UPLOADS_DIR, fileKey);
    if (!fullPath.startsWith(OD_LEAVE_UPLOADS_DIR + path.sep) || !fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Attachment not found.' });
      return;
    }

    const ext = path.extname(fileKey).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain; charset=utf-8',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const isInlineSafe = INLINE_SAFE_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix));
    const requestedName = String(req.query.name ?? fileKey).replace(/["\r\n]/g, '').slice(0, 140);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${isInlineSafe && req.query.download !== '1' ? 'inline' : 'attachment'}; filename="${requestedName}"`
    );
    res.sendFile(fullPath);
  } catch (error) {
    console.error('OD/Leave attachment fetch failed:', error);
    res.status(500).json({ error: 'Unable to retrieve attachment.' });
  }
});

app.get('/api/od-leave/requests', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
    const dept = await getSetting('department_name', req.user?.department || 'Computer Science & Engineering');
    const serverTime = computeServerTimeStatus(tz, dept);
    const [requests, config, activeToday] = await Promise.all([
      listOdLeaveRequestsForUser(req.user!),
      getOdLeaveFormConfig(),
      listActiveApprovedOdLeaveForDate(serverTime.isoDate),
    ]);
    res.json({ requests, config, activeToday, serverDate: serverTime.isoDate });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to load OD & Leave requests.',
    });
  }
});

app.post('/api/od-leave/requests', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = req.user!;
    const config = await getOdLeaveFormConfig();

    const requestType = req.body?.requestType === 'od' ? 'od' : req.body?.requestType === 'leave' ? 'leave' : null;
    if (!requestType) {
      res.status(400).json({ error: 'Select either OD (On-Duty) or Leave.' });
      return;
    }

    const applicantCategory: 'student' | 'faculty' =
      user.role === 'student' || user.role === 'class_rep' ? 'student' : 'faculty';

    const applicantName = String(req.body?.applicantName ?? user.fullName ?? '').trim();
    const rollOrEmployeeId = String(req.body?.rollOrEmployeeId ?? user.staffOrRollId ?? '')
      .trim()
      .toUpperCase();
    const mobileNumber = String(req.body?.mobileNumber ?? user.phone ?? '').trim();
    const yearOfStudy = String(req.body?.yearOfStudy ?? user.yearOfStudy ?? '').trim();
    const section = String(req.body?.section ?? user.section ?? '').trim().toUpperCase();
    const fromDate = String(req.body?.fromDate ?? '').trim();
    const toDate = String(req.body?.toDate ?? '').trim();
    const reason = String(req.body?.reason ?? '').trim();

    if (!applicantName || applicantName.length < 2) {
      res.status(400).json({ error: 'Applicant full name is required.' });
      return;
    }
    if (!rollOrEmployeeId) {
      res.status(400).json({
        error: applicantCategory === 'student' ? 'Roll Number is required.' : 'Employee ID is required.',
      });
      return;
    }
    if (!mobileNumber || mobileNumber.length < 7) {
      res.status(400).json({ error: 'Valid mobile number is required.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      res.status(400).json({ error: 'Select valid From and To dates (YYYY-MM-DD).' });
      return;
    }

    const dates = enumerateDateRangeInclusive(fromDate, toDate);
    if (dates.length === 0) {
      res.status(400).json({ error: 'End date must be on or after the start date.' });
      return;
    }
    const maxAllowed = requestType === 'od' ? config.maxOdDays : config.maxLeaveDays;
    if (dates.length > maxAllowed) {
      res.status(400).json({
        error: `Maximum allowed ${requestType.toUpperCase()} duration is ${maxAllowed} day(s) per request (HOD policy).`,
      });
      return;
    }

    if (reason.length < 5) {
      res.status(400).json({ error: 'Please provide a clear reason (at least 5 characters).' });
      return;
    }

    const rawCustom = req.body?.customFields && typeof req.body.customFields === 'object'
      ? (req.body.customFields as Record<string, unknown>)
      : {};
    const customFields: Record<string, string> = {};

    for (const field of config.fields) {
      if (!field.enabled) continue;
      if (field.appliesTo !== 'all' && field.appliesTo !== applicantCategory) continue;
      const val = String(rawCustom[field.id] ?? '').trim().slice(0, 400);
      if (field.required && !val) {
        res.status(400).json({ error: `Required field missing: ${field.label}.` });
        return;
      }
      if (val) {
        customFields[field.id] = val;
      }
    }

    const documentFileKey = path.basename(String(req.body?.documentFileKey ?? '').trim());
    const documentFileName = String(req.body?.documentFileName ?? '').trim().slice(0, 160);
    const documentMimeType = String(req.body?.documentMimeType ?? '').trim().slice(0, 120);
    const photoFileKey = path.basename(String(req.body?.photoFileKey ?? '').trim());
    const photoFileName = String(req.body?.photoFileName ?? '').trim().slice(0, 160);
    const photoMimeType = String(req.body?.photoMimeType ?? '').trim().slice(0, 120);

    if (
      config.allowDocumentUpload &&
      ((requestType === 'od' && config.requireDocumentUploadForOd) ||
        (requestType === 'leave' && config.requireDocumentUploadForLeave)) &&
      !documentFileKey
    ) {
      res.status(400).json({
        error: `Supporting document upload is mandatory for ${requestType.toUpperCase()} requests (HOD policy).`,
      });
      return;
    }

    if (config.allowPhotoUpload && config.requirePhotoUpload && !photoFileKey) {
      res.status(400).json({
        error: 'Proof photo upload is mandatory as configured by HOD.',
      });
      return;
    }

    const dept = await getSetting('department_name', user.department || 'Computer Science & Engineering');
    const created = await createOdLeaveRequest({
      requestType,
      applicantCategory,
      user,
      applicantName,
      rollOrEmployeeId,
      mobileNumber,
      department: dept,
      yearOfStudy,
      section,
      fromDate,
      toDate,
      totalDays: dates.length,
      reason,
      customFields,
      documentFileKey: /^[a-f0-9-]+\.[a-z0-9]+$/i.test(documentFileKey) ? documentFileKey : '',
      documentFileName,
      documentMimeType,
      photoFileKey: /^[a-f0-9-]+\.[a-z0-9]+$/i.test(photoFileKey) ? photoFileKey : '',
      photoFileName,
      photoMimeType,
      requireClassAdvisor: config.requireClassAdvisorForStudents,
    });

    wsHub.emitOdLeaveCreated(created);
    res.status(201).json({ request: created });
  } catch (error) {
    console.error('Failed to submit OD/Leave request:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to submit OD/Leave application.',
    });
  }
});

app.patch(
  '/api/od-leave/requests/:id/decision',
  requireAuth,
  requireRoles('class_advisor', 'hod'),
  async (req: AuthenticatedRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid OD/Leave request ID.' });
        return;
      }

      const decision =
        req.body?.decision === 'approve'
          ? 'approve'
          : req.body?.decision === 'reject'
          ? 'reject'
          : null;
      if (!decision) {
        res.status(400).json({ error: 'Decision must be approve or reject.' });
        return;
      }
      const remarks = String(req.body?.remarks ?? '').trim();

      const existing = await getOdLeaveRequestById(id);
      if (!existing) {
        res.status(404).json({ error: 'OD/Leave request not found.' });
        return;
      }

      const reviewer = req.user!;
      if (existing.applicantUserId === reviewer.id && reviewer.role !== 'hod') {
        res.status(403).json({ error: 'You cannot approve or reject your own OD/Leave request.' });
        return;
      }

      if (existing.status === 'approved' || existing.status === 'rejected') {
        res.status(400).json({ error: `This request has already been ${existing.status}.` });
        return;
      }

      if (reviewer.role === 'class_advisor') {
        if (existing.applicantCategory !== 'student') {
          res.status(403).json({
            error: 'Faculty OD/Leave permissions are approved exclusively by the HOD.',
          });
          return;
        }
        if (existing.status !== 'pending_advisor') {
          res.status(400).json({
            error: 'This student request has already passed Class Advisor review and is awaiting HOD approval.',
          });
          return;
        }
      }

      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting('department_name', reviewer.department);
      const serverTime = computeServerTimeStatus(tz, dept);

      const updated = await decideOdLeaveRequest({
        request: existing,
        reviewer,
        decision,
        remarks,
        serverTimestamp: `${serverTime.formattedDate} · ${serverTime.formattedTime} (${serverTime.academicTimezone})`,
      });

      wsHub.emitOdLeaveUpdated(updated);
      res.json({ request: updated });
    } catch (error) {
      console.error('OD/Leave decision error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to process OD/Leave decision.',
      });
    }
  }
);

// ============================================================
// 8. HTTP + WebSocket Server Boot with Vite Middleware
// ============================================================
async function startServer() {
  const PORT = 3000;
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: {
          server: httpServer,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/ws/chat') {
      wsHub.handleUpgrade(request, socket, head);
    } else if (isProd || pathname !== '/__vite_hmr') {
      socket.destroy();
    }
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ChromaGrade PostgreSQL & WebSocket server running on http://0.0.0.0:${PORT}`);
    startDailyArchivalScheduler();
    setTimeout(() => {
      runAutoFacultyDelayScan()
        .then((created) => created.forEach((a) => wsHub.emitFacultyDelayCreated(a)))
        .catch(() => null);
    }, 5000);
    setInterval(() => {
      runAutoFacultyDelayScan()
        .then((created) => created.forEach((a) => wsHub.emitFacultyDelayCreated(a)))
        .catch(() => null);
    }, 60_000);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ChromaGrade server:', err);
  process.exit(1);
});
