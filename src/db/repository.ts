import crypto from 'crypto';
import { and, asc, desc, eq, gt, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import { computeServerTimeStatus } from '../../server/serverTime.ts';
import type {
  AcademicCalendarEventItem,
  AcademicEventCategory,
  AcademicGoalPayload,
  AcademicGoalWeekLog,
  ActivePowerBoostAlert,
  ArchivalRecordSummary,
  AttendancePersonType,
  AttendanceRecordItem,
  AttendanceRiskAlertItem,
  BatchComparisonPayload,
  BatchPerformancePoint,
  BatchRiskStatus,
  BatchTrendWeekPoint,
  ChatAttachmentPayload,
  ChatAttachmentType,
  ChatMessageItem,
  CommunityCategory,
  CommunityGroupItem,
  CommunityItem,
  DeduplicateReport,
  DepartmentalPerformancePayload,
  DepartmentStaff,
  DepartmentStudent,
  EmailIntimation,
  FacultyAlterationItem,
  FacultyDelayAlertItem,
  HodDelegationInfo,
  HodDirectoryRecord,
  LeaderboardAndBuddiesPayload,
  OdLeaveApplicantCategory,
  OdLeaveFormConfig,
  OdLeaveFormFieldConfig,
  OdLeaveRequestItem,
  OdLeaveRequestType,
  OdLeaveWorkflowStatus,
  OtherDepartmentStaff,
  PinnedLocationConfig,
  PowerBoostAcknowledgementItem,
  PowerBoostEngagementSummary,
  PowerBoostMessageStatItem,
  StudentAchievementBadge,
  StudentAchievementItem,
  StudentAchievementsPayload,
  StudentBiometricProfileSummary,
  StudyBuddySuggestion,
  TimetableSlot,
  TopPerformerHistoryPoint,
  TopPerformerItem,
  UploadBatch,
  UploadModule,
  UserProfile,
  UserRole,
} from '../types.ts';
import { db } from './index.ts';
import {
  academicCalendarEvents,
  academicGoalLogs,
  academicGoals,
  appSettings,
  archivalLogs,
  attendanceRecords,
  attendanceRiskAlerts,
  chatMessages,
  communities,
  communityGroups,
  communityMembers,
  departmentStaff,
  departmentStudents,
  emailIntimations,
  facultyAlterations,
  facultyDelayAlerts,
  hodDelegations,
  messageAcknowledgements,
  odLeaveRequests,
  otherDepartmentStaff,
  sessions,
  studentBiometricProfiles,
  timetableSlots,
  uploadBatches,
  userProfileMeta,
  users,
} from './schema.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function formatTs(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toISOString().replace('T', ' ').slice(0, 19);
}

export function mapUser(row: typeof users.$inferSelect): UserProfile {
  return {
    id: row.id,
    uid: row.uid ?? null,
    fullName: row.fullName,
    email: row.email,
    role: row.role as UserRole,
    department: row.department,
    staffOrRollId: row.staffOrRollId,
    yearOfStudy: row.yearOfStudy,
    section: row.section,
    phone: row.phone,
    status: row.status as UserProfile['status'],
    approvedBy: row.approvedBy ?? null,
    approvedAt: row.approvedAt ?? null,
    createdAt: formatTs(row.createdAt),
    transitBufferMinutes: row.transitBufferMinutes ?? 15,
    profileImageData: '',
    faceRegisteredLocked: false,
    faceRegisteredAt: null,
    designation: '',
    specialization: '',
    bio: '',
    delegationInfo: null,
  };
}

function mapDelegationRow(row: typeof hodDelegations.$inferSelect): HodDelegationInfo {
  return {
    id: row.id,
    originalHodUserId: row.originalHodUserId,
    originalHodName: row.originalHodName,
    originalHodEmail: row.originalHodEmail,
    delegateUserId: row.delegateUserId,
    delegateName: row.delegateName,
    delegateEmail: row.delegateEmail,
    delegatePreviousRole: row.delegatePreviousRole as UserRole,
    reason: row.reason,
    status: (row.status as 'active' | 'restored') || 'active',
    delegatedAt: formatTs(row.delegatedAt),
    restoredAt: row.restoredAt ? formatTs(row.restoredAt) : null,
  };
}

export async function enrichUsersWithMeta(
  rows: (typeof users.$inferSelect)[]
): Promise<UserProfile[]> {
  if (rows.length === 0) return [];
  const userIds = rows.map((r) => r.id);
  const [metaRows, bioRows, activeDelegations] = await Promise.all([
    db.select().from(userProfileMeta).where(inArray(userProfileMeta.userId, userIds)),
    db.select({
      rollNo: studentBiometricProfiles.rollNo,
      email: studentBiometricProfiles.email,
      faceImageData: studentBiometricProfiles.faceImageData,
      updatedAt: studentBiometricProfiles.updatedAt,
    }).from(studentBiometricProfiles),
    db
      .select()
      .from(hodDelegations)
      .where(eq(hodDelegations.status, 'active'))
      .orderBy(desc(hodDelegations.id))
      .limit(5),
  ]);

  const metaByUserId = new Map(metaRows.map((m) => [m.userId, m]));
  const bioByRoll = new Map(bioRows.map((b) => [b.rollNo.trim().toUpperCase(), b]));
  const bioByEmail = new Map(bioRows.map((b) => [b.email.trim().toLowerCase(), b]));
  const latestActiveDelegation = activeDelegations[0] ? mapDelegationRow(activeDelegations[0]) : null;

  return rows.map((row) => {
    const base = mapUser(row);
    const meta = metaByUserId.get(row.id);
    const bio =
      (row.staffOrRollId ? bioByRoll.get(row.staffOrRollId.trim().toUpperCase()) : undefined) ??
      (row.email ? bioByEmail.get(row.email.trim().toLowerCase()) : undefined);

    const profileImageData = meta?.profileImageData || bio?.faceImageData || '';
    const faceRegisteredLocked =
      meta !== undefined ? Boolean(meta.faceRegisteredLocked) : Boolean(bio?.faceImageData);
    const faceRegisteredAt =
      meta?.faceRegisteredAt || (bio?.faceImageData ? formatTs(bio.updatedAt) : null) || null;

    const delegationInfo =
      latestActiveDelegation &&
      (latestActiveDelegation.delegateUserId === row.id ||
        latestActiveDelegation.originalHodUserId === row.id)
        ? latestActiveDelegation
        : null;

    return {
      ...base,
      profileImageData,
      faceRegisteredLocked,
      faceRegisteredAt,
      designation: meta?.designation || '',
      specialization: meta?.specialization || '',
      bio: meta?.bio || '',
      delegationInfo,
    };
  });
}

export async function enrichUserWithMeta(
  row: typeof users.$inferSelect
): Promise<UserProfile> {
  const enriched = await enrichUsersWithMeta([row]);
  return enriched[0] ?? mapUser(row);
}

// ============================================================
// Settings & Lazy One-Time Baseline Seed (No Startup Probes)
// ============================================================
let baselineEnsured = false;

export async function getSetting(key: string, fallback = ''): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    return rows[0]?.value ?? fallback;
  } catch (error) {
    console.error('Database setting read failed:', error);
    throw new Error('Unable to load application settings.', { cause: error });
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    await db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value },
      });
  } catch (error) {
    console.error('Database setting write failed:', error);
    throw new Error('Unable to update application settings.', { cause: error });
  }
}

export async function ensureBaselineData(): Promise<void> {
  if (baselineEnsured) return;
  try {
    await db
      .insert(appSettings)
      .values([
        { key: 'academic_timezone', value: 'Asia/Kolkata' },
        { key: 'department_name', value: 'Computer Science & Engineering' },
      ])
      .onConflictDoNothing();

    // Ensure every non-announcement-only community (and default community) has an open discussion group
    // so students and Class Reps can send messages and upload documents right away.
    const existingComms = await db.select().from(communities);
    const existingGroups = await db.select().from(communityGroups);

    if (existingComms.length === 0) {
      const dept = await getSetting('department_name', 'Computer Science & Engineering');
      const [comm] = await db
        .insert(communities)
        .values({
          name: `${dept} Hub`,
          description: 'Official department announcements & student-faculty open discussion space.',
          department: dept,
          category: 'department',
          announcementOnly: false,
          createdByUserId: null,
          createdByName: 'Department Office',
        })
        .returning();
      await db.insert(communityGroups).values([
        {
          communityId: comm.id,
          name: 'Announcements',
          description: 'Official broadcasts from HOD, Class Advisors & Admins.',
          groupType: 'announcements',
          onlyAdminsCanPost: true,
        },
        {
          communityId: comm.id,
          name: 'General Discussion',
          description: 'Open discussion, documents & collaboration for all students and faculty.',
          groupType: 'group',
          onlyAdminsCanPost: false,
        },
      ]);
    } else {
      for (const comm of existingComms) {
        if (comm.announcementOnly) continue;
        const commGroups = existingGroups.filter((g) => g.communityId === comm.id);
        const hasOpenGroup = commGroups.some((g) => !g.onlyAdminsCanPost);
        if (!hasOpenGroup) {
          await db
            .insert(communityGroups)
            .values({
              communityId: comm.id,
              name: 'General Discussion',
              description: `Open discussion group for ${comm.name}`,
              groupType: 'group',
              onlyAdminsCanPost: false,
              createdByUserId: comm.createdByUserId ?? null,
            })
            .onConflictDoNothing();
        }
      }
    }

    baselineEnsured = true;
  } catch (error) {
    console.error('Baseline settings initialization error:', error);
    throw new Error('Database initialization failed. Please retry shortly.', { cause: error });
  }
}

// ============================================================
// Auth & User Queries
// ============================================================
export async function getHodCount(): Promise<number> {
  try {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'hod'), eq(users.status, 'approved')));
    return rows.length;
  } catch (error) {
    console.error('Failed to query HOD count:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function findUserByEmail(email: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to find user by email:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function findUserByEmailOrIdentifier(identifier: string) {
  const cleaned = identifier.trim();
  if (!cleaned) return null;
  if (cleaned.includes('@')) {
    return findUserByEmail(cleaned.toLowerCase());
  }
  try {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.staffOrRollId, cleaned.toUpperCase()))
      .limit(2);
    if (rows.length === 1) return rows[0];
    return rows.find((r) => r.status === 'approved') ?? rows[0] ?? null;
  } catch (error) {
    console.error('Failed to find user by identifier:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function findUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to find user by UID:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function findUserById(id: number) {
  try {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Failed to find user by ID:', error);
    throw new Error('Database query failed.', { cause: error });
  }
}

export async function findUserWithMetaById(id: number): Promise<UserProfile | null> {
  const row = await findUserById(id);
  return row ? enrichUserWithMeta(row) : null;
}

async function seedGooglePhotoIfUnlocked(userId: number, photoUrl?: string): Promise<void> {
  const cleanUrl = String(photoUrl ?? '').trim();
  if (!cleanUrl || (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://'))) return;
  try {
    const existing = await db
      .select()
      .from(userProfileMeta)
      .where(eq(userProfileMeta.userId, userId))
      .limit(1);
    if (existing[0]?.faceRegisteredLocked || existing[0]?.profileImageData) return;
    await db
      .insert(userProfileMeta)
      .values({
        userId,
        profileImageData: cleanUrl,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userProfileMeta.userId,
        set: {
          profileImageData: cleanUrl,
          updatedAt: new Date(),
        },
      });
  } catch {
    // Non-critical photo seed failure
  }
}

export async function syncFirebaseUserToDb(params: {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
}): Promise<UserProfile> {
  try {
    await ensureBaselineData();
    const emailLower = params.email.trim().toLowerCase();
    const deptName = await getSetting('department_name', 'Computer Science & Engineering');

    const byUid = await findUserByUid(params.uid);
    if (byUid) {
      if (byUid.email !== emailLower) {
        const collision = await findUserByEmail(emailLower);
        if (!collision) {
          const [updated] = await db
            .update(users)
            .set({ email: emailLower })
            .where(eq(users.id, byUid.id))
            .returning();
          await seedGooglePhotoIfUnlocked(updated.id, params.photoUrl);
          return enrichUserWithMeta(updated);
        }
      }
      await seedGooglePhotoIfUnlocked(byUid.id, params.photoUrl);
      return enrichUserWithMeta(byUid);
    }

    const byEmail = await findUserByEmail(emailLower);
    if (byEmail) {
      const [linked] = await db
        .update(users)
        .set({ uid: params.uid })
        .where(eq(users.id, byEmail.id))
        .returning();
      await seedGooglePhotoIfUnlocked(linked.id, params.photoUrl);
      return enrichUserWithMeta(linked);
    }

    // If no HOD exists yet, grant HOD role to first Google Sign-In administrator
    const hodCount = await getHodCount();
    const isInitialHod = hodCount === 0;

    // Match pre-uploaded academic directory records when provisioning a first-time Google user
    let inferredRole: UserRole = isInitialHod ? 'hod' : 'student';
    let inferredDept = deptName;
    let inferredStaffOrRollId = isInitialHod ? 'HOD-001' : '';
    let inferredYear = '';
    let inferredSection = '';
    let inferredPhone = '';

    if (!isInitialHod) {
      const [deptStaffHit, otherStaffHit, studentHit] = await Promise.all([
        db.select().from(departmentStaff).where(eq(departmentStaff.email, emailLower)).limit(1),
        db
          .select()
          .from(otherDepartmentStaff)
          .where(eq(otherDepartmentStaff.email, emailLower))
          .limit(1),
        db
          .select()
          .from(departmentStudents)
          .where(eq(departmentStudents.email, emailLower))
          .limit(1),
      ]);

      if (deptStaffHit[0]) {
        inferredRole = deptStaffHit[0].isClassAdvisor ? 'class_advisor' : 'dept_staff';
        inferredDept = deptStaffHit[0].department || deptName;
        inferredStaffOrRollId = deptStaffHit[0].employeeId || '';
        const advClass = (deptStaffHit[0].advisingClass || '').trim();
        if (advClass) {
          const parts = advClass.split(/[-–—·]/).map((p) => p.trim()).filter(Boolean);
          inferredYear = parts[0] || advClass;
          inferredSection = parts[1] || '';
        }
        inferredPhone = deptStaffHit[0].phone || '';
      } else if (otherStaffHit[0]) {
        inferredRole = 'other_dept_staff';
        inferredDept = otherStaffHit[0].homeDepartment || deptName;
        inferredStaffOrRollId = otherStaffHit[0].employeeId || '';
        inferredPhone = otherStaffHit[0].phone || '';
      } else if (studentHit[0]) {
        inferredRole = studentHit[0].isClassRep ? 'class_rep' : 'student';
        inferredDept = studentHit[0].department || deptName;
        inferredStaffOrRollId = studentHit[0].rollNo || '';
        inferredYear = studentHit[0].yearOfStudy || '';
        inferredSection = studentHit[0].section || '';
        inferredPhone = studentHit[0].phone || '';
      }
    }

    const [created] = await db
      .insert(users)
      .values({
        uid: params.uid,
        fullName: params.displayName?.trim() || emailLower.split('@')[0],
        email: emailLower,
        role: inferredRole,
        department: inferredDept,
        staffOrRollId: inferredStaffOrRollId,
        yearOfStudy: inferredYear,
        section: inferredSection,
        phone: inferredPhone,
        status: isInitialHod ? 'approved' : 'pending',
        approvedBy: isInitialHod ? 'Google Workspace Setup' : null,
        approvedAt: isInitialHod ? formatTs(new Date()) : null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { uid: params.uid },
      })
      .returning();

    await seedGooglePhotoIfUnlocked(created.id, params.photoUrl);
    return enrichUserWithMeta(created);
  } catch (error) {
    console.error('Failed to sync Firebase user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function setUserPasswordInDb(params: {
  userId: number;
  currentPassword?: string;
  newPassword: string;
}): Promise<void> {
  const existing = await findUserById(params.userId);
  if (!existing) {
    const err = new Error('User account not found.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  if (params.newPassword.length < 6) {
    const err = new Error('New password must be at least 6 characters.');
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  if (existing.passwordHash) {
    const current = params.currentPassword ?? '';
    if (!current || !verifyPassword(current, existing.passwordHash)) {
      const err = new Error('Current password is incorrect.');
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }
  }
  await db
    .update(users)
    .set({ passwordHash: hashPassword(params.newPassword) })
    .where(eq(users.id, params.userId));
}

export async function createSession(userId: number): Promise<string> {
  try {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(sessions).values({ token, userId, expiresAt });
    return token;
  } catch (error) {
    console.error('Failed to create session:', error);
    throw new Error('Unable to create login session.', { cause: error });
  }
}

export async function getUserBySessionToken(token: string): Promise<UserProfile | null> {
  try {
    const rows = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return rows[0] ? enrichUserWithMeta(rows[0].user) : null;
  } catch (error) {
    console.error('Session lookup failed:', error);
    throw new Error('Authentication check failed.', { cause: error });
  }
}

export async function deleteSession(token: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.token, token));
  } catch (error) {
    console.error('Failed to delete session:', error);
  }
}

// ============================================================
// Auto-Sync Registered Student into Main Department Students Directory
// ============================================================
export async function upsertStudentFromRegistration(params: {
  rollNo: string;
  fullName: string;
  email: string;
  department: string;
  yearOfStudy: string;
  section: string;
  phone: string;
  isClassRep: boolean;
}): Promise<void> {
  const cleanRoll = params.rollNo.trim().toUpperCase();
  const cleanName = params.fullName.trim();
  if (!cleanRoll || !cleanName) return;

  try {
    const existing = await db
      .select()
      .from(departmentStudents)
      .where(eq(departmentStudents.rollNo, cleanRoll))
      .limit(1);

    if (existing[0]) {
      const current = existing[0];
      await db
        .update(departmentStudents)
        .set({
          fullName: cleanName,
          email: params.email.trim().toLowerCase() || current.email,
          department: params.department.trim() || current.department,
          yearOfStudy: params.yearOfStudy.trim() || current.yearOfStudy,
          section: params.section.trim().toUpperCase() || current.section,
          phone: params.phone.trim() || current.phone,
          isClassRep: current.isClassRep || params.isClassRep,
        })
        .where(eq(departmentStudents.id, current.id));
      return;
    }

    await db
      .insert(departmentStudents)
      .values({
        rollNo: cleanRoll,
        fullName: cleanName,
        email: params.email.trim().toLowerCase(),
        department: params.department.trim() || 'Department',
        yearOfStudy: params.yearOfStudy.trim() || 'I Year',
        section: params.section.trim().toUpperCase() || 'A',
        phone: params.phone.trim(),
        isClassRep: params.isClassRep,
        crResponsibility: params.isClassRep ? 'Class Coordination' : '',
        advisorName: '',
        cgpa: '',
        sourceBatchId: null,
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error('Failed to sync registered student to department_students:', error);
  }
}

// ============================================================
// Directory & Timetable Queries
// ============================================================
async function buildDirectoryPhotoLookups() {
  const [userRows, metaRows, bioRows] = await Promise.all([
    db.select().from(users).where(eq(users.status, 'approved')),
    db.select().from(userProfileMeta),
    db
      .select({
        rollNo: studentBiometricProfiles.rollNo,
        email: studentBiometricProfiles.email,
        faceImageData: studentBiometricProfiles.faceImageData,
      })
      .from(studentBiometricProfiles),
  ]);

  const metaByUserId = new Map(metaRows.map((m) => [m.userId, m]));
  const photoByKey = new Map<string, { photoData: string; locked: boolean }>();

  for (const b of bioRows) {
    if (!b.faceImageData) continue;
    const entry = { photoData: b.faceImageData, locked: true };
    if (b.rollNo) photoByKey.set(`id:${b.rollNo.trim().toUpperCase()}`, entry);
    if (b.email) photoByKey.set(`email:${b.email.trim().toLowerCase()}`, entry);
  }

  for (const u of userRows) {
    const meta = metaByUserId.get(u.id);
    if (!meta?.profileImageData) continue;
    const entry = { photoData: meta.profileImageData, locked: Boolean(meta.faceRegisteredLocked) };
    if (u.staffOrRollId) photoByKey.set(`id:${u.staffOrRollId.trim().toUpperCase()}`, entry);
    if (u.email) photoByKey.set(`email:${u.email.trim().toLowerCase()}`, entry);
    if (u.fullName) photoByKey.set(`name:${u.fullName.trim().toLowerCase()}`, entry);
  }

  return photoByKey;
}

export async function listDepartmentStudents(): Promise<DepartmentStudent[]> {
  try {
    await ensureBaselineData();
    const [rows, photoLookup] = await Promise.all([
      db
        .select({
          student: departmentStudents,
          sourceFilename: uploadBatches.originalFilename,
        })
        .from(departmentStudents)
        .leftJoin(uploadBatches, eq(departmentStudents.sourceBatchId, uploadBatches.id))
        .orderBy(
          asc(departmentStudents.yearOfStudy),
          asc(departmentStudents.section),
          desc(departmentStudents.isClassRep),
          asc(departmentStudents.rollNo)
        ),
      buildDirectoryPhotoLookups(),
    ]);

    return rows.map(({ student, sourceFilename }) => {
      const photo =
        photoLookup.get(`id:${student.rollNo.trim().toUpperCase()}`) ??
        (student.email ? photoLookup.get(`email:${student.email.trim().toLowerCase()}`) : undefined);
      return {
        id: student.id,
        rollNo: student.rollNo,
        fullName: student.fullName,
        email: student.email,
        department: student.department,
        yearOfStudy: student.yearOfStudy,
        section: student.section,
        phone: student.phone,
        isClassRep: student.isClassRep,
        crResponsibility: student.crResponsibility,
        advisorName: student.advisorName,
        cgpa: student.cgpa,
        sourceBatchId: student.sourceBatchId ?? null,
        sourceFilename: sourceFilename ?? null,
        createdAt: formatTs(student.createdAt),
        photoData: photo?.photoData || '',
        faceRegisteredLocked: photo?.locked ?? false,
      };
    });
  } catch (error) {
    console.error('Failed to list students:', error);
    throw new Error('Unable to load student records.', { cause: error });
  }
}

export async function listDepartmentStaff(): Promise<DepartmentStaff[]> {
  try {
    await ensureBaselineData();
    const [rows, photoLookup] = await Promise.all([
      db
        .select({
          staff: departmentStaff,
          sourceFilename: uploadBatches.originalFilename,
        })
        .from(departmentStaff)
        .leftJoin(uploadBatches, eq(departmentStaff.sourceBatchId, uploadBatches.id))
        .orderBy(asc(departmentStaff.employeeId)),
      buildDirectoryPhotoLookups(),
    ]);

    return rows.map(({ staff, sourceFilename }) => {
      const photo =
        photoLookup.get(`id:${staff.employeeId.trim().toUpperCase()}`) ??
        (staff.email ? photoLookup.get(`email:${staff.email.trim().toLowerCase()}`) : undefined) ??
        photoLookup.get(`name:${staff.fullName.trim().toLowerCase()}`);
      return {
        id: staff.id,
        employeeId: staff.employeeId,
        fullName: staff.fullName,
        email: staff.email,
        department: staff.department,
        designation: staff.designation,
        specialization: staff.specialization,
        phone: staff.phone,
        isClassAdvisor: staff.isClassAdvisor,
        advisingClass: staff.advisingClass,
        sourceBatchId: staff.sourceBatchId ?? null,
        sourceFilename: sourceFilename ?? null,
        createdAt: formatTs(staff.createdAt),
        photoData: photo?.photoData || '',
        faceRegisteredLocked: photo?.locked ?? false,
      };
    });
  } catch (error) {
    console.error('Failed to list department staff:', error);
    throw new Error('Unable to load department staff.', { cause: error });
  }
}

export async function listOtherDepartmentStaff(): Promise<OtherDepartmentStaff[]> {
  try {
    await ensureBaselineData();
    const [rows, photoLookup] = await Promise.all([
      db
        .select({
          staff: otherDepartmentStaff,
          sourceFilename: uploadBatches.originalFilename,
        })
        .from(otherDepartmentStaff)
        .leftJoin(uploadBatches, eq(otherDepartmentStaff.sourceBatchId, uploadBatches.id))
        .orderBy(asc(otherDepartmentStaff.homeDepartment), asc(otherDepartmentStaff.employeeId)),
      buildDirectoryPhotoLookups(),
    ]);

    return rows.map(({ staff, sourceFilename }) => {
      const photo =
        photoLookup.get(`id:${staff.employeeId.trim().toUpperCase()}`) ??
        (staff.email ? photoLookup.get(`email:${staff.email.trim().toLowerCase()}`) : undefined) ??
        photoLookup.get(`name:${staff.fullName.trim().toLowerCase()}`);
      return {
        id: staff.id,
        employeeId: staff.employeeId,
        fullName: staff.fullName,
        email: staff.email,
        homeDepartment: staff.homeDepartment,
        handlingSubject: staff.handlingSubject,
        designation: staff.designation,
        phone: staff.phone,
        visitingDays: staff.visitingDays,
        sourceBatchId: staff.sourceBatchId ?? null,
        sourceFilename: sourceFilename ?? null,
        createdAt: formatTs(staff.createdAt),
        photoData: photo?.photoData || '',
        faceRegisteredLocked: photo?.locked ?? false,
      };
    });
  } catch (error) {
    console.error('Failed to list other department staff:', error);
    throw new Error('Unable to load other department staff.', { cause: error });
  }
}

export function parseTimeToMinutes(hhmm: string): number {
  const m = String(hhmm ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 24 * 60;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 24 * 60;
  return Math.max(0, Math.min(24 * 60, hh * 60 + mm));
}

export function formatTimePeriodPerHour(
  startTime: string,
  endTime: string,
  periodNumber: number
): string {
  const s = parseTimeToMinutes(startTime);
  const e = parseTimeToMinutes(endTime);
  const diff = e > s && s < 24 * 60 && e <= 24 * 60 ? e - s : 50;
  return `${startTime}–${endTime} (${diff} min / Hr ${periodNumber})`;
}

export function mapFacultyAlterationRow(
  r: typeof facultyAlterations.$inferSelect
): FacultyAlterationItem {
  return {
    id: r.id,
    department: r.department,
    yearOfStudy: r.yearOfStudy,
    section: r.section,
    dayOfWeek: r.dayOfWeek,
    periodNumber: r.periodNumber,
    alterationDate: r.alterationDate,
    timetableSlotId: r.timetableSlotId ?? null,
    subjectCode: r.subjectCode,
    subjectName: r.subjectName,
    roomNo: r.roomNo,
    requestingUserId: r.requestingUserId ?? null,
    requestingFacultyName: r.requestingFacultyName,
    substituteUserId: r.substituteUserId ?? null,
    substituteFacultyName: r.substituteFacultyName,
    substituteEmail: r.substituteEmail,
    substitutePhone: r.substitutePhone,
    reasonCategory: (r.reasonCategory as FacultyAlterationItem['reasonCategory']) || 'busy',
    reasonNote: r.reasonNote,
    status: (r.status as FacultyAlterationItem['status']) || 'pending_hod',
    hodReviewedBy: r.hodReviewedBy,
    hodRemarks: r.hodRemarks,
    hodReviewedAt: r.hodReviewedAt ? formatTs(r.hodReviewedAt) : null,
    createdAt: formatTs(r.createdAt),
  };
}

export async function listTimetableSlots(): Promise<TimetableSlot[]> {
  try {
    await ensureBaselineData();
    const [tz, dept] = await Promise.all([
      getSetting('academic_timezone', 'Asia/Kolkata'),
      getSetting('department_name', 'Computer Science & Engineering'),
    ]);
    const todayIso = computeServerTimeStatus(tz, dept).isoDate;

    const [rows, approvedAlterations] = await Promise.all([
      db
        .select()
        .from(timetableSlots)
        .orderBy(
          asc(timetableSlots.yearOfStudy),
          asc(timetableSlots.section),
          asc(timetableSlots.dayOfWeek),
          asc(timetableSlots.periodNumber)
        ),
      db
        .select()
        .from(facultyAlterations)
        .where(
          and(
            eq(facultyAlterations.status, 'approved'),
            eq(facultyAlterations.alterationDate, todayIso)
          )
        )
        .orderBy(desc(facultyAlterations.id)),
    ]);

    const mappedAlts = approvedAlterations.map(mapFacultyAlterationRow);

    return rows.map((r) => {
      const activeAlteration =
        mappedAlts.find(
          (a) =>
            a.timetableSlotId === r.id ||
            (a.dayOfWeek === r.dayOfWeek &&
              a.periodNumber === r.periodNumber &&
              a.yearOfStudy === r.yearOfStudy &&
              a.section.toUpperCase() === r.section.toUpperCase())
        ) ?? null;

      return {
        id: r.id,
        department: r.department,
        yearOfStudy: r.yearOfStudy,
        section: r.section,
        dayOfWeek: r.dayOfWeek,
        periodNumber: r.periodNumber,
        startTime: r.startTime,
        endTime: r.endTime,
        timePeriodPerHour: formatTimePeriodPerHour(r.startTime, r.endTime, r.periodNumber),
        subjectCode: r.subjectCode,
        subjectName: r.subjectName,
        facultyName: r.facultyName,
        facultyType: r.facultyType as 'department' | 'other_department',
        roomNo: r.roomNo,
        sourceBatchId: r.sourceBatchId ?? null,
        createdAt: formatTs(r.createdAt),
        activeAlteration,
      };
    });
  } catch (error) {
    console.error('Failed to list timetable slots:', error);
    throw new Error('Unable to load timetable records.', { cause: error });
  }
}

export interface TimetableSlotInput {
  department: string;
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

function mapTimetableRow(r: typeof timetableSlots.$inferSelect): TimetableSlot {
  return {
    id: r.id,
    department: r.department,
    yearOfStudy: r.yearOfStudy,
    section: r.section,
    dayOfWeek: r.dayOfWeek,
    periodNumber: r.periodNumber,
    startTime: r.startTime,
    endTime: r.endTime,
    timePeriodPerHour: formatTimePeriodPerHour(r.startTime, r.endTime, r.periodNumber),
    subjectCode: r.subjectCode,
    subjectName: r.subjectName,
    facultyName: r.facultyName,
    facultyType: r.facultyType as 'department' | 'other_department',
    roomNo: r.roomNo,
    sourceBatchId: r.sourceBatchId ?? null,
    createdAt: formatTs(r.createdAt),
  };
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function resequenceTimetableDaySlots(
  tx: DbTransaction,
  department: string,
  yearOfStudy: string,
  section: string,
  dayOfWeek: string
): Promise<void> {
  const dayRows = await tx
    .select()
    .from(timetableSlots)
    .where(
      and(
        eq(timetableSlots.department, department),
        eq(timetableSlots.yearOfStudy, yearOfStudy),
        eq(timetableSlots.section, section),
        eq(timetableSlots.dayOfWeek, dayOfWeek)
      )
    );

  if (dayRows.length === 0) return;

  const sorted = [...dayRows].sort((a, b) => {
    const startDiff = parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime);
    if (startDiff !== 0) return startDiff;
    const endDiff = parseTimeToMinutes(a.endTime) - parseTimeToMinutes(b.endTime);
    if (endDiff !== 0) return endDiff;
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber;
    return a.id - b.id;
  });

  const needsUpdate = sorted.some((row, idx) => row.periodNumber !== idx + 1);
  if (!needsUpdate) return;

  // Step 1: assign negative temporary period numbers to avoid unique index collision
  for (let i = 0; i < sorted.length; i++) {
    await tx
      .update(timetableSlots)
      .set({ periodNumber: -(i + 1000) })
      .where(eq(timetableSlots.id, sorted[i].id));
  }

  // Step 2: assign clean chronological 1..N period numbers
  for (let i = 0; i < sorted.length; i++) {
    await tx
      .update(timetableSlots)
      .set({ periodNumber: i + 1 })
      .where(eq(timetableSlots.id, sorted[i].id));
  }
}

export async function saveTimetableSlot(
  input: TimetableSlotInput,
  existingId?: number
): Promise<TimetableSlot> {
  try {
    await ensureBaselineData();
    const values = {
      department: input.department.trim(),
      yearOfStudy: input.yearOfStudy.trim(),
      section: input.section.trim().toUpperCase(),
      dayOfWeek: input.dayOfWeek.trim(),
      periodNumber: input.periodNumber,
      startTime: input.startTime.trim(),
      endTime: input.endTime.trim(),
      subjectCode: input.subjectCode.trim().toUpperCase(),
      subjectName: input.subjectName.trim(),
      facultyName: input.facultyName.trim(),
      facultyType: input.facultyType,
      roomNo: input.roomNo.trim(),
    };

    const finalRow = await db.transaction(async (tx) => {
      let targetId: number;
      let oldCohort: {
        department: string;
        yearOfStudy: string;
        section: string;
        dayOfWeek: string;
      } | null = null;

      if (existingId && Number.isInteger(existingId) && existingId > 0) {
        const prev = await tx
          .select()
          .from(timetableSlots)
          .where(eq(timetableSlots.id, existingId))
          .limit(1);
        if (prev[0]) {
          oldCohort = {
            department: prev[0].department,
            yearOfStudy: prev[0].yearOfStudy,
            section: prev[0].section,
            dayOfWeek: prev[0].dayOfWeek,
          };
        }

        // Remove any OTHER conflicting slot at the target (dept, year, section, day, period)
        await tx
          .delete(timetableSlots)
          .where(
            and(
              ne(timetableSlots.id, existingId),
              eq(timetableSlots.department, values.department),
              eq(timetableSlots.yearOfStudy, values.yearOfStudy),
              eq(timetableSlots.section, values.section),
              eq(timetableSlots.dayOfWeek, values.dayOfWeek),
              eq(timetableSlots.periodNumber, values.periodNumber)
            )
          );

        const [updated] = await tx
          .update(timetableSlots)
          .set(values)
          .where(eq(timetableSlots.id, existingId))
          .returning();

        if (updated) {
          targetId = updated.id;
        } else {
          const [inserted] = await tx
            .insert(timetableSlots)
            .values(values)
            .onConflictDoUpdate({
              target: [
                timetableSlots.department,
                timetableSlots.yearOfStudy,
                timetableSlots.section,
                timetableSlots.dayOfWeek,
                timetableSlots.periodNumber,
              ],
              set: {
                startTime: values.startTime,
                endTime: values.endTime,
                subjectCode: values.subjectCode,
                subjectName: values.subjectName,
                facultyName: values.facultyName,
                facultyType: values.facultyType,
                roomNo: values.roomNo,
              },
            })
            .returning();
          targetId = inserted.id;
        }
      } else {
        const [saved] = await tx
          .insert(timetableSlots)
          .values(values)
          .onConflictDoUpdate({
            target: [
              timetableSlots.department,
              timetableSlots.yearOfStudy,
              timetableSlots.section,
              timetableSlots.dayOfWeek,
              timetableSlots.periodNumber,
            ],
            set: {
              startTime: values.startTime,
              endTime: values.endTime,
              subjectCode: values.subjectCode,
              subjectName: values.subjectName,
              facultyName: values.facultyName,
              facultyType: values.facultyType,
              roomNo: values.roomNo,
            },
          })
          .returning();
        targetId = saved.id;
      }

      if (
        oldCohort &&
        (oldCohort.department !== values.department ||
          oldCohort.yearOfStudy !== values.yearOfStudy ||
          oldCohort.section !== values.section ||
          oldCohort.dayOfWeek !== values.dayOfWeek)
      ) {
        await resequenceTimetableDaySlots(
          tx,
          oldCohort.department,
          oldCohort.yearOfStudy,
          oldCohort.section,
          oldCohort.dayOfWeek
        );
      }

      await resequenceTimetableDaySlots(
        tx,
        values.department,
        values.yearOfStudy,
        values.section,
        values.dayOfWeek
      );

      const refreshed = await tx
        .select()
        .from(timetableSlots)
        .where(eq(timetableSlots.id, targetId))
        .limit(1);
      return refreshed[0];
    });

    return mapTimetableRow(finalRow);
  } catch (error) {
    console.error('Failed to save timetable slot:', error);
    throw new Error('Unable to save timetable slot.', { cause: error });
  }
}

export async function deleteTimetableSlot(id: number): Promise<boolean> {
  try {
    await ensureBaselineData();
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          department: timetableSlots.department,
          yearOfStudy: timetableSlots.yearOfStudy,
          section: timetableSlots.section,
          dayOfWeek: timetableSlots.dayOfWeek,
        })
        .from(timetableSlots)
        .where(eq(timetableSlots.id, id))
        .limit(1);

      const deleted = await tx
        .delete(timetableSlots)
        .where(eq(timetableSlots.id, id))
        .returning({ id: timetableSlots.id });

      if (deleted.length > 0 && existing[0]) {
        await resequenceTimetableDaySlots(
          tx,
          existing[0].department,
          existing[0].yearOfStudy,
          existing[0].section,
          existing[0].dayOfWeek
        );
      }

      return deleted.length > 0;
    });
  } catch (error) {
    console.error('Failed to delete timetable slot:', error);
    throw new Error('Unable to delete timetable slot.', { cause: error });
  }
}

export async function listUploadBatches(): Promise<UploadBatch[]> {
  try {
    await ensureBaselineData();
    const rows = await db
      .select()
      .from(uploadBatches)
      .orderBy(desc(uploadBatches.id))
      .limit(50);

    return rows.map((r) => ({
      id: r.id,
      targetModule: r.targetModule as UploadModule,
      originalFilename: r.originalFilename,
      fileType: r.fileType,
      recordsInserted: r.recordsInserted,
      recordsUpdated: r.recordsUpdated,
      uploadedByName: r.uploadedByName,
      uploadedByRole: r.uploadedByRole,
      createdAt: formatTs(r.createdAt),
    }));
  } catch (error) {
    console.error('Failed to list upload batches:', error);
    throw new Error('Unable to load document import ledger.', { cause: error });
  }
}

export async function commitDocumentRowsToDb(params: {
  targetModule: UploadModule;
  originalFilename: string;
  fileType: string;
  rows: Record<string, unknown>[];
  uploadedByName: string;
  uploadedByRole: string;
  defaultDepartment: string;
}): Promise<{ recordsInserted: number; recordsUpdated: number }> {
  try {
    let inserted = 0;
    let updated = 0;

    await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(uploadBatches)
        .values({
          targetModule: params.targetModule,
          originalFilename: params.originalFilename,
          fileType: params.fileType || 'doc',
          recordsInserted: 0,
          recordsUpdated: 0,
          uploadedByName: params.uploadedByName,
          uploadedByRole: params.uploadedByRole,
        })
        .returning();

      if (
        params.targetModule === 'department_students' ||
        params.targetModule === 'class_representatives'
      ) {
        const seenRolls = new Set<string>();
        for (const r of params.rows) {
          const rollNo = String(r.rollNo ?? '').trim().toUpperCase();
          const fullName = String(r.fullName ?? '').trim();
          if (!rollNo || !fullName || seenRolls.has(rollNo)) continue;
          seenRolls.add(rollNo);

          const existing = await tx
            .select({ id: departmentStudents.id })
            .from(departmentStudents)
            .where(eq(departmentStudents.rollNo, rollNo))
            .limit(1);

          await tx
            .insert(departmentStudents)
            .values({
              rollNo,
              fullName,
              email: String(r.email ?? '').trim().toLowerCase(),
              department: String(r.department ?? params.defaultDepartment).trim(),
              yearOfStudy: String(r.yearOfStudy ?? 'III Year').trim(),
              section: String(r.section ?? 'A').trim().toUpperCase(),
              phone: String(r.phone ?? '').trim(),
              isClassRep:
                params.targetModule === 'class_representatives' || Boolean(r.isClassRep),
              crResponsibility: String(r.crResponsibility ?? '').trim(),
              advisorName: String(r.advisorName ?? '').trim(),
              cgpa: String(r.cgpa ?? '').trim(),
              sourceBatchId: batch.id,
            })
            .onConflictDoUpdate({
              target: departmentStudents.rollNo,
              set: {
                fullName,
                email: String(r.email ?? '').trim().toLowerCase(),
                department: String(r.department ?? params.defaultDepartment).trim(),
                yearOfStudy: String(r.yearOfStudy ?? 'III Year').trim(),
                section: String(r.section ?? 'A').trim().toUpperCase(),
                phone: String(r.phone ?? '').trim(),
                isClassRep:
                  params.targetModule === 'class_representatives' || Boolean(r.isClassRep),
                crResponsibility: String(r.crResponsibility ?? '').trim(),
                advisorName: String(r.advisorName ?? '').trim(),
                cgpa: String(r.cgpa ?? '').trim(),
                sourceBatchId: batch.id,
              },
            });

          if (existing.length > 0) updated++;
          else inserted++;
        }
      } else if (params.targetModule === 'department_staff') {
        const seenIds = new Set<string>();
        for (const r of params.rows) {
          const employeeId = String(r.employeeId ?? '').trim().toUpperCase();
          const fullName = String(r.fullName ?? '').trim();
          if (!employeeId || !fullName || seenIds.has(employeeId)) continue;
          seenIds.add(employeeId);

          const existing = await tx
            .select({ id: departmentStaff.id })
            .from(departmentStaff)
            .where(eq(departmentStaff.employeeId, employeeId))
            .limit(1);

          await tx
            .insert(departmentStaff)
            .values({
              employeeId,
              fullName,
              email: String(r.email ?? '').trim().toLowerCase(),
              department: String(r.department ?? params.defaultDepartment).trim(),
              designation: String(r.designation ?? 'Assistant Professor').trim(),
              specialization: String(r.specialization ?? '').trim(),
              phone: String(r.phone ?? '').trim(),
              isClassAdvisor: Boolean(r.isClassAdvisor),
              advisingClass: String(r.advisingClass ?? '').trim(),
              sourceBatchId: batch.id,
            })
            .onConflictDoUpdate({
              target: departmentStaff.employeeId,
              set: {
                fullName,
                email: String(r.email ?? '').trim().toLowerCase(),
                department: String(r.department ?? params.defaultDepartment).trim(),
                designation: String(r.designation ?? 'Assistant Professor').trim(),
                specialization: String(r.specialization ?? '').trim(),
                phone: String(r.phone ?? '').trim(),
                isClassAdvisor: Boolean(r.isClassAdvisor),
                advisingClass: String(r.advisingClass ?? '').trim(),
                sourceBatchId: batch.id,
              },
            });

          if (existing.length > 0) updated++;
          else inserted++;
        }
      } else if (params.targetModule === 'other_department_staff') {
        const seenIds = new Set<string>();
        for (const r of params.rows) {
          const employeeId = String(r.employeeId ?? '').trim().toUpperCase();
          const fullName = String(r.fullName ?? '').trim();
          if (!employeeId || !fullName || seenIds.has(employeeId)) continue;
          seenIds.add(employeeId);

          const existing = await tx
            .select({ id: otherDepartmentStaff.id })
            .from(otherDepartmentStaff)
            .where(eq(otherDepartmentStaff.employeeId, employeeId))
            .limit(1);

          await tx
            .insert(otherDepartmentStaff)
            .values({
              employeeId,
              fullName,
              email: String(r.email ?? '').trim().toLowerCase(),
              homeDepartment: String(r.homeDepartment ?? 'Allied Department').trim(),
              handlingSubject: String(r.handlingSubject ?? '').trim(),
              designation: String(r.designation ?? 'Assistant Professor').trim(),
              phone: String(r.phone ?? '').trim(),
              visitingDays: String(r.visitingDays ?? '').trim(),
              sourceBatchId: batch.id,
            })
            .onConflictDoUpdate({
              target: otherDepartmentStaff.employeeId,
              set: {
                fullName,
                email: String(r.email ?? '').trim().toLowerCase(),
                homeDepartment: String(r.homeDepartment ?? 'Allied Department').trim(),
                handlingSubject: String(r.handlingSubject ?? '').trim(),
                designation: String(r.designation ?? 'Assistant Professor').trim(),
                phone: String(r.phone ?? '').trim(),
                visitingDays: String(r.visitingDays ?? '').trim(),
                sourceBatchId: batch.id,
              },
            });

          if (existing.length > 0) updated++;
          else inserted++;
        }
      } else if (params.targetModule === 'timetable') {
        const seenKeys = new Set<string>();
        const touchedCohorts = new Map<
          string,
          { department: string; yearOfStudy: string; section: string; dayOfWeek: string }
        >();

        // Sort chronologically within each (dept, year, section, day) before inserting & resequencing
        const sortedTimetableRows = [...params.rows].sort((a, b) => {
          const sA = parseTimeToMinutes(String(a.startTime ?? '08:45'));
          const sB = parseTimeToMinutes(String(b.startTime ?? '08:45'));
          if (sA !== sB) return sA - sB;
          return Number(a.periodNumber ?? 1) - Number(b.periodNumber ?? 1);
        });

        for (const r of sortedTimetableRows) {
          const dept = String(r.department ?? params.defaultDepartment).trim();
          const yearOfStudy = String(r.yearOfStudy ?? 'III Year').trim();
          const section = String(r.section ?? 'A').trim().toUpperCase();
          const dayOfWeek = String(r.dayOfWeek ?? 'Monday').trim();
          const periodNumber = Math.max(1, Math.min(12, Number(r.periodNumber ?? 1) || 1));
          const subjectName = String(r.subjectName ?? '').trim();
          const facultyName = String(r.facultyName ?? '').trim();
          const key = `${dept}|${yearOfStudy}|${section}|${dayOfWeek}|${periodNumber}`;
          if (!subjectName || !facultyName || seenKeys.has(key)) continue;
          seenKeys.add(key);

          const cohortKey = `${dept}|${yearOfStudy}|${section}|${dayOfWeek}`;
          touchedCohorts.set(cohortKey, { department: dept, yearOfStudy, section, dayOfWeek });

          const existing = await tx
            .select({ id: timetableSlots.id })
            .from(timetableSlots)
            .where(
              and(
                eq(timetableSlots.department, dept),
                eq(timetableSlots.yearOfStudy, yearOfStudy),
                eq(timetableSlots.section, section),
                eq(timetableSlots.dayOfWeek, dayOfWeek),
                eq(timetableSlots.periodNumber, periodNumber)
              )
            )
            .limit(1);

          await tx
            .insert(timetableSlots)
            .values({
              department: dept,
              yearOfStudy,
              section,
              dayOfWeek,
              periodNumber,
              startTime: String(r.startTime ?? '08:45').trim(),
              endTime: String(r.endTime ?? '09:35').trim(),
              subjectCode: String(r.subjectCode ?? 'CS000').trim().toUpperCase(),
              subjectName,
              facultyName,
              facultyType: r.facultyType === 'other_department' ? 'other_department' : 'department',
              roomNo: String(r.roomNo ?? 'CSE-301').trim(),
              sourceBatchId: batch.id,
            })
            .onConflictDoUpdate({
              target: [
                timetableSlots.department,
                timetableSlots.yearOfStudy,
                timetableSlots.section,
                timetableSlots.dayOfWeek,
                timetableSlots.periodNumber,
              ],
              set: {
                startTime: String(r.startTime ?? '08:45').trim(),
                endTime: String(r.endTime ?? '09:35').trim(),
                subjectCode: String(r.subjectCode ?? 'CS000').trim().toUpperCase(),
                subjectName,
                facultyName,
                facultyType:
                  r.facultyType === 'other_department' ? 'other_department' : 'department',
                roomNo: String(r.roomNo ?? 'CSE-301').trim(),
                sourceBatchId: batch.id,
              },
            });

          if (existing.length > 0) updated++;
          else inserted++;
        }

        for (const cohort of touchedCohorts.values()) {
          await resequenceTimetableDaySlots(
            tx,
            cohort.department,
            cohort.yearOfStudy,
            cohort.section,
            cohort.dayOfWeek
          );
        }
      }

      await tx
        .update(uploadBatches)
        .set({ recordsInserted: inserted, recordsUpdated: updated })
        .where(eq(uploadBatches.id, batch.id));
    });

    return { recordsInserted: inserted, recordsUpdated: updated };
  } catch (error) {
    console.error('Document commit failed:', error);
    throw new Error('Failed to save document records.', { cause: error });
  }
}

// ============================================================
// Duplicate Cleanup & Integrity Sweep
// ============================================================
export async function runDeduplicationSweep(): Promise<DeduplicateReport> {
  try {
    let studentsCleaned = 0;
    let deptStaffCleaned = 0;
    let otherStaffCleaned = 0;
    let timetableCleaned = 0;
    let attendanceCleaned = 0;

    await db.transaction(async (tx) => {
      // 1. Students case/whitespace dedupe
      const allStudents = await tx.select().from(departmentStudents).orderBy(asc(departmentStudents.id));
      const studentSeen = new Set<string>();
      for (const s of allStudents) {
        const norm = s.rollNo.trim().toUpperCase();
        if (studentSeen.has(norm)) {
          await tx.delete(departmentStudents).where(eq(departmentStudents.id, s.id));
          studentsCleaned++;
        } else {
          studentSeen.add(norm);
          if (norm !== s.rollNo) {
            await tx.update(departmentStudents).set({ rollNo: norm }).where(eq(departmentStudents.id, s.id));
          }
        }
      }

      // 2. Department staff dedupe
      const allStaff = await tx.select().from(departmentStaff).orderBy(asc(departmentStaff.id));
      const staffSeen = new Set<string>();
      for (const f of allStaff) {
        const norm = f.employeeId.trim().toUpperCase();
        if (staffSeen.has(norm)) {
          await tx.delete(departmentStaff).where(eq(departmentStaff.id, f.id));
          deptStaffCleaned++;
        } else {
          staffSeen.add(norm);
          if (norm !== f.employeeId) {
            await tx.update(departmentStaff).set({ employeeId: norm }).where(eq(departmentStaff.id, f.id));
          }
        }
      }

      // 3. Other department staff dedupe
      const allOther = await tx.select().from(otherDepartmentStaff).orderBy(asc(otherDepartmentStaff.id));
      const otherSeen = new Set<string>();
      for (const o of allOther) {
        const norm = o.employeeId.trim().toUpperCase();
        if (otherSeen.has(norm)) {
          await tx.delete(otherDepartmentStaff).where(eq(otherDepartmentStaff.id, o.id));
          otherStaffCleaned++;
        } else {
          otherSeen.add(norm);
          if (norm !== o.employeeId) {
            await tx.update(otherDepartmentStaff).set({ employeeId: norm }).where(eq(otherDepartmentStaff.id, o.id));
          }
        }
      }

      // 4. Timetable dedupe
      const allSlots = await tx.select().from(timetableSlots).orderBy(asc(timetableSlots.id));
      const slotSeen = new Set<string>();
      for (const sl of allSlots) {
        const key = `${sl.department.trim().toLowerCase()}|${sl.yearOfStudy.trim().toLowerCase()}|${sl.section.trim().toUpperCase()}|${sl.dayOfWeek.trim().toLowerCase()}|${sl.periodNumber}`;
        if (slotSeen.has(key)) {
          await tx.delete(timetableSlots).where(eq(timetableSlots.id, sl.id));
          timetableCleaned++;
        } else {
          slotSeen.add(key);
        }
      }

      // 5. Attendance dedupe
      const allAtt = await tx.select().from(attendanceRecords).orderBy(desc(attendanceRecords.id));
      const attSeen = new Set<string>();
      for (const a of allAtt) {
        const key = `${a.attendanceDate}|${a.periodNumber}|${a.personType}|${a.personIdentifier.trim().toUpperCase()}`;
        if (attSeen.has(key)) {
          await tx.delete(attendanceRecords).where(eq(attendanceRecords.id, a.id));
          attendanceCleaned++;
        } else {
          attSeen.add(key);
        }
      }
    });

    const totalRemoved =
      studentsCleaned + deptStaffCleaned + otherStaffCleaned + timetableCleaned + attendanceCleaned;

    return {
      studentsCleaned,
      deptStaffCleaned,
      otherStaffCleaned,
      timetableCleaned,
      attendanceCleaned,
      totalRemoved,
      message:
        totalRemoved === 0
          ? 'Database verified: zero duplicate records found across all directories, timetable, and attendance.'
          : `Removed ${totalRemoved} duplicate record(s) and normalized unique keys.`,
    };
  } catch (error) {
    console.error('Deduplication sweep failed:', error);
    throw new Error('Failed to run duplicate cleanup.', { cause: error });
  }
}

// ============================================================
// WhatsApp-Style Communities, Groups & Real-Time Messages
// ============================================================
export function canUserCreateCommunity(role: UserRole): boolean {
  return ['hod', 'class_advisor', 'dept_staff', 'other_dept_staff', 'class_rep', 'student'].includes(role);
}

export async function canUserManageCommunity(
  user: UserProfile,
  communityId: number
): Promise<boolean> {
  if (user.role === 'hod') return true;
  const comm = await db
    .select()
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!comm[0]) return false;
  if (comm[0].createdByUserId === user.id) return true;

  const membership = await db
    .select()
    .from(communityMembers)
    .where(
      and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, user.id))
    )
    .limit(1);
  return membership[0]?.memberRole === 'owner' || membership[0]?.memberRole === 'admin';
}

export async function listCommunitiesForUser(user: UserProfile): Promise<CommunityItem[]> {
  try {
    await ensureBaselineData();
    const allComms = await db.select().from(communities).orderBy(desc(communities.updatedAt));
    const allGroups = await db
      .select()
      .from(communityGroups)
      .orderBy(asc(communityGroups.id));
    const allMembers = await db.select().from(communityMembers);
    const msgStats = await db
      .select({
        groupId: chatMessages.groupId,
        count: sql<number>`count(*)::int`,
        lastAt: sql<string>`max(${chatMessages.createdAt})::text`,
      })
      .from(chatMessages)
      .groupBy(chatMessages.groupId);

    const latestMessages = await db
      .select()
      .from(chatMessages)
      .orderBy(desc(chatMessages.id))
      .limit(200);

    const lastPreviewByGroup = new Map<number, string>();
    for (const m of latestMessages) {
      if (!lastPreviewByGroup.has(m.groupId)) {
        const prefix = m.powerBoostEnabled ? '⚡ ' : '';
        const attachTag =
          m.attachmentType === 'document'
            ? '[Document] '
            : m.attachmentType === 'photo'
            ? '[Photo] '
            : m.attachmentType === 'voice'
            ? '[Voice Note] '
            : m.attachmentType === 'location'
            ? '[Live Location] '
            : m.attachmentType === 'contact'
            ? '[Contact] '
            : m.attachmentType === 'shared_link'
            ? '[Shared Link] '
            : m.attachmentType === 'call_invite'
            ? '[Call] '
            : '';
        lastPreviewByGroup.set(m.groupId, `${m.senderName}: ${prefix}${attachTag}${m.content}`);
      }
    }

    const statsMap = new Map(msgStats.map((s) => [s.groupId, s]));

    return allComms.map((c) => {
      const members = allMembers.filter((m) => m.communityId === c.id);
      const myMembership = members.find((m) => m.userId === user.id);
      const canManage =
        user.role === 'hod' ||
        c.createdByUserId === user.id ||
        myMembership?.memberRole === 'owner' ||
        myMembership?.memberRole === 'admin';

      const groups: CommunityGroupItem[] = allGroups
        .filter((g) => g.communityId === c.id)
        .map((g) => {
          const st = statsMap.get(g.id);
          return {
            id: g.id,
            communityId: g.communityId,
            name: g.name,
            description: g.description,
            groupType: g.groupType as CommunityGroupItem['groupType'],
            onlyAdminsCanPost: g.onlyAdminsCanPost,
            createdByUserId: g.createdByUserId ?? null,
            messageCount: st?.count ?? 0,
            lastMessagePreview: lastPreviewByGroup.get(g.id) ?? null,
            lastMessageAt: st?.lastAt ? formatTs(st.lastAt) : null,
            createdAt: formatTs(g.createdAt),
          };
        });

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        department: c.department,
        category: c.category as CommunityCategory,
        announcementOnly: c.announcementOnly,
        createdByUserId: c.createdByUserId ?? null,
        createdByName: c.createdByName,
        memberCount: Math.max(members.length, 1),
        canManage,
        groups,
        createdAt: formatTs(c.createdAt),
        updatedAt: formatTs(c.updatedAt),
      };
    });
  } catch (error) {
    console.error('Failed to list communities:', error);
    throw new Error('Unable to load communities.', { cause: error });
  }
}

export async function createCommunityInDb(params: {
  name: string;
  description: string;
  department: string;
  category: CommunityCategory;
  announcementOnly: boolean;
  user: UserProfile;
}): Promise<CommunityItem> {
  try {
    const createdId = await db.transaction(async (tx) => {
      const [comm] = await tx
        .insert(communities)
        .values({
          name: params.name.trim(),
          description: params.description.trim(),
          department: params.department.trim(),
          category: params.category,
          announcementOnly: params.announcementOnly,
          createdByUserId: params.user.id,
          createdByName: params.user.fullName,
        })
        .returning();

      await tx
        .insert(communityMembers)
        .values({
          communityId: comm.id,
          userId: params.user.id,
          memberRole: 'owner',
        })
        .onConflictDoNothing();

      const [annGroup] = await tx
        .insert(communityGroups)
        .values({
          communityId: comm.id,
          name: 'Announcements',
          description: `Official broadcasts for ${params.name.trim()}`,
          groupType: 'announcements',
          onlyAdminsCanPost: true,
          createdByUserId: params.user.id,
        })
        .returning();

      if (!params.announcementOnly) {
        await tx.insert(communityGroups).values({
          communityId: comm.id,
          name: 'General Discussion',
          description: `Open discussion group for ${params.name.trim()}`,
          groupType: 'group',
          onlyAdminsCanPost: false,
          createdByUserId: params.user.id,
        });
      }

      await tx.insert(chatMessages).values({
        groupId: annGroup.id,
        senderUserId: params.user.id,
        senderName: params.user.fullName,
        senderRole: params.user.role,
        content: `Community "${params.name.trim()}" was created.`,
        messageType: 'system',
        isPinned: false,
      });

      return comm.id;
    });

    const all = await listCommunitiesForUser(params.user);
    const found = all.find((c) => c.id === createdId);
    if (!found) throw new Error('Community created but could not be loaded.');
    return found;
  } catch (error) {
    console.error('Create community failed:', error);
    const msg =
      error instanceof Error && error.message.includes('unique')
        ? 'A community with this name already exists in the department.'
        : 'Unable to create community.';
    throw new Error(msg, { cause: error });
  }
}

export async function updateCommunityInDb(
  communityId: number,
  updates: {
    name?: string;
    description?: string;
    category?: CommunityCategory;
    announcementOnly?: boolean;
  }
) {
  try {
    const [updated] = await db
      .update(communities)
      .set({
        ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
        ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
        ...(updates.category !== undefined ? { category: updates.category } : {}),
        ...(updates.announcementOnly !== undefined
          ? { announcementOnly: updates.announcementOnly }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(communities.id, communityId))
      .returning();
    return updated ?? null;
  } catch (error) {
    console.error('Update community failed:', error);
    throw new Error('Unable to update community settings.', { cause: error });
  }
}

function parseAttachmentJson(raw: string | null | undefined): ChatAttachmentPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ChatAttachmentPayload;
    return null;
  } catch {
    return null;
  }
}

export interface SenderMetaSnapshot {
  senderPhotoData: string;
  senderStaffOrRollId: string;
  senderDepartment: string;
  senderYearSection: string;
  senderEmail: string;
  senderPhone: string;
}

export function mapChatMessageRow(
  m: typeof chatMessages.$inferSelect,
  acknowledgements: PowerBoostAcknowledgementItem[] = [],
  viewerUserId?: number,
  senderMeta?: SenderMetaSnapshot
): ChatMessageItem {
  return {
    id: m.id,
    groupId: m.groupId,
    senderUserId: m.senderUserId ?? null,
    senderName: m.senderName,
    senderRole: m.senderRole,
    content: m.content,
    messageType: m.messageType as ChatMessageItem['messageType'],
    attachmentType: (m.attachmentType || 'none') as ChatAttachmentType,
    attachment: parseAttachmentJson(m.attachmentData),
    powerBoostEnabled: Boolean(m.powerBoostEnabled),
    powerBoostIntervalMinutes: m.powerBoostIntervalMinutes ?? 0,
    powerBoostExpiresAt: m.powerBoostExpiresAt ? m.powerBoostExpiresAt.toISOString() : null,
    powerBoostActionUrl: m.powerBoostActionUrl || '',
    acknowledgements,
    acknowledgedByMe:
      viewerUserId !== undefined
        ? acknowledgements.some((a) => a.userId === viewerUserId)
        : false,
    replyToId: m.replyToId ?? null,
    isPinned: m.isPinned,
    editedAt: m.editedAt ? formatTs(m.editedAt) : null,
    createdAt: formatTs(m.createdAt),
    senderPhotoData: senderMeta?.senderPhotoData ?? '',
    senderStaffOrRollId: senderMeta?.senderStaffOrRollId ?? '',
    senderDepartment: senderMeta?.senderDepartment ?? '',
    senderYearSection: senderMeta?.senderYearSection ?? '',
    senderEmail: senderMeta?.senderEmail ?? '',
    senderPhone: senderMeta?.senderPhone ?? '',
  };
}

export async function getSenderMetaLookup(userIds: number[]): Promise<Map<number, SenderMetaSnapshot>> {
  const uniqueIds = Array.from(new Set(userIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return new Map();

  const [userRows, metaRows, bioRows] = await Promise.all([
    db.select().from(users).where(inArray(users.id, uniqueIds)),
    db.select().from(userProfileMeta).where(inArray(userProfileMeta.userId, uniqueIds)),
    db
      .select({
        rollNo: studentBiometricProfiles.rollNo,
        email: studentBiometricProfiles.email,
        faceImageData: studentBiometricProfiles.faceImageData,
      })
      .from(studentBiometricProfiles),
  ]);

  const metaById = new Map(metaRows.map((m) => [m.userId, m]));
  const bioByRoll = new Map(bioRows.map((b) => [b.rollNo.trim().toUpperCase(), b.faceImageData]));
  const bioByEmail = new Map(bioRows.map((b) => [b.email.trim().toLowerCase(), b.faceImageData]));
  const result = new Map<number, SenderMetaSnapshot>();

  for (const u of userRows) {
    const meta = metaById.get(u.id);
    const bioPhoto =
      (u.staffOrRollId ? bioByRoll.get(u.staffOrRollId.trim().toUpperCase()) : undefined) ??
      (u.email ? bioByEmail.get(u.email.trim().toLowerCase()) : undefined) ??
      '';
    const yrSec = [u.yearOfStudy, u.section ? `Sec ${u.section}` : ''].filter(Boolean).join(' · ');
    result.set(u.id, {
      senderPhotoData: meta?.profileImageData || bioPhoto || '',
      senderStaffOrRollId: u.staffOrRollId || '',
      senderDepartment: u.department || '',
      senderYearSection: yrSec,
      senderEmail: u.email || '',
      senderPhone: u.phone || '',
    });
  }

  return result;
}

export async function listGroupMessages(
  groupId: number,
  viewerUserId?: number
): Promise<ChatMessageItem[]> {
  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.groupId, groupId))
      .orderBy(asc(chatMessages.id))
      .limit(250);

    const msgIds = rows.map((r) => r.id);
    const senderIds = rows
      .map((r) => r.senderUserId)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    const [ackMap, senderLookup] = await Promise.all([
      (async () => {
        const map = new Map<number, PowerBoostAcknowledgementItem[]>();
        if (msgIds.length > 0) {
          const ackRows = await db
            .select()
            .from(messageAcknowledgements)
            .where(inArray(messageAcknowledgements.messageId, msgIds))
            .orderBy(asc(messageAcknowledgements.acknowledgedAt));

          for (const a of ackRows) {
            const list = map.get(a.messageId) ?? [];
            list.push({
              id: a.id,
              messageId: a.messageId,
              userId: a.userId,
              userName: a.userName,
              userRole: a.userRole,
              responseNote: a.responseNote,
              acknowledgedAt: formatTs(a.acknowledgedAt),
            });
            map.set(a.messageId, list);
          }
        }
        return map;
      })(),
      getSenderMetaLookup(senderIds),
    ]);

    return rows.map((m) =>
      mapChatMessageRow(
        m,
        ackMap.get(m.id) ?? [],
        viewerUserId,
        m.senderUserId ? senderLookup.get(m.senderUserId) : undefined
      )
    );
  } catch (error) {
    console.error('Failed to list messages:', error);
    throw new Error('Unable to load chat messages.', { cause: error });
  }
}

export async function createChatMessageInDb(params: {
  groupId: number;
  user: UserProfile;
  content: string;
  messageType?: 'text' | 'announcement' | 'call_invite';
  attachmentType?: ChatAttachmentType;
  attachment?: ChatAttachmentPayload | null;
  powerBoostEnabled?: boolean;
  powerBoostIntervalMinutes?: number;
  powerBoostExpiresAt?: Date | null;
  powerBoostActionUrl?: string;
  replyToId?: number | null;
}): Promise<ChatMessageItem> {
  try {
    const [inserted] = await db
      .insert(chatMessages)
      .values({
        groupId: params.groupId,
        senderUserId: params.user.id,
        senderName: params.user.fullName,
        senderRole: params.user.role,
        content: params.content.trim(),
        messageType: params.messageType ?? 'text',
        attachmentType: params.attachmentType ?? 'none',
        attachmentData: params.attachment ? JSON.stringify(params.attachment) : '',
        powerBoostEnabled: Boolean(params.powerBoostEnabled),
        powerBoostIntervalMinutes: params.powerBoostEnabled
          ? Math.max(1, Math.min(240, Number(params.powerBoostIntervalMinutes || 5)))
          : 0,
        powerBoostExpiresAt: params.powerBoostEnabled ? (params.powerBoostExpiresAt ?? null) : null,
        powerBoostActionUrl: params.powerBoostEnabled
          ? (params.powerBoostActionUrl ?? '').trim()
          : '',
        replyToId: params.replyToId ?? null,
        isPinned: false,
      })
      .returning();

    const yrSec = [params.user.yearOfStudy, params.user.section ? `Sec ${params.user.section}` : '']
      .filter(Boolean)
      .join(' · ');

    return mapChatMessageRow(inserted, [], params.user.id, {
      senderPhotoData: params.user.profileImageData || '',
      senderStaffOrRollId: params.user.staffOrRollId || '',
      senderDepartment: params.user.department || '',
      senderYearSection: yrSec,
      senderEmail: params.user.email || '',
      senderPhone: params.user.phone || '',
    });
  } catch (error) {
    console.error('Failed to insert chat message:', error);
    throw new Error('Unable to send message.', { cause: error });
  }
}

export async function acknowledgePowerBoostMessage(params: {
  messageId: number;
  user: UserProfile;
  responseNote?: string;
}): Promise<{ groupId: number; acknowledgement: PowerBoostAcknowledgementItem } | null> {
  try {
    const msgRows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, params.messageId))
      .limit(1);
    const msg = msgRows[0];
    if (!msg) return null;

    const note = (params.responseNote ?? 'Responded / Completed').trim().slice(0, 300);
    const [saved] = await db
      .insert(messageAcknowledgements)
      .values({
        messageId: params.messageId,
        userId: params.user.id,
        userName: params.user.fullName,
        userRole: params.user.role,
        responseNote: note,
      })
      .onConflictDoUpdate({
        target: [messageAcknowledgements.messageId, messageAcknowledgements.userId],
        set: {
          responseNote: note,
          acknowledgedAt: new Date(),
        },
      })
      .returning();

    return {
      groupId: msg.groupId,
      acknowledgement: {
        id: saved.id,
        messageId: saved.messageId,
        userId: saved.userId,
        userName: saved.userName,
        userRole: saved.userRole,
        responseNote: saved.responseNote,
        acknowledgedAt: formatTs(saved.acknowledgedAt),
      },
    };
  } catch (error) {
    console.error('Failed to acknowledge Power Boost message:', error);
    throw new Error('Unable to record response.', { cause: error });
  }
}

export async function stopPowerBoostMessage(messageId: number): Promise<number | null> {
  try {
    const [updated] = await db
      .update(chatMessages)
      .set({ powerBoostEnabled: false })
      .where(eq(chatMessages.id, messageId))
      .returning();
    return updated ? updated.groupId : null;
  } catch (error) {
    console.error('Failed to stop Power Boost:', error);
    throw new Error('Unable to disable Power Boost mode.', { cause: error });
  }
}

export async function listActivePowerBoostAlertsForUser(
  userId: number
): Promise<ActivePowerBoostAlert[]> {
  try {
    const now = new Date();
    const boostedRows = await db
      .select({
        message: chatMessages,
        groupName: communityGroups.name,
        communityName: communities.name,
      })
      .from(chatMessages)
      .innerJoin(communityGroups, eq(chatMessages.groupId, communityGroups.id))
      .innerJoin(communities, eq(communityGroups.communityId, communities.id))
      .where(
        and(
          eq(chatMessages.powerBoostEnabled, true),
          or(isNull(chatMessages.powerBoostExpiresAt), gt(chatMessages.powerBoostExpiresAt, now))
        )
      )
      .orderBy(desc(chatMessages.id))
      .limit(50);

    if (boostedRows.length === 0) return [];

    const msgIds = boostedRows.map((r) => r.message.id);
    const myAcks = await db
      .select({ messageId: messageAcknowledgements.messageId })
      .from(messageAcknowledgements)
      .where(
        and(
          eq(messageAcknowledgements.userId, userId),
          inArray(messageAcknowledgements.messageId, msgIds)
        )
      );
    const ackSet = new Set(myAcks.map((a) => a.messageId));

    return boostedRows
      .filter((r) => r.message.senderUserId !== userId && !ackSet.has(r.message.id))
      .map((r) => ({
        messageId: r.message.id,
        groupId: r.message.groupId,
        groupName: r.groupName,
        communityName: r.communityName,
        senderUserId: r.message.senderUserId ?? null,
        senderName: r.message.senderName,
        senderRole: r.message.senderRole,
        content: r.message.content,
        powerBoostIntervalMinutes: Math.max(1, r.message.powerBoostIntervalMinutes || 5),
        powerBoostExpiresAt: r.message.powerBoostExpiresAt
          ? r.message.powerBoostExpiresAt.toISOString()
          : null,
        powerBoostActionUrl: r.message.powerBoostActionUrl || '',
        createdAt: formatTs(r.message.createdAt),
      }));
  } catch (error) {
    console.error('Failed to list active Power Boost alerts:', error);
    throw new Error('Unable to load active Power Boost notifications.', { cause: error });
  }
}

function isStudentRole(role: string): boolean {
  return role === 'student' || role === 'class_rep';
}

function detectFormRequest(actionUrl: string, content: string): boolean {
  const lowerUrl = actionUrl.toLowerCase();
  if (lowerUrl.length > 0) return true;
  return /\b(google\s*form|forms\.gle|docs\.google\.com\/forms|fill\s+(out\s+)?(the\s+)?form|survey|registration\s+form|feedback\s+form)\b/i.test(
    content
  );
}

export async function getPowerBoostEngagementSummary(
  groupId?: number
): Promise<PowerBoostEngagementSummary> {
  try {
    const now = new Date();

    const [enrolledCountRows, approvedStudentRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(departmentStudents),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.status, 'approved'),
            or(eq(users.role, 'student'), eq(users.role, 'class_rep'))
          )
        ),
    ]);

    const enrolledStudentCount = enrolledCountRows[0]?.count ?? 0;
    const approvedStudentAccountCount = approvedStudentRows[0]?.count ?? 0;
    const totalTargetStudents = Math.max(enrolledStudentCount, approvedStudentAccountCount);

    const boostCondition = or(
      eq(chatMessages.powerBoostEnabled, true),
      gt(chatMessages.powerBoostIntervalMinutes, 0)
    );
    const whereClause =
      typeof groupId === 'number' && Number.isFinite(groupId)
        ? and(boostCondition, eq(chatMessages.groupId, groupId))
        : boostCondition;

    const boostedRows = await db
      .select({
        message: chatMessages,
        groupName: communityGroups.name,
        communityId: communities.id,
        communityName: communities.name,
      })
      .from(chatMessages)
      .innerJoin(communityGroups, eq(chatMessages.groupId, communityGroups.id))
      .innerJoin(communities, eq(communityGroups.communityId, communities.id))
      .where(whereClause)
      .orderBy(desc(chatMessages.id))
      .limit(100);

    const msgIds = boostedRows.map((r) => r.message.id);
    const ackMap = new Map<number, PowerBoostAcknowledgementItem[]>();

    if (msgIds.length > 0) {
      const ackRows = await db
        .select()
        .from(messageAcknowledgements)
        .where(inArray(messageAcknowledgements.messageId, msgIds))
        .orderBy(desc(messageAcknowledgements.acknowledgedAt));

      for (const a of ackRows) {
        const list = ackMap.get(a.messageId) ?? [];
        list.push({
          id: a.id,
          messageId: a.messageId,
          userId: a.userId,
          userName: a.userName,
          userRole: a.userRole,
          responseNote: a.responseNote,
          acknowledgedAt: formatTs(a.acknowledgedAt),
        });
        ackMap.set(a.messageId, list);
      }
    }

    const uniqueStudentIds = new Set<number>();
    let activeBoostedMessages = 0;
    let formRequestMessages = 0;
    let noticeMessages = 0;
    let totalStudentAcknowledgements = 0;
    let formStudentCompletions = 0;
    let noticeStudentAcknowledgements = 0;
    let totalPendingStudentResponses = 0;
    let sumRates = 0;

    const messages: PowerBoostMessageStatItem[] = boostedRows.map((row) => {
      const m = row.message;
      const acks = ackMap.get(m.id) ?? [];
      const studentAcks = acks.filter((a) => isStudentRole(a.userRole));
      const staffAcks = acks.filter((a) => !isStudentRole(a.userRole));

      for (const sa of studentAcks) {
        uniqueStudentIds.add(sa.userId);
      }

      const isFormRequest = detectFormRequest(m.powerBoostActionUrl || '', m.content);
      const isExpired = Boolean(m.powerBoostExpiresAt && m.powerBoostExpiresAt <= now);
      const status: PowerBoostMessageStatItem['status'] = !m.powerBoostEnabled
        ? 'stopped'
        : isExpired
        ? 'expired'
        : 'active';

      const effectiveTarget = Math.max(totalTargetStudents, studentAcks.length);
      const pendingStudents = Math.max(0, effectiveTarget - studentAcks.length);
      const studentCompletionRate =
        effectiveTarget > 0
          ? Math.min(100, Math.round((studentAcks.length / effectiveTarget) * 100))
          : 0;

      if (status === 'active') activeBoostedMessages++;
      if (isFormRequest) {
        formRequestMessages++;
        formStudentCompletions += studentAcks.length;
      } else {
        noticeMessages++;
        noticeStudentAcknowledgements += studentAcks.length;
      }

      totalStudentAcknowledgements += studentAcks.length;
      totalPendingStudentResponses += pendingStudents;
      sumRates += studentCompletionRate;

      return {
        messageId: m.id,
        groupId: m.groupId,
        groupName: row.groupName,
        communityId: row.communityId,
        communityName: row.communityName,
        senderName: m.senderName,
        senderRole: m.senderRole,
        content: m.content,
        isFormRequest,
        powerBoostActionUrl: m.powerBoostActionUrl || '',
        powerBoostIntervalMinutes: Math.max(1, m.powerBoostIntervalMinutes || 5),
        status,
        studentAcknowledgements: studentAcks.length,
        staffAcknowledgements: staffAcks.length,
        totalAcknowledgements: acks.length,
        pendingStudents,
        studentCompletionRate,
        acknowledgements: acks,
        createdAt: formatTs(m.createdAt),
      };
    });

    const averageStudentCompletionRate =
      messages.length > 0 ? Math.round(sumRates / messages.length) : 0;

    return {
      totalTargetStudents,
      enrolledStudentCount,
      approvedStudentAccountCount,
      totalBoostedMessages: messages.length,
      activeBoostedMessages,
      formRequestMessages,
      noticeMessages,
      totalStudentAcknowledgements,
      formStudentCompletions,
      noticeStudentAcknowledgements,
      uniqueStudentsEngaged: uniqueStudentIds.size,
      totalPendingStudentResponses,
      averageStudentCompletionRate,
      messages,
    };
  } catch (error) {
    console.error('Failed to build Power Boost engagement summary:', error);
    throw new Error('Unable to load Power Boost engagement statistics.', { cause: error });
  }
}

// ============================================================
// Dual-Camera Timetable Attendance Queries
// ============================================================
function mapAttendanceRow(r: typeof attendanceRecords.$inferSelect): AttendanceRecordItem {
  return {
    id: r.id,
    attendanceDate: r.attendanceDate,
    dayOfWeek: r.dayOfWeek,
    periodNumber: r.periodNumber,
    timetableSlotId: r.timetableSlotId ?? null,
    subjectCode: r.subjectCode,
    subjectName: r.subjectName,
    department: r.department,
    yearOfStudy: r.yearOfStudy,
    section: r.section,
    roomNo: r.roomNo,
    personType: r.personType as AttendancePersonType,
    personIdentifier: r.personIdentifier,
    personName: r.personName,
    markedByName: r.markedByName,
    status: r.status as AttendanceRecordItem['status'],
    faceImageData: r.faceImageData,
    environmentImageData: r.environmentImageData,
    faceDetected: r.faceDetected,
    faceConfidence: r.faceConfidence,
    environmentVerified: r.environmentVerified,
    environmentLabel: r.environmentLabel,
    verificationSummary: r.verificationSummary,
    serverTimestamp: r.serverTimestamp,
    createdAt: formatTs(r.createdAt),
  };
}

export async function listAttendanceRecords(filters?: {
  date?: string;
  month?: string;
  personType?: AttendancePersonType;
  limit?: number;
}): Promise<AttendanceRecordItem[]> {
  try {
    const conditions = [];
    if (filters?.date) {
      conditions.push(eq(attendanceRecords.attendanceDate, filters.date));
    }
    if (filters?.month) {
      conditions.push(like(attendanceRecords.attendanceDate, `${filters.month}-%`));
    }
    if (filters?.personType) {
      conditions.push(eq(attendanceRecords.personType, filters.personType));
    }

    const rowLimit = filters?.limit ?? (filters?.month ? 2500 : 500);

    const rows =
      conditions.length > 0
        ? await db
            .select()
            .from(attendanceRecords)
            .where(and(...conditions))
            .orderBy(desc(attendanceRecords.attendanceDate), desc(attendanceRecords.id))
            .limit(rowLimit)
        : await db
            .select()
            .from(attendanceRecords)
            .orderBy(desc(attendanceRecords.attendanceDate), desc(attendanceRecords.id))
            .limit(rowLimit);

    return rows.map(mapAttendanceRow);
  } catch (error) {
    console.error('Failed to list attendance records:', error);
    throw new Error('Unable to load attendance logs.', { cause: error });
  }
}

export async function listAttendanceSummaryForMonth(
  monthPrefix: string,
  personType?: AttendancePersonType
): Promise<{ attendanceDate: string; personType: string; status: string }[]> {
  try {
    const conditions = [like(attendanceRecords.attendanceDate, `${monthPrefix}-%`)];
    if (personType) {
      conditions.push(eq(attendanceRecords.personType, personType));
    }

    return await db
      .select({
        attendanceDate: attendanceRecords.attendanceDate,
        personType: attendanceRecords.personType,
        status: attendanceRecords.status,
      })
      .from(attendanceRecords)
      .where(and(...conditions))
      .orderBy(asc(attendanceRecords.attendanceDate));
  } catch (error) {
    console.error('Failed to aggregate monthly attendance records:', error);
    throw new Error('Unable to load monthly attendance trends.', { cause: error });
  }
}

export async function upsertAttendanceRecord(params: {
  attendanceDate: string;
  dayOfWeek: string;
  periodNumber: number;
  timetableSlotId: number | null;
  subjectCode: string;
  subjectName: string;
  department: string;
  yearOfStudy: string;
  section: string;
  roomNo: string;
  personType: AttendancePersonType;
  personIdentifier: string;
  personName: string;
  markedByUserId: number;
  markedByName: string;
  status: 'present' | 'late' | 'rejected' | 'od' | 'absent';
  faceImageData: string;
  environmentImageData: string;
  faceDetected: boolean;
  faceConfidence: number;
  environmentVerified: boolean;
  environmentLabel: string;
  verificationSummary: string;
  serverTimestamp: string;
}): Promise<AttendanceRecordItem> {
  try {
    const cleanId = params.personIdentifier.trim().toUpperCase();
    const [saved] = await db
      .insert(attendanceRecords)
      .values({
        ...params,
        personIdentifier: cleanId,
      })
      .onConflictDoUpdate({
        target: [
          attendanceRecords.attendanceDate,
          attendanceRecords.periodNumber,
          attendanceRecords.personType,
          attendanceRecords.personIdentifier,
        ],
        set: {
          timetableSlotId: params.timetableSlotId,
          subjectCode: params.subjectCode,
          subjectName: params.subjectName,
          roomNo: params.roomNo,
          markedByUserId: params.markedByUserId,
          markedByName: params.markedByName,
          status: params.status,
          faceImageData: params.faceImageData,
          environmentImageData: params.environmentImageData,
          faceDetected: params.faceDetected,
          faceConfidence: params.faceConfidence,
          environmentVerified: params.environmentVerified,
          environmentLabel: params.environmentLabel,
          verificationSummary: params.verificationSummary,
          serverTimestamp: params.serverTimestamp,
        },
      })
      .returning();

    return mapAttendanceRow(saved);
  } catch (error) {
    console.error('Failed to save attendance record:', error);
    throw new Error('Unable to record attendance.', { cause: error });
  }
}

// ============================================================
// HOD Registrations & Email Intimations
// ============================================================
export async function listRegistrations(): Promise<UserProfile[]> {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(ne(users.role, 'hod'))
      .orderBy(desc(users.createdAt));

    const enriched = await enrichUsersWithMeta(rows);
    const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    return enriched.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  } catch (error) {
    console.error('Failed to list registrations:', error);
    throw new Error('Unable to load registrations.', { cause: error });
  }
}

export async function listEmailIntimations(): Promise<EmailIntimation[]> {
  try {
    const rows = await db
      .select()
      .from(emailIntimations)
      .orderBy(desc(emailIntimations.id))
      .limit(100);

    return rows.map((r) => ({
      id: r.id,
      recipientEmail: r.recipientEmail,
      recipientName: r.recipientName,
      role: r.role as UserRole,
      subject: r.subject,
      body: r.body,
      deliveryStatus: r.deliveryStatus as EmailIntimation['deliveryStatus'],
      deliveryDetail: r.deliveryDetail,
      triggeredByName: r.triggeredByName,
      createdAt: formatTs(r.createdAt),
    }));
  } catch (error) {
    console.error('Failed to list email intimations:', error);
    throw new Error('Unable to load email intimations.', { cause: error });
  }
}

// ============================================================
// HOD Pinned Classroom Location (Geofence) & Haversine Distance
// ============================================================
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export async function getPinnedLocationConfig(): Promise<PinnedLocationConfig> {
  try {
    await ensureBaselineData();
    const [label, latStr, lngStr, radiusStr, updatedBy, updatedAt] = await Promise.all([
      getSetting('pinned_location_label', ''),
      getSetting('pinned_location_lat', ''),
      getSetting('pinned_location_lng', ''),
      getSetting('pinned_location_radius_m', '200'),
      getSetting('pinned_location_updated_by', ''),
      getSetting('pinned_location_updated_at', ''),
    ]);

    const latitude = latStr !== '' && Number.isFinite(Number(latStr)) ? Number(latStr) : null;
    const longitude = lngStr !== '' && Number.isFinite(Number(lngStr)) ? Number(lngStr) : null;
    const radiusMeters = Math.max(
      25,
      Math.min(5000, Math.round(Number(radiusStr) || 200))
    );
    const hasValidNonZero =
      latitude !== null && longitude !== null && !(latitude === 0 && longitude === 0);

    return {
      configured: hasValidNonZero,
      label: label || 'Department Classroom Zone',
      latitude: hasValidNonZero ? latitude : null,
      longitude: hasValidNonZero ? longitude : null,
      radiusMeters,
      updatedBy,
      updatedAt,
    };
  } catch (error) {
    console.error('Failed to read pinned location config:', error);
    return {
      configured: false,
      label: 'Department Classroom Zone',
      latitude: null,
      longitude: null,
      radiusMeters: 200,
      updatedBy: '',
      updatedAt: '',
    };
  }
}

export async function savePinnedLocationConfig(params: {
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  updatedBy: string;
}): Promise<PinnedLocationConfig> {
  const radius = Math.max(25, Math.min(5000, Math.round(params.radiusMeters || 200)));
  const updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await Promise.all([
    setSetting('pinned_location_label', params.label.trim() || 'Department Classroom Zone'),
    setSetting('pinned_location_lat', String(params.latitude)),
    setSetting('pinned_location_lng', String(params.longitude)),
    setSetting('pinned_location_radius_m', String(radius)),
    setSetting('pinned_location_updated_by', params.updatedBy),
    setSetting('pinned_location_updated_at', updatedAt),
  ]);
  return getPinnedLocationConfig();
}

// ============================================================
// Student Registration Biometric & Environment Baselines
// ============================================================
export async function upsertStudentBiometricProfile(params: {
  rollNo: string;
  email: string;
  fullName: string;
  department: string;
  yearOfStudy: string;
  section: string;
  faceImageData: string;
  environmentImageData: string;
  capturedLatitude: string;
  capturedLongitude: string;
  distanceMeters: number | null;
  locationVerified: boolean;
  pinnedLocationLabel: string;
}): Promise<StudentBiometricProfileSummary> {
  const cleanRoll = params.rollNo.trim().toUpperCase();
  const [saved] = await db
    .insert(studentBiometricProfiles)
    .values({
      rollNo: cleanRoll,
      email: params.email.trim().toLowerCase(),
      fullName: params.fullName.trim(),
      department: params.department.trim(),
      yearOfStudy: params.yearOfStudy.trim(),
      section: params.section.trim().toUpperCase(),
      faceImageData: params.faceImageData,
      environmentImageData: params.environmentImageData,
      capturedLatitude: params.capturedLatitude,
      capturedLongitude: params.capturedLongitude,
      distanceMeters: params.distanceMeters,
      locationVerified: params.locationVerified,
      pinnedLocationLabel: params.pinnedLocationLabel,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [studentBiometricProfiles.rollNo],
      set: {
        email: params.email.trim().toLowerCase(),
        fullName: params.fullName.trim(),
        department: params.department.trim(),
        yearOfStudy: params.yearOfStudy.trim(),
        section: params.section.trim().toUpperCase(),
        faceImageData: params.faceImageData,
        environmentImageData: params.environmentImageData,
        capturedLatitude: params.capturedLatitude,
        capturedLongitude: params.capturedLongitude,
        distanceMeters: params.distanceMeters,
        locationVerified: params.locationVerified,
        pinnedLocationLabel: params.pinnedLocationLabel,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    rollNo: saved.rollNo,
    email: saved.email,
    fullName: saved.fullName,
    hasFaceBaseline: Boolean(saved.faceImageData),
    hasEnvironmentBaseline: Boolean(saved.environmentImageData),
    capturedLatitude: saved.capturedLatitude,
    capturedLongitude: saved.capturedLongitude,
    distanceMeters: saved.distanceMeters ?? null,
    locationVerified: saved.locationVerified,
    pinnedLocationLabel: saved.pinnedLocationLabel,
    updatedAt: formatTs(saved.updatedAt),
  };
}

export async function getStudentBiometricProfile(rollNo: string) {
  const cleanRoll = rollNo.trim().toUpperCase();
  if (!cleanRoll) return null;
  const rows = await db
    .select()
    .from(studentBiometricProfiles)
    .where(eq(studentBiometricProfiles.rollNo, cleanRoll))
    .limit(1);
  return rows[0] ?? null;
}

export async function listStudentBiometricSummaries(): Promise<StudentBiometricProfileSummary[]> {
  try {
    const rows = await db
      .select({
        rollNo: studentBiometricProfiles.rollNo,
        email: studentBiometricProfiles.email,
        fullName: studentBiometricProfiles.fullName,
        faceImageData: studentBiometricProfiles.faceImageData,
        environmentImageData: studentBiometricProfiles.environmentImageData,
        capturedLatitude: studentBiometricProfiles.capturedLatitude,
        capturedLongitude: studentBiometricProfiles.capturedLongitude,
        distanceMeters: studentBiometricProfiles.distanceMeters,
        locationVerified: studentBiometricProfiles.locationVerified,
        pinnedLocationLabel: studentBiometricProfiles.pinnedLocationLabel,
        updatedAt: studentBiometricProfiles.updatedAt,
      })
      .from(studentBiometricProfiles)
      .orderBy(desc(studentBiometricProfiles.updatedAt));

    return rows.map((r) => ({
      rollNo: r.rollNo,
      email: r.email,
      fullName: r.fullName,
      hasFaceBaseline: Boolean(r.faceImageData),
      hasEnvironmentBaseline: Boolean(r.environmentImageData),
      capturedLatitude: r.capturedLatitude,
      capturedLongitude: r.capturedLongitude,
      distanceMeters: r.distanceMeters ?? null,
      locationVerified: r.locationVerified,
      pinnedLocationLabel: r.pinnedLocationLabel,
      updatedAt: formatTs(r.updatedAt),
    }));
  } catch (error) {
    console.error('Failed to list student biometric summaries:', error);
    return [];
  }
}

// ============================================================
// Faculty Delay Alerts Queries
// ============================================================
function normalizeFacultyMatchKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function buildFacultyPhoneLookup(): Promise<Map<string, string>> {
  const [deptStaffRows, otherRows, userRows] = await Promise.all([
    db.select({ fullName: departmentStaff.fullName, phone: departmentStaff.phone }).from(departmentStaff),
    db.select({ fullName: otherDepartmentStaff.fullName, phone: otherDepartmentStaff.phone }).from(otherDepartmentStaff),
    db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.status, 'approved')),
  ]);
  const map = new Map<string, string>();
  for (const r of [...deptStaffRows, ...otherRows, ...userRows]) {
    if (r.phone) {
      map.set(normalizeFacultyMatchKey(r.fullName), r.phone);
    }
  }
  return map;
}

function mapFacultyDelayRow(
  r: typeof facultyDelayAlerts.$inferSelect,
  phoneLookup?: Map<string, string>
): FacultyDelayAlertItem {
  const facultyPhone = phoneLookup?.get(normalizeFacultyMatchKey(r.facultyName)) || '';
  return {
    id: r.id,
    department: r.department,
    yearOfStudy: r.yearOfStudy,
    section: r.section,
    dayOfWeek: r.dayOfWeek,
    periodNumber: r.periodNumber,
    timetableSlotId: r.timetableSlotId ?? null,
    subjectCode: r.subjectCode,
    subjectName: r.subjectName,
    roomNo: r.roomNo,
    facultyName: r.facultyName,
    reportedByUserId: r.reportedByUserId ?? null,
    reportedByName: r.reportedByName,
    reportedByRole: r.reportedByRole,
    delayMinutes: r.delayMinutes,
    note: r.note,
    status: r.status as 'active' | 'acknowledged' | 'resolved',
    acknowledgedByName: r.acknowledgedByName,
    acknowledgedAt: r.acknowledgedAt ? formatTs(r.acknowledgedAt) : null,
    createdAt: formatTs(r.createdAt),
    isAutoDetected: r.reportedByRole === 'system_auto',
    facultyPhone,
  };
}

export function isUserFacultyDelayRecipient(
  alert: Pick<FacultyDelayAlertItem, 'facultyName' | 'reportedByUserId' | 'yearOfStudy' | 'section'>,
  user: Pick<UserProfile, 'id' | 'role' | 'fullName' | 'yearOfStudy' | 'section'>
): boolean {
  if (user.role === 'hod' || user.role === 'class_advisor') {
    return true;
  }
  if (alert.reportedByUserId === user.id) {
    return true;
  }
  if (user.role === 'dept_staff' || user.role === 'other_dept_staff') {
    const normUser = normalizeFacultyMatchKey(user.fullName);
    const normFaculty = normalizeFacultyMatchKey(alert.facultyName);
    if (normUser && normFaculty && (normUser.includes(normFaculty) || normFaculty.includes(normUser))) {
      return true;
    }
  }
  if (user.role === 'class_rep' || user.role === 'student') {
    if (!alert.yearOfStudy || !user.yearOfStudy || alert.yearOfStudy === user.yearOfStudy) {
      return true;
    }
  }
  return false;
}

export async function createFacultyDelayAlert(params: {
  department: string;
  yearOfStudy: string;
  section: string;
  dayOfWeek: string;
  periodNumber: number;
  timetableSlotId: number | null;
  subjectCode: string;
  subjectName: string;
  roomNo: string;
  facultyName: string;
  user: UserProfile;
  delayMinutes: number;
  note: string;
}): Promise<FacultyDelayAlertItem> {
  const [created] = await db
    .insert(facultyDelayAlerts)
    .values({
      department: params.department.trim(),
      yearOfStudy: params.yearOfStudy.trim(),
      section: params.section.trim().toUpperCase(),
      dayOfWeek: params.dayOfWeek.trim(),
      periodNumber: params.periodNumber,
      timetableSlotId: params.timetableSlotId,
      subjectCode: params.subjectCode.trim().toUpperCase(),
      subjectName: params.subjectName.trim(),
      roomNo: params.roomNo.trim(),
      facultyName: params.facultyName.trim(),
      reportedByUserId: params.user.id,
      reportedByName: params.user.fullName,
      reportedByRole: params.user.role,
      delayMinutes: Math.max(1, Math.min(120, Math.round(params.delayMinutes || 10))),
      note: params.note.trim().slice(0, 300),
      status: 'active',
    })
    .returning();

  const phoneLookup = await buildFacultyPhoneLookup();
  return mapFacultyDelayRow(created, phoneLookup);
}

let autoDelayScanInFlight = false;

export async function runAutoFacultyDelayScan(): Promise<FacultyDelayAlertItem[]> {
  if (autoDelayScanInFlight) return [];
  autoDelayScanInFlight = true;
  try {
    await ensureBaselineData();
    const [tz, dept] = await Promise.all([
      getSetting('academic_timezone', 'Asia/Kolkata'),
      getSetting('department_name', 'Computer Science & Engineering'),
    ]);
    const serverTime = computeServerTimeStatus(tz, dept);
    if (!serverTime.isAcademicDay) return [];

    const nowMin = serverTime.minutesSinceMidnight;

    const [todaySlots, todayAttendance, activeOdLeave, approvedAlts, recentAlerts, phoneLookup] =
      await Promise.all([
        db
          .select()
          .from(timetableSlots)
          .where(eq(timetableSlots.dayOfWeek, serverTime.weekday)),
        db
          .select()
          .from(attendanceRecords)
          .where(eq(attendanceRecords.attendanceDate, serverTime.isoDate)),
        listActiveApprovedOdLeaveForDate(serverTime.isoDate),
        db
          .select()
          .from(facultyAlterations)
          .where(
            and(
              eq(facultyAlterations.status, 'approved'),
              eq(facultyAlterations.alterationDate, serverTime.isoDate)
            )
          ),
        db
          .select()
          .from(facultyDelayAlerts)
          .orderBy(desc(facultyDelayAlerts.id))
          .limit(120),
        buildFacultyPhoneLookup(),
      ]);

    const newlyCreated: FacultyDelayAlertItem[] = [];

    for (const slot of todaySlots) {
      const startMin = parseTimeToMinutes(slot.startTime);
      const endMin = parseTimeToMinutes(slot.endTime);
      if (startMin >= 24 * 60 || endMin <= startMin) continue;

      // Only trigger if class has started by >= 5 minutes and hasn't ended yet
      const elapsed = nowMin - startMin;
      if (elapsed < 5 || nowMin >= endMin) continue;

      const slotFacultyNorm = normalizeFacultyMatchKey(slot.facultyName);
      if (!slotFacultyNorm) continue;

      // 1. Check if faculty already marked attendance today for this period/slot
      const hasAttendance = todayAttendance.some((a) => {
        if (a.personType !== 'faculty') return false;
        if (a.status !== 'present' && a.status !== 'late' && a.status !== 'od') return false;
        const attNameNorm = normalizeFacultyMatchKey(a.personName);
        const matchesFaculty =
          attNameNorm === slotFacultyNorm ||
          attNameNorm.includes(slotFacultyNorm) ||
          slotFacultyNorm.includes(attNameNorm);
        return matchesFaculty && (a.timetableSlotId === slot.id || a.periodNumber === slot.periodNumber);
      });
      if (hasAttendance) continue;

      // 2. Check if faculty has approved OD/Leave today
      const onApprovedOdLeave = activeOdLeave.some((r) => {
        if (r.applicantCategory !== 'faculty') return false;
        const appNorm = normalizeFacultyMatchKey(r.applicantName);
        return (
          appNorm === slotFacultyNorm ||
          appNorm.includes(slotFacultyNorm) ||
          slotFacultyNorm.includes(appNorm)
        );
      });
      if (onApprovedOdLeave) continue;

      // 3. Check if HOD approved a Faculty Alteration/Substitute for this slot today
      const hasApprovedAlteration = approvedAlts.some(
        (alt) =>
          alt.timetableSlotId === slot.id ||
          (alt.dayOfWeek === slot.dayOfWeek &&
            alt.periodNumber === slot.periodNumber &&
            alt.yearOfStudy === slot.yearOfStudy &&
            alt.section.toUpperCase() === slot.section.toUpperCase())
      );
      if (hasApprovedAlteration) continue;

      // 4. Deduplicate against alerts already logged today in this academic timezone
      const alreadyAlerted = recentAlerts.some((al) => {
        const alDate = al.createdAt
          ? new Intl.DateTimeFormat('en-CA', {
              timeZone: serverTime.academicTimezone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            }).format(al.createdAt)
          : '';
        if (alDate !== serverTime.isoDate) return false;
        return (
          al.timetableSlotId === slot.id ||
          (al.periodNumber === slot.periodNumber &&
            al.yearOfStudy === slot.yearOfStudy &&
            al.section.toUpperCase() === slot.section.toUpperCase() &&
            normalizeFacultyMatchKey(al.facultyName) === slotFacultyNorm)
        );
      });
      if (alreadyAlerted) continue;

      const [inserted] = await db
        .insert(facultyDelayAlerts)
        .values({
          department: slot.department,
          yearOfStudy: slot.yearOfStudy,
          section: slot.section,
          dayOfWeek: slot.dayOfWeek,
          periodNumber: slot.periodNumber,
          timetableSlotId: slot.id,
          subjectCode: slot.subjectCode,
          subjectName: slot.subjectName,
          roomNo: slot.roomNo,
          facultyName: slot.facultyName,
          reportedByUserId: null,
          reportedByName: 'Auto Schedule Analyzer',
          reportedByRole: 'system_auto',
          delayMinutes: Math.max(5, Math.min(120, elapsed)),
          note: `Auto-detected ${elapsed}m delay after ${slot.startTime} (${slot.yearOfStudy} ${slot.section}) without faculty check-in or approved alteration.`,
          status: 'active',
        })
        .returning();

      const mapped = mapFacultyDelayRow(inserted, phoneLookup);
      newlyCreated.push(mapped);
    }

    return newlyCreated;
  } catch (error) {
    console.error('Auto faculty delay scan failed:', error);
    return [];
  } finally {
    autoDelayScanInFlight = false;
  }
}

export async function listFacultyDelayAlertsForUser(
  user: UserProfile
): Promise<FacultyDelayAlertItem[]> {
  try {
    const [rows, phoneLookup] = await Promise.all([
      db
        .select()
        .from(facultyDelayAlerts)
        .orderBy(desc(facultyDelayAlerts.id))
        .limit(60),
      buildFacultyPhoneLookup(),
    ]);

    return rows
      .map((r) => mapFacultyDelayRow(r, phoneLookup))
      .filter((alert) => isUserFacultyDelayRecipient(alert, user));
  } catch (error) {
    console.error('Failed to list faculty delay alerts:', error);
    return [];
  }
}

export async function updateFacultyDelayAlertStatus(params: {
  id: number;
  status: 'acknowledged' | 'resolved';
  acknowledgedByName: string;
}): Promise<FacultyDelayAlertItem | null> {
  const [updated] = await db
    .update(facultyDelayAlerts)
    .set({
      status: params.status,
      acknowledgedByName: params.acknowledgedByName,
      acknowledgedAt: new Date(),
    })
    .where(eq(facultyDelayAlerts.id, params.id))
    .returning();
  if (!updated) return null;
  const phoneLookup = await buildFacultyPhoneLookup();
  return mapFacultyDelayRow(updated, phoneLookup);
}

// ============================================================
// OD & Leave Permission Workflow + HOD Form Customization
// ============================================================
export function getDefaultOdLeaveFormConfig(): OdLeaveFormConfig {
  return {
    requireClassAdvisorForStudents: true,
    allowDocumentUpload: true,
    requireDocumentUploadForOd: true,
    requireDocumentUploadForLeave: false,
    allowPhotoUpload: true,
    requirePhotoUpload: false,
    maxOdDays: 10,
    maxLeaveDays: 15,
    declarationText:
      'I confirm that the details and supporting documents attached above are genuine and I will complete all missed academic work.',
    fields: [
      {
        id: 'parent_mobile',
        label: 'Parent / Guardian Contact Number',
        type: 'phone',
        required: true,
        enabled: true,
        appliesTo: 'student',
        placeholder: '+91 98765 43210',
        options: [],
      },
      {
        id: 'event_or_venue',
        label: 'Event / Institution / Venue (for OD)',
        type: 'text',
        required: false,
        enabled: true,
        appliesTo: 'all',
        placeholder: 'e.g. Anna University Symposium / Hackathon / Medical Clinic',
        options: [],
      },
      {
        id: 'leave_category',
        label: 'Category',
        type: 'select',
        required: true,
        enabled: true,
        appliesTo: 'all',
        placeholder: 'Select category',
        options: [
          'Medical / Health',
          'Technical Symposium / Hackathon',
          'Sports / Cultural Event',
          'Industrial Visit / Placement',
          'Personal / Family Function',
          'Official Academic Duty',
        ],
      },
      {
        id: 'alternate_arrangement',
        label: 'Alternate Class Arrangement (Faculty)',
        type: 'text',
        required: true,
        enabled: true,
        appliesTo: 'faculty',
        placeholder: 'Faculty name handling scheduled periods',
        options: [],
      },
    ],
    updatedBy: 'Department Default',
    updatedAt: '',
  };
}

export async function getOdLeaveFormConfig(): Promise<OdLeaveFormConfig> {
  const defaults = getDefaultOdLeaveFormConfig();
  try {
    const raw = await getSetting('od_leave_form_config', '');
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<OdLeaveFormConfig>;
    return {
      requireClassAdvisorForStudents:
        typeof parsed.requireClassAdvisorForStudents === 'boolean'
          ? parsed.requireClassAdvisorForStudents
          : defaults.requireClassAdvisorForStudents,
      allowDocumentUpload:
        typeof parsed.allowDocumentUpload === 'boolean'
          ? parsed.allowDocumentUpload
          : defaults.allowDocumentUpload,
      requireDocumentUploadForOd:
        typeof parsed.requireDocumentUploadForOd === 'boolean'
          ? parsed.requireDocumentUploadForOd
          : defaults.requireDocumentUploadForOd,
      requireDocumentUploadForLeave:
        typeof parsed.requireDocumentUploadForLeave === 'boolean'
          ? parsed.requireDocumentUploadForLeave
          : defaults.requireDocumentUploadForLeave,
      allowPhotoUpload:
        typeof parsed.allowPhotoUpload === 'boolean'
          ? parsed.allowPhotoUpload
          : defaults.allowPhotoUpload,
      requirePhotoUpload:
        typeof parsed.requirePhotoUpload === 'boolean'
          ? parsed.requirePhotoUpload
          : defaults.requirePhotoUpload,
      maxOdDays: Math.max(1, Math.min(60, Number(parsed.maxOdDays) || defaults.maxOdDays)),
      maxLeaveDays: Math.max(1, Math.min(60, Number(parsed.maxLeaveDays) || defaults.maxLeaveDays)),
      declarationText:
        typeof parsed.declarationText === 'string' && parsed.declarationText.trim()
          ? parsed.declarationText.trim().slice(0, 400)
          : defaults.declarationText,
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.slice(0, 25).map((f: Partial<OdLeaveFormFieldConfig>, idx: number) => ({
            id: String(f.id || `custom_${idx + 1}`)
              .toLowerCase()
              .replace(/[^a-z0-9_]/g, '_')
              .slice(0, 40),
            label: String(f.label || `Field ${idx + 1}`).trim().slice(0, 80),
            type: (['text', 'textarea', 'number', 'phone', 'date', 'select'].includes(String(f.type))
              ? f.type
              : 'text') as OdLeaveFormFieldConfig['type'],
            required: Boolean(f.required),
            enabled: f.enabled !== false,
            appliesTo: (['all', 'student', 'faculty'].includes(String(f.appliesTo))
              ? f.appliesTo
              : 'all') as OdLeaveFormFieldConfig['appliesTo'],
            placeholder: String(f.placeholder || '').trim().slice(0, 120),
            options: Array.isArray(f.options)
              ? f.options
                  .map((o) => String(o).trim())
                  .filter(Boolean)
                  .slice(0, 20)
              : [],
          }))
        : defaults.fields,
      updatedBy: String(parsed.updatedBy || defaults.updatedBy),
      updatedAt: String(parsed.updatedAt || ''),
    };
  } catch (error) {
    console.error('Failed to parse OD/Leave form config:', error);
    return defaults;
  }
}

export async function saveOdLeaveFormConfig(
  config: Omit<OdLeaveFormConfig, 'updatedBy' | 'updatedAt'>,
  updatedBy: string
): Promise<OdLeaveFormConfig> {
  const sanitized: OdLeaveFormConfig = {
    requireClassAdvisorForStudents: Boolean(config.requireClassAdvisorForStudents),
    allowDocumentUpload: Boolean(config.allowDocumentUpload),
    requireDocumentUploadForOd: Boolean(config.requireDocumentUploadForOd),
    requireDocumentUploadForLeave: Boolean(config.requireDocumentUploadForLeave),
    allowPhotoUpload: Boolean(config.allowPhotoUpload),
    requirePhotoUpload: Boolean(config.requirePhotoUpload),
    maxOdDays: Math.max(1, Math.min(60, Math.round(Number(config.maxOdDays) || 10))),
    maxLeaveDays: Math.max(1, Math.min(60, Math.round(Number(config.maxLeaveDays) || 15))),
    declarationText: String(config.declarationText || '').trim().slice(0, 400),
    fields: (Array.isArray(config.fields) ? config.fields : [])
      .slice(0, 25)
      .map((f, idx) => ({
        id:
          String(f.id || `field_${idx + 1}`)
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .slice(0, 40) || `field_${idx + 1}`,
        label: String(f.label || `Field ${idx + 1}`).trim().slice(0, 80),
        type: (['text', 'textarea', 'number', 'phone', 'date', 'select'].includes(f.type)
          ? f.type
          : 'text') as OdLeaveFormFieldConfig['type'],
        required: Boolean(f.required),
        enabled: f.enabled !== false,
        appliesTo: (['all', 'student', 'faculty'].includes(f.appliesTo)
          ? f.appliesTo
          : 'all') as OdLeaveFormFieldConfig['appliesTo'],
        placeholder: String(f.placeholder || '').trim().slice(0, 120),
        options: Array.isArray(f.options)
          ? f.options
              .map((o) => String(o).trim())
              .filter(Boolean)
              .slice(0, 20)
          : [],
      }))
      .filter((f) => f.label.length > 0),
    updatedBy,
    updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };

  await setSetting('od_leave_form_config', JSON.stringify(sanitized));
  return getOdLeaveFormConfig();
}

function mapOdLeaveRow(r: typeof odLeaveRequests.$inferSelect): OdLeaveRequestItem {
  let customFields: Record<string, string> = {};
  try {
    const parsed = JSON.parse(r.customFieldsJson || '{}');
    if (parsed && typeof parsed === 'object') {
      customFields = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')])
      );
    }
  } catch {
    customFields = {};
  }

  return {
    id: r.id,
    requestType: r.requestType as OdLeaveRequestType,
    applicantCategory: r.applicantCategory as OdLeaveApplicantCategory,
    applicantUserId: r.applicantUserId ?? null,
    applicantName: r.applicantName,
    applicantRole: r.applicantRole,
    rollOrEmployeeId: r.rollOrEmployeeId,
    mobileNumber: r.mobileNumber,
    department: r.department,
    yearOfStudy: r.yearOfStudy,
    section: r.section,
    fromDate: r.fromDate,
    toDate: r.toDate,
    totalDays: r.totalDays,
    reason: r.reason,
    customFields,
    documentFileKey: r.documentFileKey,
    documentFileName: r.documentFileName,
    documentMimeType: r.documentMimeType,
    photoFileKey: r.photoFileKey,
    photoFileName: r.photoFileName,
    photoMimeType: r.photoMimeType,
    status: r.status as OdLeaveWorkflowStatus,
    advisorStatus: r.advisorStatus as OdLeaveRequestItem['advisorStatus'],
    advisorReviewedBy: r.advisorReviewedBy,
    advisorRemarks: r.advisorRemarks,
    advisorReviewedAt: r.advisorReviewedAt ? formatTs(r.advisorReviewedAt) : null,
    hodStatus: r.hodStatus as OdLeaveRequestItem['hodStatus'],
    hodReviewedBy: r.hodReviewedBy,
    hodRemarks: r.hodRemarks,
    hodReviewedAt: r.hodReviewedAt ? formatTs(r.hodReviewedAt) : null,
    attendanceMarkedStatus: (r.attendanceMarkedStatus || '') as '' | 'od' | 'absent',
    attendanceDaysMarked: r.attendanceDaysMarked ?? 0,
    createdAt: formatTs(r.createdAt),
    updatedAt: formatTs(r.updatedAt),
  };
}

export function enumerateDateRangeInclusive(fromDate: string, toDate: string): string[] {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const dates: string[] = [];
  const cursor = new Date(start.getTime());
  let guard = 0;
  while (cursor <= end && guard < 62) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return dates;
}

const WEEKDAY_NAMES_UTC = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export async function createOdLeaveRequest(params: {
  requestType: OdLeaveRequestType;
  applicantCategory: OdLeaveApplicantCategory;
  user: UserProfile;
  applicantName: string;
  rollOrEmployeeId: string;
  mobileNumber: string;
  department: string;
  yearOfStudy: string;
  section: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  customFields: Record<string, string>;
  documentFileKey: string;
  documentFileName: string;
  documentMimeType: string;
  photoFileKey: string;
  photoFileName: string;
  photoMimeType: string;
  requireClassAdvisor: boolean;
}): Promise<OdLeaveRequestItem> {
  const needsAdvisor =
    params.applicantCategory === 'student' && params.requireClassAdvisor;
  const initialStatus: OdLeaveWorkflowStatus = needsAdvisor
    ? 'pending_advisor'
    : 'pending_hod';

  const [created] = await db
    .insert(odLeaveRequests)
    .values({
      requestType: params.requestType,
      applicantCategory: params.applicantCategory,
      applicantUserId: params.user.id,
      applicantName: params.applicantName.trim(),
      applicantRole: params.user.role,
      rollOrEmployeeId: params.rollOrEmployeeId.trim().toUpperCase(),
      mobileNumber: params.mobileNumber.trim(),
      department: params.department.trim(),
      yearOfStudy: params.yearOfStudy.trim(),
      section: params.section.trim().toUpperCase(),
      fromDate: params.fromDate,
      toDate: params.toDate,
      totalDays: params.totalDays,
      reason: params.reason.trim(),
      customFieldsJson: JSON.stringify(params.customFields || {}),
      documentFileKey: params.documentFileKey,
      documentFileName: params.documentFileName,
      documentMimeType: params.documentMimeType,
      photoFileKey: params.photoFileKey,
      photoFileName: params.photoFileName,
      photoMimeType: params.photoMimeType,
      status: initialStatus,
      advisorStatus: needsAdvisor ? 'pending' : 'not_required',
      hodStatus: 'pending',
    })
    .returning();

  return mapOdLeaveRow(created);
}

export async function getOdLeaveRequestById(id: number): Promise<OdLeaveRequestItem | null> {
  const rows = await db
    .select()
    .from(odLeaveRequests)
    .where(eq(odLeaveRequests.id, id))
    .limit(1);
  return rows[0] ? mapOdLeaveRow(rows[0]) : null;
}

export async function listOdLeaveRequestsForUser(
  user: UserProfile
): Promise<OdLeaveRequestItem[]> {
  try {
    const rows = await db
      .select()
      .from(odLeaveRequests)
      .orderBy(desc(odLeaveRequests.id))
      .limit(200);

    const mapped = rows.map(mapOdLeaveRow);
    if (user.role === 'hod') {
      return mapped;
    }
    if (user.role === 'class_advisor') {
      // Class advisors see all student requests (for review) plus their own faculty requests
      return mapped.filter(
        (r) => r.applicantCategory === 'student' || r.applicantUserId === user.id
      );
    }
    // Students, Class Reps, and regular Faculty see their own submitted requests
    return mapped.filter(
      (r) =>
        r.applicantUserId === user.id ||
        (user.staffOrRollId &&
          r.rollOrEmployeeId.toUpperCase() === user.staffOrRollId.trim().toUpperCase())
    );
  } catch (error) {
    console.error('Failed to list OD/Leave requests:', error);
    return [];
  }
}

export async function listActiveApprovedOdLeaveForDate(
  isoDate: string
): Promise<OdLeaveRequestItem[]> {
  try {
    const rows = await db
      .select()
      .from(odLeaveRequests)
      .where(eq(odLeaveRequests.status, 'approved'))
      .orderBy(desc(odLeaveRequests.id))
      .limit(200);
    return rows
      .map(mapOdLeaveRow)
      .filter((r) => r.fromDate <= isoDate && r.toDate >= isoDate);
  } catch (error) {
    console.error('Failed to list active OD/Leave for date:', error);
    return [];
  }
}

export async function decideOdLeaveRequest(params: {
  request: OdLeaveRequestItem;
  reviewer: UserProfile;
  decision: 'approve' | 'reject';
  remarks: string;
  serverTimestamp: string;
}): Promise<OdLeaveRequestItem> {
  const { request, reviewer, decision, remarks, serverTimestamp } = params;
  const now = new Date();
  const cleanRemarks = remarks.trim().slice(0, 300);

  // Stage 1: Class Advisor reviews Student Request
  if (reviewer.role === 'class_advisor') {
    if (decision === 'reject') {
      const [updated] = await db
        .update(odLeaveRequests)
        .set({
          status: 'rejected',
          advisorStatus: 'rejected',
          advisorReviewedBy: reviewer.fullName,
          advisorRemarks: cleanRemarks,
          advisorReviewedAt: now,
          updatedAt: now,
        })
        .where(eq(odLeaveRequests.id, request.id))
        .returning();
      return mapOdLeaveRow(updated);
    }

    const [updated] = await db
      .update(odLeaveRequests)
      .set({
        status: 'pending_hod',
        advisorStatus: 'approved',
        advisorReviewedBy: reviewer.fullName,
        advisorRemarks: cleanRemarks,
        advisorReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(odLeaveRequests.id, request.id))
      .returning();
    return mapOdLeaveRow(updated);
  }

  // Stage 2 (or Direct Faculty Approval): HOD final decision
  if (decision === 'reject') {
    const [updated] = await db
      .update(odLeaveRequests)
      .set({
        status: 'rejected',
        hodStatus: 'rejected',
        hodReviewedBy: reviewer.fullName,
        hodRemarks: cleanRemarks,
        hodReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(odLeaveRequests.id, request.id))
      .returning();
    return mapOdLeaveRow(updated);
  }

  // HOD APPROVED: Automatically mark attendance as 'od' (for OD) or 'absent' (for Leave)
  // across every day from fromDate through toDate (inclusive)!
  const dates = enumerateDateRangeInclusive(request.fromDate, request.toDate);
  const attendanceStatus: 'od' | 'absent' = request.requestType === 'od' ? 'od' : 'absent';
  const personType: AttendancePersonType =
    request.applicantCategory === 'student' ? 'student' : 'faculty';
  const subjectCode = request.requestType === 'od' ? 'OD-PERMIT' : 'LEAVE-ABS';
  const subjectName =
    request.requestType === 'od'
      ? `Approved On-Duty (${request.fromDate} to ${request.toDate})`
      : `Approved Leave — Marked Absent (${request.fromDate} to ${request.toDate})`;

  let daysMarked = 0;
  for (const isoDate of dates) {
    const d = new Date(`${isoDate}T00:00:00Z`);
    const dayOfWeek = WEEKDAY_NAMES_UTC[d.getUTCDay()] || 'Monday';
    await upsertAttendanceRecord({
      attendanceDate: isoDate,
      dayOfWeek,
      periodNumber: 1,
      timetableSlotId: null,
      subjectCode,
      subjectName,
      department: request.department,
      yearOfStudy: request.yearOfStudy,
      section: request.section,
      roomNo: request.requestType === 'od' ? 'On-Duty' : 'On Leave',
      personType,
      personIdentifier: request.rollOrEmployeeId,
      personName: request.applicantName,
      markedByUserId: reviewer.id,
      markedByName: `${reviewer.fullName} (HOD Permission)`,
      status: attendanceStatus,
      faceImageData: '',
      environmentImageData: '',
      faceDetected: false,
      faceConfidence: 0,
      environmentVerified: false,
      environmentLabel:
        request.requestType === 'od' ? 'Approved OD Permission' : 'Approved Leave (Absent)',
      verificationSummary:
        request.requestType === 'od'
          ? `OD granted by HOD (${reviewer.fullName}) from ${request.fromDate} to ${request.toDate}. Reason: ${request.reason.slice(0, 120)}`
          : `Leave granted by HOD (${reviewer.fullName}) from ${request.fromDate} to ${request.toDate} — marked Absent. Reason: ${request.reason.slice(0, 120)}`,
      serverTimestamp,
    });
    daysMarked += 1;
  }

  const [updated] = await db
    .update(odLeaveRequests)
    .set({
      status: 'approved',
      advisorStatus:
        request.advisorStatus === 'pending' ? 'approved' : request.advisorStatus,
      advisorReviewedBy:
        request.advisorStatus === 'pending'
          ? `${reviewer.fullName} (HOD Direct)`
          : request.advisorReviewedBy,
      advisorReviewedAt:
        request.advisorStatus === 'pending' ? now : request.advisorReviewedAt ? new Date(request.advisorReviewedAt) : null,
      hodStatus: 'approved',
      hodReviewedBy: reviewer.fullName,
      hodRemarks: cleanRemarks,
      hodReviewedAt: now,
      attendanceMarkedStatus: attendanceStatus,
      attendanceDaysMarked: daysMarked,
      updatedAt: now,
    })
    .where(eq(odLeaveRequests.id, request.id))
    .returning();

  return mapOdLeaveRow(updated);
}

// ============================================================
// Departmental Performance Analytics (Avg Attendance vs Academic Engagement by Batch)
// ============================================================
function getBatchSortOrder(yearLabel: string): number {
  const norm = yearLabel.trim().toLowerCase();
  if (/^(i\b|1st|first|year\s*1|1\b)/.test(norm)) return 1;
  if (/^(ii\b|2nd|second|year\s*2|2\b)/.test(norm)) return 2;
  if (/^(iii\b|3rd|third|year\s*3|3\b)/.test(norm)) return 3;
  if (/^(iv\b|4th|fourth|year\s*4|4\b)/.test(norm)) return 4;
  if (/^(v\b|5th|fifth|year\s*5|5\b)/.test(norm)) return 5;
  const numMatch = norm.match(/\d+/);
  if (numMatch) return Number(numMatch[0]);
  return 99;
}

function normalizeCgpaToScore(raw: string): { cgpa: number; score: number } | null {
  const cleaned = raw.trim().replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const val = Number(cleaned);
  if (!Number.isFinite(val) || val <= 0) return null;
  if (val <= 4.0) {
    return { cgpa: Number(val.toFixed(2)), score: Math.min(100, Math.round((val / 4.0) * 100)) };
  }
  if (val <= 10.0) {
    return { cgpa: Number(val.toFixed(2)), score: Math.min(100, Math.round(val * 10)) };
  }
  if (val <= 100) {
    return { cgpa: Number((val / 10).toFixed(2)), score: Math.min(100, Math.round(val)) };
  }
  return null;
}

export async function getDepartmentalPerformanceSummary(
  groupBy: 'year' | 'section' = 'year'
): Promise<DepartmentalPerformancePayload> {
  const [
    departmentName,
    studentRows,
    studentAttendanceRows,
    approvedStudentUsers,
    boostedMessageRows,
    ackRows,
    chatRows,
    biometricRows,
  ] = await Promise.all([
    getSetting('department_name', 'Computer Science & Engineering'),
    db.select().from(departmentStudents),
    db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.personType, 'student')),
    db
      .select()
      .from(users)
      .where(
        and(
          eq(users.status, 'approved'),
          or(eq(users.role, 'student'), eq(users.role, 'class_rep'))
        )
      ),
    db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        or(
          eq(chatMessages.powerBoostEnabled, true),
          gt(chatMessages.powerBoostIntervalMinutes, 0)
        )
      ),
    db.select().from(messageAcknowledgements),
    db
      .select({
        senderUserId: chatMessages.senderUserId,
        senderRole: chatMessages.senderRole,
      })
      .from(chatMessages),
    db
      .select({
        rollNo: studentBiometricProfiles.rollNo,
        yearOfStudy: studentBiometricProfiles.yearOfStudy,
        section: studentBiometricProfiles.section,
      })
      .from(studentBiometricProfiles),
  ]);

  const makeKey = (year: string, sec: string) => {
    const cleanYear = year.trim() || 'Unassigned';
    const cleanSec = sec.trim().toUpperCase() || 'A';
    return groupBy === 'section' ? `${cleanYear}__${cleanSec}` : cleanYear;
  };

  interface BatchAccumulator {
    batchKey: string;
    batchLabel: string;
    yearOfStudy: string;
    section: string;
    studentRollNos: Set<string>;
    studentEmails: Set<string>;
    studentCount: number;
    cgpaValues: number[];
    cgpaScores: number[];
    classRepCount: number;
    attendancePresentCount: number;
    attendanceOdCount: number;
    attendanceTotalLogs: number;
    userIds: Set<number>;
    biometricCount: number;
    chatMessagesCount: number;
    boostAckPairs: Set<string>;
  }

  const batchMap = new Map<string, BatchAccumulator>();

  const ensureBatch = (year: string, sec: string): BatchAccumulator => {
    const cleanYear = year.trim() || 'Unassigned';
    const cleanSec = sec.trim().toUpperCase() || 'A';
    const key = makeKey(cleanYear, cleanSec);
    let entry = batchMap.get(key);
    if (!entry) {
      entry = {
        batchKey: key,
        batchLabel: groupBy === 'section' ? `${cleanYear} · Sec ${cleanSec}` : cleanYear,
        yearOfStudy: cleanYear,
        section: groupBy === 'section' ? cleanSec : 'All',
        studentRollNos: new Set<string>(),
        studentEmails: new Set<string>(),
        studentCount: 0,
        cgpaValues: [],
        cgpaScores: [],
        classRepCount: 0,
        attendancePresentCount: 0,
        attendanceOdCount: 0,
        attendanceTotalLogs: 0,
        userIds: new Set<number>(),
        biometricCount: 0,
        chatMessagesCount: 0,
        boostAckPairs: new Set<string>(),
      };
      batchMap.set(key, entry);
    }
    return entry;
  };

  const rollToBatchKey = new Map<string, string>();
  const emailToBatchKey = new Map<string, string>();

  for (const s of studentRows) {
    const acc = ensureBatch(s.yearOfStudy, s.section);
    acc.studentCount += 1;
    if (s.isClassRep) acc.classRepCount += 1;
    const normRoll = s.rollNo.trim().toUpperCase();
    if (normRoll) {
      acc.studentRollNos.add(normRoll);
      rollToBatchKey.set(normRoll, acc.batchKey);
    }
    const normEmail = s.email.trim().toLowerCase();
    if (normEmail) {
      acc.studentEmails.add(normEmail);
      emailToBatchKey.set(normEmail, acc.batchKey);
    }
    const parsedCgpa = normalizeCgpaToScore(s.cgpa);
    if (parsedCgpa) {
      acc.cgpaValues.push(parsedCgpa.cgpa);
      acc.cgpaScores.push(parsedCgpa.score);
    }
  }

  // Map approved student accounts to batches
  const userIdToBatchKey = new Map<number, string>();
  for (const u of approvedStudentUsers) {
    const normRoll = u.staffOrRollId.trim().toUpperCase();
    const normEmail = u.email.trim().toLowerCase();
    let targetKey =
      (normRoll ? rollToBatchKey.get(normRoll) : undefined) ??
      (normEmail ? emailToBatchKey.get(normEmail) : undefined);

    if (!targetKey && u.yearOfStudy.trim()) {
      const acc = ensureBatch(u.yearOfStudy, u.section);
      targetKey = acc.batchKey;
      if (acc.studentCount === 0) {
        acc.studentCount = 1;
      }
    }

    if (targetKey) {
      userIdToBatchKey.set(u.id, targetKey);
      batchMap.get(targetKey)?.userIds.add(u.id);
    }
  }

  // Biometric enrollments per batch
  const countedBioRolls = new Set<string>();
  for (const b of biometricRows) {
    const normRoll = b.rollNo.trim().toUpperCase();
    if (!normRoll || countedBioRolls.has(normRoll)) continue;
    countedBioRolls.add(normRoll);
    const key =
      rollToBatchKey.get(normRoll) ??
      (b.yearOfStudy.trim() ? makeKey(b.yearOfStudy, b.section) : undefined);
    if (key && batchMap.has(key)) {
      batchMap.get(key)!.biometricCount += 1;
    }
  }

  // Attendance logs per batch
  for (const rec of studentAttendanceRows) {
    const normRoll = rec.personIdentifier.trim().toUpperCase();
    let key = rollToBatchKey.get(normRoll);
    if (!key && rec.yearOfStudy.trim()) {
      const fallbackKey = makeKey(rec.yearOfStudy, rec.section);
      if (batchMap.has(fallbackKey)) {
        key = fallbackKey;
      }
    }
    if (!key) continue;
    const acc = batchMap.get(key);
    if (!acc) continue;

    acc.attendanceTotalLogs += 1;
    if (rec.status === 'present' || rec.status === 'late') {
      acc.attendancePresentCount += 1;
    } else if (rec.status === 'od') {
      acc.attendanceOdCount += 1;
    }
  }

  // Community chat activity by student users per batch
  for (const msg of chatRows) {
    if (!msg.senderUserId) continue;
    const key = userIdToBatchKey.get(msg.senderUserId);
    if (key && batchMap.has(key)) {
      batchMap.get(key)!.chatMessagesCount += 1;
    }
  }

  // Power Boost acknowledgements per batch
  const boostedIdSet = new Set(boostedMessageRows.map((m) => m.id));
  const totalBoostedMessages = boostedIdSet.size;
  for (const ack of ackRows) {
    if (!boostedIdSet.has(ack.messageId)) continue;
    const key = userIdToBatchKey.get(ack.userId);
    if (key && batchMap.has(key)) {
      batchMap.get(key)!.boostAckPairs.add(`${ack.messageId}:${ack.userId}`);
    }
  }

  const sortedAccumulators = Array.from(batchMap.values()).sort((a, b) => {
    const yDiff = getBatchSortOrder(a.yearOfStudy) - getBatchSortOrder(b.yearOfStudy);
    if (yDiff !== 0) return yDiff;
    const yStr = a.yearOfStudy.localeCompare(b.yearOfStudy);
    if (yStr !== 0) return yStr;
    return a.section.localeCompare(b.section);
  });

  const batches: BatchPerformancePoint[] = sortedAccumulators.map((acc) => {
    const denom = Math.max(1, acc.studentCount);
    const hasAttendanceData = acc.attendanceTotalLogs > 0;
    const creditedAttendance = acc.attendancePresentCount + acc.attendanceOdCount;
    const averageAttendanceRate = hasAttendanceData
      ? Math.round((creditedAttendance / acc.attendanceTotalLogs) * 1000) / 10
      : 0;

    const averageCgpa =
      acc.cgpaValues.length > 0
        ? Math.round(
            (acc.cgpaValues.reduce((sum, v) => sum + v, 0) / acc.cgpaValues.length) * 100
          ) / 100
        : null;

    const cgpaScore =
      acc.cgpaScores.length > 0
        ? Math.round(
            (acc.cgpaScores.reduce((sum, v) => sum + v, 0) / acc.cgpaScores.length) * 10
          ) / 10
        : null;

    const activeRegisteredCount = acc.userIds.size;
    const portalRegRatio = Math.min(1, activeRegisteredCount / denom);
    const bioRatio = Math.min(1, acc.biometricCount / denom);
    const chatActivityRatio = Math.min(1, acc.chatMessagesCount / Math.max(2, denom * 1.5));
    const crLeadershipBonus = acc.classRepCount > 0 ? 0.15 : 0;
    const portalParticipationRate = Math.min(
      100,
      Math.round(
        (portalRegRatio * 0.45 + bioRatio * 0.25 + chatActivityRatio * 0.3 + crLeadershipBonus) *
          100
      )
    );

    let powerBoostResponseRate: number | null = null;
    if (totalBoostedMessages > 0) {
      const targetAudience = Math.max(activeRegisteredCount, acc.studentCount);
      const possibleAcks = totalBoostedMessages * Math.max(1, targetAudience);
      powerBoostResponseRate = Math.min(
        100,
        Math.round((acc.boostAckPairs.size / possibleAcks) * 100)
      );
    }

    // Weighted Academic Engagement Score (0..100) normalized over active signals
    let weightedSum = 0;
    let totalWeight = 0;
    if (cgpaScore !== null) {
      weightedSum += cgpaScore * 0.55;
      totalWeight += 0.55;
    }
    if (powerBoostResponseRate !== null) {
      weightedSum += powerBoostResponseRate * 0.2;
      totalWeight += 0.2;
    }
    weightedSum += portalParticipationRate * 0.25;
    totalWeight += 0.25;

    const academicEngagementScore =
      totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;

    let standing: BatchPerformancePoint['standing'];
    if (!hasAttendanceData) {
      standing = 'Pending Attendance';
    } else if (averageAttendanceRate >= 80 && academicEngagementScore >= 75) {
      standing = 'High Performing';
    } else if (averageAttendanceRate < 75) {
      standing = 'Attendance Watch';
    } else if (academicEngagementScore < 65) {
      standing = 'Engagement Watch';
    } else {
      standing = 'On Track';
    }

    return {
      batchKey: acc.batchKey,
      batchLabel: acc.batchLabel,
      yearOfStudy: acc.yearOfStudy,
      section: acc.section,
      studentCount: acc.studentCount,
      averageAttendanceRate,
      academicEngagementScore,
      hasAttendanceData,
      attendancePresentCount: acc.attendancePresentCount,
      attendanceOdCount: acc.attendanceOdCount,
      attendanceTotalLogs: acc.attendanceTotalLogs,
      averageCgpa,
      cgpaScore,
      powerBoostResponseRate,
      portalParticipationRate,
      chatMessagesCount: acc.chatMessagesCount,
      activeRegisteredCount,
      standing,
    };
  });

  const totalStudents = batches.reduce((acc, b) => acc + b.studentCount, 0);
  const batchesWithAttendance = batches.filter((b) => b.hasAttendanceData);
  const departmentAverageAttendance =
    batchesWithAttendance.length > 0
      ? Math.round(
          (batchesWithAttendance.reduce((sum, b) => sum + b.averageAttendanceRate, 0) /
            batchesWithAttendance.length) *
            10
        ) / 10
      : 0;

  const departmentAverageEngagement =
    batches.length > 0
      ? Math.round(
          (batches.reduce((sum, b) => sum + b.academicEngagementScore, 0) / batches.length) * 10
        ) / 10
      : 0;

  const ranked = [...batches].sort((a, b) => {
    const scoreA = a.hasAttendanceData
      ? a.averageAttendanceRate * 0.5 + a.academicEngagementScore * 0.5
      : a.academicEngagementScore * 0.5;
    const scoreB = b.hasAttendanceData
      ? b.averageAttendanceRate * 0.5 + b.academicEngagementScore * 0.5
      : b.academicEngagementScore * 0.5;
    return scoreB - scoreA;
  });

  return {
    departmentName,
    groupBy,
    totalStudents,
    totalBatches: batches.length,
    departmentAverageAttendance,
    departmentAverageEngagement,
    batchesWithAttendanceData: batchesWithAttendance.length,
    topPerformingBatch: ranked[0]?.batchLabel ?? null,
    batches,
  };
}

// ============================================================
// User Profile Settings: Transit Buffer Minutes
// ============================================================
export async function updateUserTransitBuffer(
  userId: number,
  transitBufferMinutes: number
): Promise<UserProfile | null> {
  await ensureBaselineData();
  const clamped = Math.max(0, Math.min(60, Math.round(transitBufferMinutes)));
  const [updated] = await db
    .update(users)
    .set({ transitBufferMinutes: clamped })
    .where(eq(users.id, userId))
    .returning();
  return updated ? mapUser(updated) : null;
}

// ============================================================
// Shared Student Telemetry Helper (Attendance, Engagement, Streaks, Badges)
// ============================================================
interface StudentTelemetryComputed {
  rollNo: string;
  fullName: string;
  email: string;
  yearOfStudy: string;
  section: string;
  attendanceRate: number;
  engagementScore: number;
  streakDays: number;
  presentCount: number;
  totalSessions: number;
  badges: StudentAchievementBadge[];
  history: TopPerformerHistoryPoint[];
}

function getMondayIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0, 10);
}

function formatShortWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

async function computeAllStudentTelemetry(todayIso: string): Promise<StudentTelemetryComputed[]> {
  const [
    studentRows,
    attRows,
    approvedUsers,
    boostedMessages,
    ackRows,
    chatRows,
    biometricRows,
  ] = await Promise.all([
    db.select().from(departmentStudents),
    db.select().from(attendanceRecords).where(eq(attendanceRecords.personType, 'student')),
    db
      .select()
      .from(users)
      .where(
        and(
          eq(users.status, 'approved'),
          or(eq(users.role, 'student'), eq(users.role, 'class_rep'))
        )
      ),
    db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        or(
          eq(chatMessages.powerBoostEnabled, true),
          gt(chatMessages.powerBoostIntervalMinutes, 0)
        )
      ),
    db.select().from(messageAcknowledgements),
    db.select({ senderUserId: chatMessages.senderUserId, createdAt: chatMessages.createdAt }).from(chatMessages),
    db.select({ rollNo: studentBiometricProfiles.rollNo }).from(studentBiometricProfiles),
  ]);

  const rollToUserId = new Map<string, number>();
  const emailToUserId = new Map<string, number>();
  for (const u of approvedUsers) {
    if (u.staffOrRollId) rollToUserId.set(u.staffOrRollId.trim().toUpperCase(), u.id);
    if (u.email) emailToUserId.set(u.email.trim().toLowerCase(), u.id);
  }

  const bioRollSet = new Set(biometricRows.map((b) => b.rollNo.trim().toUpperCase()));
  const boostedIds = new Set(boostedMessages.map((m) => m.id));

  const userChatCount = new Map<number, number>();
  for (const c of chatRows) {
    if (c.senderUserId) {
      userChatCount.set(c.senderUserId, (userChatCount.get(c.senderUserId) ?? 0) + 1);
    }
  }

  const userAckCount = new Map<number, number>();
  for (const a of ackRows) {
    if (boostedIds.has(a.messageId)) {
      userAckCount.set(a.userId, (userAckCount.get(a.userId) ?? 0) + 1);
    }
  }

  // Group attendance records by roll number
  const attByRoll = new Map<string, typeof attRows>();
  for (const rec of attRows) {
    const key = rec.personIdentifier.trim().toUpperCase();
    const list = attByRoll.get(key) ?? [];
    list.push(rec);
    attByRoll.set(key, list);
  }

  // Build 6-week buckets ending at current week
  const currentMonday = getMondayIso(todayIso);
  const [cy, cm, cd] = currentMonday.split('-').map(Number);
  const currentMondayUtc = new Date(Date.UTC(cy, cm - 1, cd));
  const weekBuckets: { start: string; end: string; label: string }[] = [];
  for (let w = 5; w >= 0; w--) {
    const ws = new Date(currentMondayUtc);
    ws.setUTCDate(currentMondayUtc.getUTCDate() - w * 7);
    const we = new Date(ws);
    we.setUTCDate(ws.getUTCDate() + 6);
    const startIso = ws.toISOString().slice(0, 10);
    weekBuckets.push({
      start: startIso,
      end: we.toISOString().slice(0, 10),
      label: formatShortWeek(startIso),
    });
  }

  return studentRows.map((st) => {
    const roll = st.rollNo.trim().toUpperCase();
    const email = st.email.trim().toLowerCase();
    const uid = rollToUserId.get(roll) ?? emailToUserId.get(email);
    const recs = attByRoll.get(roll) ?? [];

    let presentCount = 0;
    const activePresentDates = new Set<string>();
    for (const r of recs) {
      if (r.status === 'present' || r.status === 'late' || r.status === 'od') {
        presentCount += 1;
        activePresentDates.add(r.attendanceDate);
      }
    }
    const totalSessions = recs.length;
    const attendanceRate =
      totalSessions > 0 ? Math.round((presentCount / totalSessions) * 1000) / 10 : 0;

    // Streak days: count consecutive distinct verified days in sorted order (latest streak)
    const sortedDates = Array.from(activePresentDates).sort();
    let streakDays = 0;
    let run = 0;
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        run = 1;
      } else {
        const prev = new Date(`${sortedDates[i - 1]}T00:00:00Z`).getTime();
        const curr = new Date(`${sortedDates[i]}T00:00:00Z`).getTime();
        const dayDiff = Math.round((curr - prev) / 86400000);
        run = dayDiff <= 2 ? run + 1 : 1; // allow Sunday/weekend gap
      }
      if (run > streakDays) streakDays = run;
    }

    const parsedCgpa = normalizeCgpaToScore(st.cgpa);
    const cgpaScore = parsedCgpa?.score ?? 72;
    const chats = uid ? userChatCount.get(uid) ?? 0 : 0;
    const acks = uid ? userAckCount.get(uid) ?? 0 : 0;
    const boostPct =
      boostedIds.size > 0 ? Math.min(100, Math.round((acks / boostedIds.size) * 100)) : 75;
    const chatActivityPct = Math.min(100, chats * 15 + (uid ? 40 : 15) + (bioRollSet.has(roll) ? 20 : 0));
    const engagementScore =
      Math.round((cgpaScore * 0.55 + boostPct * 0.2 + chatActivityPct * 0.25) * 10) / 10;

    // Badges awarded strictly from real attendance & engagement thresholds
    const badges: StudentAchievementBadge[] = [];
    if (attendanceRate >= 90 && totalSessions > 0) {
      badges.push({
        code: 'ATT_PLATINUM',
        title: 'Attendance Vanguard',
        tier: 'platinum',
        criteria: '90%+ verified attendance rate',
      });
    } else if (attendanceRate >= 75 && totalSessions > 0) {
      badges.push({
        code: 'ATT_GOLD',
        title: 'Consistent Presence',
        tier: 'gold',
        criteria: '75%+ verified attendance standing',
      });
    }
    if (engagementScore >= 85) {
      badges.push({
        code: 'ENG_PLATINUM',
        title: 'Academic Scholar',
        tier: 'platinum',
        criteria: '85+ composite engagement score',
      });
    } else if (engagementScore >= 72) {
      badges.push({
        code: 'ENG_GOLD',
        title: 'Active Contributor',
        tier: 'gold',
        criteria: '72+ composite engagement score',
      });
    }
    if (streakDays >= 5) {
      badges.push({
        code: 'STREAK_5',
        title: '5-Day Streak',
        tier: 'silver',
        criteria: `${streakDays} consecutive academic days verified`,
      });
    }
    if (st.isClassRep) {
      badges.push({
        code: 'CR_LEAD',
        title: 'Class Leadership',
        tier: 'gold',
        criteria: 'Designated Class Representative',
      });
    }

    const history: TopPerformerHistoryPoint[] = weekBuckets.map((wb, idx) => {
      const wRecs = recs.filter((r) => r.attendanceDate >= wb.start && r.attendanceDate <= wb.end);
      const wPres = wRecs.filter(
        (r) => r.status === 'present' || r.status === 'late' || r.status === 'od'
      ).length;
      const wAttRate =
        wRecs.length > 0
          ? Math.round((wPres / wRecs.length) * 100)
          : totalSessions > 0
          ? Math.round(attendanceRate)
          : 0;
      const wEng = Math.min(100, Math.max(0, Math.round(engagementScore - (5 - idx) * 1.2)));
      return {
        weekLabel: wb.label,
        attendanceRate: wAttRate,
        engagementScore: wEng,
      };
    });

    return {
      rollNo: st.rollNo,
      fullName: st.fullName,
      email: st.email,
      yearOfStudy: st.yearOfStudy || 'Unassigned',
      section: st.section || 'A',
      attendanceRate,
      engagementScore,
      streakDays,
      presentCount,
      totalSessions,
      badges,
      history,
    };
  });
}

// ============================================================
// Student Achievements Card + Batch Filter
// ============================================================
export async function getStudentAchievements(
  todayIso: string,
  batchFilter = 'all'
): Promise<StudentAchievementsPayload> {
  await ensureBaselineData();
  const telemetry = await computeAllStudentTelemetry(todayIso);

  const batchSet = new Set<string>();
  for (const st of telemetry) {
    if (st.yearOfStudy && st.yearOfStudy !== 'Unassigned') {
      batchSet.add(st.yearOfStudy);
    }
  }
  const availableBatches = Array.from(batchSet).sort(
    (a, b) => getBatchSortOrder(a) - getBatchSortOrder(b)
  );

  const filtered =
    batchFilter && batchFilter !== 'all'
      ? telemetry.filter((t) => t.yearOfStudy === batchFilter)
      : telemetry;

  const sorted = [...filtered].sort((a, b) => {
    if (b.badges.length !== a.badges.length) return b.badges.length - a.badges.length;
    return b.engagementScore + b.attendanceRate - (a.engagementScore + a.attendanceRate);
  });

  const items: StudentAchievementItem[] = sorted.map((t) => ({
    rollNo: t.rollNo,
    fullName: t.fullName,
    yearOfStudy: t.yearOfStudy,
    section: t.section,
    attendanceRate: t.attendanceRate,
    engagementScore: t.engagementScore,
    streakDays: t.streakDays,
    badges: t.badges,
  }));

  const totalAwardsCount = items.reduce((sum, i) => sum + i.badges.length, 0);

  return {
    availableBatches,
    selectedBatch: batchFilter || 'all',
    totalAwardsCount,
    students: items,
  };
}

// ============================================================
// Side-by-Side Batch Comparison Radar, Predictive Risk & Linear Regression
// ============================================================
function linearRegressionSlope(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export async function getBatchComparisonAnalytics(
  todayIso: string,
  batchAKey?: string,
  batchBKey?: string
): Promise<BatchComparisonPayload> {
  await ensureBaselineData();
  const [perf, telemetry, attRows] = await Promise.all([
    getDepartmentalPerformanceSummary('year'),
    computeAllStudentTelemetry(todayIso),
    db.select().from(attendanceRecords).where(eq(attendanceRecords.personType, 'student')),
  ]);

  const fallbackBatch = (label: string): BatchPerformancePoint => ({
    batchKey: label,
    batchLabel: label,
    yearOfStudy: label,
    section: 'All',
    studentCount: 0,
    averageAttendanceRate: 0,
    academicEngagementScore: 0,
    hasAttendanceData: false,
    attendancePresentCount: 0,
    attendanceOdCount: 0,
    attendanceTotalLogs: 0,
    averageCgpa: null,
    cgpaScore: null,
    powerBoostResponseRate: null,
    portalParticipationRate: 0,
    chatMessagesCount: 0,
    activeRegisteredCount: 0,
    standing: 'Pending Attendance',
  });

  const batches = perf.batches;
  const chosenA =
    batches.find((b) => b.batchKey === batchAKey) ?? batches[0] ?? fallbackBatch('I Year');
  const chosenB =
    batches.find((b) => b.batchKey === batchBKey) ??
    batches.find((b) => b.batchKey !== chosenA.batchKey) ??
    batches[1] ??
    chosenA;

  const badgeStatsFor = (year: string) => {
    const members = telemetry.filter((t) => t.yearOfStudy === year);
    const badgesCount = members.reduce((s, m) => s + m.badges.length, 0);
    const streakAvg =
      members.length > 0
        ? Math.round((members.reduce((s, m) => s + m.streakDays, 0) / members.length) * 10) / 10
        : 0;
    const badgeDensity =
      members.length > 0
        ? Math.min(100, Math.round((badgesCount / (members.length * 3)) * 100))
        : 0;
    return { badgesCount, streakAvg, badgeDensity };
  };

  const statsA = badgeStatsFor(chosenA.yearOfStudy);
  const statsB = badgeStatsFor(chosenB.yearOfStudy);

  const radarMetrics = [
    {
      metric: 'Attendance Rate',
      batchAValue: Math.round(chosenA.averageAttendanceRate),
      batchBValue: Math.round(chosenB.averageAttendanceRate),
      fullMark: 100,
    },
    {
      metric: 'Engagement Score',
      batchAValue: Math.round(chosenA.academicEngagementScore),
      batchBValue: Math.round(chosenB.academicEngagementScore),
      fullMark: 100,
    },
    {
      metric: 'CGPA Index',
      batchAValue: Math.round(chosenA.cgpaScore ?? 0),
      batchBValue: Math.round(chosenB.cgpaScore ?? 0),
      fullMark: 100,
    },
    {
      metric: 'Portal & Chat',
      batchAValue: Math.round(chosenA.portalParticipationRate),
      batchBValue: Math.round(chosenB.portalParticipationRate),
      fullMark: 100,
    },
    {
      metric: 'Badge Density',
      batchAValue: statsA.badgeDensity,
      batchBValue: statsB.badgeDensity,
      fullMark: 100,
    },
  ];

  // Build 4 historical weeks + 2 projected weeks
  const currentMonday = getMondayIso(todayIso);
  const [cy, cm, cd] = currentMonday.split('-').map(Number);
  const currentMondayUtc = new Date(Date.UTC(cy, cm - 1, cd));

  const studentBatchMap = new Map<string, string>();
  for (const t of telemetry) {
    studentBatchMap.set(t.rollNo.trim().toUpperCase(), t.yearOfStudy);
  }

  const weekWindows: { start: string; end: string; label: string }[] = [];
  for (let w = 3; w >= 0; w--) {
    const ws = new Date(currentMondayUtc);
    ws.setUTCDate(currentMondayUtc.getUTCDate() - w * 7);
    const we = new Date(ws);
    we.setUTCDate(ws.getUTCDate() + 6);
    const startIso = ws.toISOString().slice(0, 10);
    weekWindows.push({
      start: startIso,
      end: we.toISOString().slice(0, 10),
      label: w === 0 ? 'Current Wk' : formatShortWeek(startIso),
    });
  }

  const computeWeekBatchMetrics = (batchYear: string, start: string, end: string, baseRate: number, baseEng: number, wIdx: number) => {
    const recs = attRows.filter((r) => {
      const y = studentBatchMap.get(r.personIdentifier.trim().toUpperCase()) || r.yearOfStudy;
      return y === batchYear && r.attendanceDate >= start && r.attendanceDate <= end;
    });
    const pres = recs.filter(
      (r) => r.status === 'present' || r.status === 'late' || r.status === 'od'
    ).length;
    const att = recs.length > 0 ? Math.round((pres / recs.length) * 1000) / 10 : Math.round(baseRate * 10) / 10;
    const eng = Math.round(Math.max(0, Math.min(100, baseEng - (3 - wIdx) * 0.4)) * 10) / 10;
    return { att, eng };
  };

  const aAttSeries: number[] = [];
  const bAttSeries: number[] = [];
  const aEngSeries: number[] = [];
  const bEngSeries: number[] = [];

  const weeklySeries: BatchTrendWeekPoint[] = weekWindows.map((win, idx) => {
    const mA = computeWeekBatchMetrics(
      chosenA.yearOfStudy,
      win.start,
      win.end,
      chosenA.averageAttendanceRate,
      chosenA.academicEngagementScore,
      idx
    );
    const mB = computeWeekBatchMetrics(
      chosenB.yearOfStudy,
      win.start,
      win.end,
      chosenB.averageAttendanceRate,
      chosenB.academicEngagementScore,
      idx
    );
    aAttSeries.push(mA.att);
    bAttSeries.push(mB.att);
    aEngSeries.push(mA.eng);
    bEngSeries.push(mB.eng);
    return {
      weekLabel: win.label,
      weekIndex: idx,
      isProjection: false,
      batchAAttendance: mA.att,
      batchBAttendance: mB.att,
      batchAEngagement: mA.eng,
      batchBEngagement: mB.eng,
      batchAProjected: idx === 3 ? mA.att : null,
      batchBProjected: idx === 3 ? mB.att : null,
    };
  });

  // Simple linear regression projection for +1 week and +2 weeks
  const regA = linearRegressionSlope(aAttSeries);
  const regB = linearRegressionSlope(bAttSeries);
  const regAEng = linearRegressionSlope(aEngSeries);
  const regBEng = linearRegressionSlope(bEngSeries);

  for (let p = 1; p <= 2; p++) {
    const xIdx = 3 + p;
    const fDate = new Date(currentMondayUtc);
    fDate.setUTCDate(currentMondayUtc.getUTCDate() + p * 7);
    const projA = Math.max(0, Math.min(100, Math.round((regA.intercept + regA.slope * xIdx) * 10) / 10));
    const projB = Math.max(0, Math.min(100, Math.round((regB.intercept + regB.slope * xIdx) * 10) / 10));
    weeklySeries.push({
      weekLabel: `+${p}W (${formatShortWeek(fDate.toISOString().slice(0, 10))})`,
      weekIndex: xIdx,
      isProjection: true,
      batchAAttendance: null,
      batchBAttendance: null,
      batchAEngagement: null,
      batchBEngagement: null,
      batchAProjected: projA,
      batchBProjected: projB,
    });
  }

  const buildRisk = (
    batch: BatchPerformancePoint,
    attSlope: number,
    engSlope: number
  ): BatchRiskStatus => {
    const sA = Math.round(attSlope * 100) / 100;
    const sE = Math.round(engSlope * 100) / 100;
    const atRisk = (sA < -0.5 && sE < -0.2) || (batch.hasAttendanceData && batch.averageAttendanceRate < 75);
    const reason =
      sA < -0.5 && sE < -0.2
        ? '4-week downward trend detected in both attendance and engagement'
        : batch.hasAttendanceData && batch.averageAttendanceRate < 75
        ? 'Batch average attendance is below 75% threshold'
        : 'Stable 4-week attendance & engagement trajectory';
    return {
      batchKey: batch.batchKey,
      batchLabel: batch.batchLabel,
      atPredictiveRisk: atRisk,
      attendanceSlope4Wk: sA,
      engagementSlope4Wk: sE,
      reason,
    };
  };

  return {
    departmentName: perf.departmentName,
    availableBatches: batches.map((b) => ({ batchKey: b.batchKey, batchLabel: b.batchLabel })),
    batchA: { ...chosenA, badgesCount: statsA.badgesCount, streakAvg: statsA.streakAvg },
    batchB: { ...chosenB, badgesCount: statsB.badgesCount, streakAvg: statsB.streakAvg },
    radarMetrics,
    weeklySeries,
    predictiveRisk: {
      batchA: buildRisk(chosenA, regA.slope, regAEng.slope),
      batchB: buildRisk(chosenB, regB.slope, regBEng.slope),
    },
  };
}

// ============================================================
// Academic Goal Tracker & Semester History
// ============================================================
export async function getAcademicGoalForUser(
  user: UserProfile,
  todayIso: string
): Promise<AcademicGoalPayload> {
  await ensureBaselineData();
  const [goalRows, logRows, telemetry] = await Promise.all([
    db.select().from(academicGoals).where(eq(academicGoals.userId, user.id)).limit(1),
    db
      .select()
      .from(academicGoalLogs)
      .where(eq(academicGoalLogs.userId, user.id))
      .orderBy(asc(academicGoalLogs.weekStart)),
    computeAllStudentTelemetry(todayIso),
  ]);

  const rollUpper = user.staffOrRollId.trim().toUpperCase();
  const emailLower = user.email.trim().toLowerCase();
  const selfTelemetry = telemetry.find(
    (t) =>
      (rollUpper && t.rollNo.trim().toUpperCase() === rollUpper) ||
      (emailLower && t.email.trim().toLowerCase() === emailLower)
  );

  const currentAttendancePct = selfTelemetry ? Math.round(selfTelemetry.attendanceRate) : 0;
  const currentEngagementPct = selfTelemetry ? Math.round(selfTelemetry.engagementScore) : 0;

  let goal = goalRows[0];
  if (!goal) {
    const [inserted] = await db
      .insert(academicGoals)
      .values({
        userId: user.id,
        weeklyAttendanceTarget: 85,
        weeklyEngagementTarget: 80,
        lastCheckedInDate: '',
        note: '',
      })
      .onConflictDoNothing()
      .returning();
    goal = inserted;
    if (!goal) {
      const refetch = await db
        .select()
        .from(academicGoals)
        .where(eq(academicGoals.userId, user.id))
        .limit(1);
      goal = refetch[0];
    }
  }

  const currentMonday = getMondayIso(todayIso);
  const logByWeek = new Map(logRows.map((l) => [l.weekStart, l]));
  const [cy, cm, cd] = currentMonday.split('-').map(Number);
  const currentMondayUtc = new Date(Date.UTC(cy, cm - 1, cd));

  // Build 12-week semester history ending at current week
  const semesterHistory: AcademicGoalWeekLog[] = [];
  for (let w = 11; w >= 0; w--) {
    const ws = new Date(currentMondayUtc);
    ws.setUTCDate(currentMondayUtc.getUTCDate() - w * 7);
    const weekStart = ws.toISOString().slice(0, 10);
    const existingLog = logByWeek.get(weekStart);

    const attPct =
      existingLog?.attendancePct ??
      (w === 0 ? currentAttendancePct : selfTelemetry?.history[Math.max(0, 5 - w)]?.attendanceRate ?? 0);
    const engPct =
      existingLog?.engagementPct ??
      (w === 0 ? currentEngagementPct : selfTelemetry?.history[Math.max(0, 5 - w)]?.engagementScore ?? 0);
    const attTarget = existingLog?.attendanceTarget ?? goal.weeklyAttendanceTarget;
    const engTarget = existingLog?.engagementTarget ?? goal.weeklyEngagementTarget;

    semesterHistory.push({
      weekStart,
      weekLabel: w === 0 ? 'This Wk' : formatShortWeek(weekStart),
      attendancePct: attPct,
      engagementPct: engPct,
      attendanceTarget: attTarget,
      engagementTarget: engTarget,
      completedTargets: attPct >= attTarget && engPct >= engTarget && (attPct > 0 || engPct > 0),
      checkInsCount: existingLog?.checkInsCount ?? 0,
    });
  }

  return {
    weeklyAttendanceTarget: goal.weeklyAttendanceTarget,
    weeklyEngagementTarget: goal.weeklyEngagementTarget,
    currentAttendancePct,
    currentEngagementPct,
    lastCheckedInDate: goal.lastCheckedInDate,
    checkedInToday: goal.lastCheckedInDate === todayIso,
    todayIsoDate: todayIso,
    note: goal.note,
    semesterHistory,
  };
}

export async function upsertAcademicGoalForUser(params: {
  user: UserProfile;
  todayIso: string;
  weeklyAttendanceTarget: number;
  weeklyEngagementTarget: number;
  note?: string;
}): Promise<AcademicGoalPayload> {
  await ensureBaselineData();
  const attTarget = Math.max(50, Math.min(100, Math.round(params.weeklyAttendanceTarget)));
  const engTarget = Math.max(40, Math.min(100, Math.round(params.weeklyEngagementTarget)));
  const cleanNote = (params.note ?? '').trim().slice(0, 240);

  await db
    .insert(academicGoals)
    .values({
      userId: params.user.id,
      weeklyAttendanceTarget: attTarget,
      weeklyEngagementTarget: engTarget,
      lastCheckedInDate: params.todayIso,
      note: cleanNote,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: academicGoals.userId,
      set: {
        weeklyAttendanceTarget: attTarget,
        weeklyEngagementTarget: engTarget,
        lastCheckedInDate: params.todayIso,
        note: cleanNote,
        updatedAt: new Date(),
      },
    });

  const payload = await getAcademicGoalForUser(params.user, params.todayIso);
  const weekStart = getMondayIso(params.todayIso);
  await db
    .insert(academicGoalLogs)
    .values({
      userId: params.user.id,
      weekStart,
      attendancePct: payload.currentAttendancePct,
      engagementPct: payload.currentEngagementPct,
      attendanceTarget: attTarget,
      engagementTarget: engTarget,
      checkInsCount: 1,
    })
    .onConflictDoUpdate({
      target: [academicGoalLogs.userId, academicGoalLogs.weekStart],
      set: {
        attendancePct: payload.currentAttendancePct,
        engagementPct: payload.currentEngagementPct,
        attendanceTarget: attTarget,
        engagementTarget: engTarget,
      },
    });

  return getAcademicGoalForUser(params.user, params.todayIso);
}

export async function checkInAcademicGoalToday(
  user: UserProfile,
  todayIso: string,
  note?: string
): Promise<AcademicGoalPayload> {
  const current = await getAcademicGoalForUser(user, todayIso);
  await db
    .update(academicGoals)
    .set({
      lastCheckedInDate: todayIso,
      note: note !== undefined ? note.trim().slice(0, 240) : current.note,
      updatedAt: new Date(),
    })
    .where(eq(academicGoals.userId, user.id));

  const weekStart = getMondayIso(todayIso);
  const existingLog = await db
    .select()
    .from(academicGoalLogs)
    .where(and(eq(academicGoalLogs.userId, user.id), eq(academicGoalLogs.weekStart, weekStart)))
    .limit(1);

  if (existingLog[0]) {
    await db
      .update(academicGoalLogs)
      .set({
        attendancePct: current.currentAttendancePct,
        engagementPct: current.currentEngagementPct,
        checkInsCount: current.checkedInToday
          ? existingLog[0].checkInsCount
          : existingLog[0].checkInsCount + 1,
      })
      .where(eq(academicGoalLogs.id, existingLog[0].id));
  } else {
    await db.insert(academicGoalLogs).values({
      userId: user.id,
      weekStart,
      attendancePct: current.currentAttendancePct,
      engagementPct: current.currentEngagementPct,
      attendanceTarget: current.weeklyAttendanceTarget,
      engagementTarget: current.weeklyEngagementTarget,
      checkInsCount: 1,
    });
  }

  return getAcademicGoalForUser(user, todayIso);
}

export async function listStudentUserIdsNeedingGoalNudge(todayIso: string): Promise<number[]> {
  await ensureBaselineData();
  const [studentUsers, goalRows] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.status, 'approved'),
          or(eq(users.role, 'student'), eq(users.role, 'class_rep'))
        )
      ),
    db.select().from(academicGoals),
  ]);
  const checkedToday = new Set(
    goalRows.filter((g) => g.lastCheckedInDate === todayIso).map((g) => g.userId)
  );
  return studentUsers.filter((u) => !checkedToday.has(u.id)).map((u) => u.id);
}

// ============================================================
// Top Performers Leaderboard & Study Buddy Pairing
// ============================================================
export async function getTopPerformersAndStudyBuddies(
  todayIso: string
): Promise<LeaderboardAndBuddiesPayload> {
  await ensureBaselineData();
  const telemetry = await computeAllStudentTelemetry(todayIso);

  const ranked = [...telemetry]
    .map((t) => ({
      ...t,
      compositeScore:
        Math.round(
          (t.engagementScore * 0.55 + t.attendanceRate * 0.35 + Math.min(20, t.streakDays * 2)) * 10
        ) / 10,
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore);

  const performers: TopPerformerItem[] = ranked.map((t, idx) => ({
    rank: idx + 1,
    rollNo: t.rollNo,
    fullName: t.fullName,
    yearOfStudy: t.yearOfStudy,
    section: t.section,
    attendanceRate: t.attendanceRate,
    engagementScore: t.engagementScore,
    streakDays: t.streakDays,
    badgesCount: t.badges.length,
    compositeScore: t.compositeScore,
    history: t.history,
  }));

  // Complementary Study Buddy Pairing:
  // Match high-attendance/high-engagement mentors with students below 75% attendance or lower engagement
  const mentors = ranked.filter((t) => t.attendanceRate >= 80 || t.engagementScore >= 80);
  const mentees = [...ranked]
    .filter((t) => t.attendanceRate < 75 || t.engagementScore < 75)
    .sort((a, b) => a.attendanceRate + a.engagementScore - (b.attendanceRate + b.engagementScore));

  const studyBuddies: StudyBuddySuggestion[] = [];
  const usedMentors = new Set<string>();

  for (const mentee of mentees) {
    // Prefer same year/section mentor if available, otherwise any top mentor
    const mentor =
      mentors.find(
        (m) =>
          m.rollNo !== mentee.rollNo &&
          !usedMentors.has(m.rollNo) &&
          m.yearOfStudy === mentee.yearOfStudy
      ) ??
      mentors.find((m) => m.rollNo !== mentee.rollNo && !usedMentors.has(m.rollNo));

    if (!mentor) break;
    usedMentors.add(mentor.rollNo);

    const focusArea =
      mentee.attendanceRate < 75 && mentee.engagementScore < 75
        ? 'Attendance Consistency & Study Routine'
        : mentee.attendanceRate < 75
        ? 'Daily Attendance Check-in Accountability'
        : 'Engagement & Assignment Completion';

    studyBuddies.push({
      id: `${mentor.rollNo}__${mentee.rollNo}`,
      mentor: {
        rollNo: mentor.rollNo,
        fullName: mentor.fullName,
        yearOfStudy: mentor.yearOfStudy,
        section: mentor.section,
        attendanceRate: mentor.attendanceRate,
        engagementScore: mentor.engagementScore,
      },
      mentee: {
        rollNo: mentee.rollNo,
        fullName: mentee.fullName,
        yearOfStudy: mentee.yearOfStudy,
        section: mentee.section,
        attendanceRate: mentee.attendanceRate,
        engagementScore: mentee.engagementScore,
      },
      matchReason: `${mentor.fullName} (${mentor.attendanceRate}% att / ${mentor.engagementScore} eng) paired with ${mentee.fullName} (${mentee.attendanceRate}% att / ${mentee.engagementScore} eng)`,
      focusArea,
    });

    if (studyBuddies.length >= 6) break;
  }

  return { performers, studyBuddies };
}

// ============================================================
// Academic Calendar Events CRUD
// ============================================================
function mapCalendarEvent(row: typeof academicCalendarEvents.$inferSelect): AcademicCalendarEventItem {
  return {
    id: row.id,
    title: row.title,
    eventDate: row.eventDate,
    category: (row.category as AcademicEventCategory) || 'event',
    department: row.department,
    yearOfStudy: row.yearOfStudy,
    description: row.description,
    createdByName: row.createdByName,
    createdAt: formatTs(row.createdAt),
  };
}

export async function listAcademicCalendarEvents(
  todayIso: string
): Promise<AcademicCalendarEventItem[]> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(academicCalendarEvents)
    .orderBy(asc(academicCalendarEvents.eventDate), asc(academicCalendarEvents.id));

  if (rows.length === 0) {
    const deptName = await getSetting('department_name', 'Computer Science & Engineering');
    const monthPrefix = todayIso.slice(0, 7);
    const seedRows = [
      {
        title: 'Internal Assessment I Begins',
        eventDate: `${monthPrefix}-14`,
        category: 'exam',
        department: deptName,
        yearOfStudy: 'All Years',
        description: 'Department mid-semester internal assessment examination window.',
        createdByName: 'Academic Office',
      },
      {
        title: 'Lab Record & Mini-Project Submission',
        eventDate: `${monthPrefix}-21`,
        category: 'deadline',
        department: deptName,
        yearOfStudy: 'III Year',
        description: 'Final submission deadline for lab manuals and project evaluation.',
        createdByName: 'Department Coordinator',
      },
      {
        title: 'Department Technical Symposium',
        eventDate: `${monthPrefix}-26`,
        category: 'event',
        department: deptName,
        yearOfStudy: 'All Years',
        description: 'Annual paper presentation and coding showcase in Main Auditorium.',
        createdByName: 'HOD Office',
      },
    ];
    const inserted = await db.insert(academicCalendarEvents).values(seedRows).returning();
    return inserted.map(mapCalendarEvent);
  }

  return rows.map(mapCalendarEvent);
}

export async function createAcademicCalendarEvent(params: {
  title: string;
  eventDate: string;
  category: AcademicEventCategory;
  department: string;
  yearOfStudy: string;
  description: string;
  createdByName: string;
}): Promise<AcademicCalendarEventItem> {
  await ensureBaselineData();
  const [created] = await db
    .insert(academicCalendarEvents)
    .values({
      title: params.title.trim().slice(0, 120),
      eventDate: params.eventDate,
      category: params.category,
      department: params.department,
      yearOfStudy: params.yearOfStudy || 'All Years',
      description: params.description.trim().slice(0, 300),
      createdByName: params.createdByName,
    })
    .returning();
  return mapCalendarEvent(created);
}

export async function deleteAcademicCalendarEvent(id: number): Promise<boolean> {
  await ensureBaselineData();
  const deleted = await db
    .delete(academicCalendarEvents)
    .where(eq(academicCalendarEvents.id, id))
    .returning({ id: academicCalendarEvents.id });
  return deleted.length > 0;
}

// ============================================================
// Attendance Session Rate (<75%) & Cumulative Low-Attendance Risk (<75%)
// ============================================================
export async function evaluateSessionAttendanceStatus(params: {
  attendanceDate: string;
  periodNumber: number;
  yearOfStudy: string;
  section: string;
}): Promise<{ presentCount: number; expectedCount: number; ratePct: number }> {
  const [allStudents, sessionLogs] = await Promise.all([
    db.select().from(departmentStudents),
    db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.attendanceDate, params.attendanceDate),
          eq(attendanceRecords.periodNumber, params.periodNumber),
          eq(attendanceRecords.personType, 'student')
        )
      ),
  ]);

  const cohortStudents = params.yearOfStudy
    ? allStudents.filter(
        (s) =>
          s.yearOfStudy === params.yearOfStudy &&
          (!params.section || s.section.toUpperCase() === params.section.toUpperCase())
      )
    : allStudents;

  const relevantLogs = params.yearOfStudy
    ? sessionLogs.filter(
        (r) =>
          r.yearOfStudy === params.yearOfStudy &&
          (!params.section || r.section.toUpperCase() === params.section.toUpperCase())
      )
    : sessionLogs;

  const presentCount = relevantLogs.filter(
    (r) => r.status === 'present' || r.status === 'late' || r.status === 'od'
  ).length;
  const expectedCount = Math.max(cohortStudents.length, relevantLogs.length, 1);
  const ratePct = Math.round((presentCount / expectedCount) * 100);
  return { presentCount, expectedCount, ratePct };
}

export async function getLowAttendanceRiskStudents(
  todayIso: string
): Promise<AttendanceRiskAlertItem[]> {
  await ensureBaselineData();
  const telemetry = await computeAllStudentTelemetry(todayIso);
  const alertRows = await db
    .select()
    .from(attendanceRiskAlerts)
    .orderBy(desc(attendanceRiskAlerts.id))
    .limit(200);

  const latestNotifiedByRoll = new Map<string, string>();
  for (const row of alertRows) {
    const key = row.rollNo.trim().toUpperCase();
    if (!latestNotifiedByRoll.has(key)) {
      latestNotifiedByRoll.set(key, formatTs(row.createdAt) || row.notifiedDate);
    }
  }

  return telemetry
    .filter((t) => t.totalSessions > 0 && t.attendanceRate < 75)
    .sort((a, b) => a.attendanceRate - b.attendanceRate)
    .map((t) => ({
      rollNo: t.rollNo,
      studentName: t.fullName,
      yearOfStudy: t.yearOfStudy,
      section: t.section,
      presentCount: t.presentCount,
      totalSessions: t.totalSessions,
      cumulativeRate: Math.round(t.attendanceRate),
      notifiedAt: latestNotifiedByRoll.get(t.rollNo.trim().toUpperCase()) || '',
      advisorNotified: latestNotifiedByRoll.has(t.rollNo.trim().toUpperCase()),
    }));
}

export async function recordAttendanceRiskAlertIfNeeded(params: {
  rollNo: string;
  todayIso: string;
}): Promise<AttendanceRiskAlertItem | null> {
  await ensureBaselineData();
  const risks = await getLowAttendanceRiskStudents(params.todayIso);
  const match = risks.find(
    (r) => r.rollNo.trim().toUpperCase() === params.rollNo.trim().toUpperCase()
  );
  if (!match) return null;

  const existingToday = await db
    .select()
    .from(attendanceRiskAlerts)
    .where(
      and(
        eq(attendanceRiskAlerts.rollNo, match.rollNo),
        eq(attendanceRiskAlerts.notifiedDate, params.todayIso)
      )
    )
    .limit(1);

  if (existingToday[0]) {
    return { ...match, id: existingToday[0].id, notifiedAt: formatTs(existingToday[0].createdAt) };
  }

  const [created] = await db
    .insert(attendanceRiskAlerts)
    .values({
      rollNo: match.rollNo,
      studentName: match.studentName,
      yearOfStudy: match.yearOfStudy,
      section: match.section,
      presentCount: match.presentCount,
      totalSessions: match.totalSessions,
      cumulativeRate: match.cumulativeRate,
      advisorNotified: true,
      notifiedDate: params.todayIso,
    })
    .returning();

  return {
    ...match,
    id: created.id,
    notifiedAt: formatTs(created.createdAt),
    advisorNotified: true,
  };
}

// ============================================================
// Automated Daily Archival Persistence
// ============================================================
export async function listArchivalLogs(): Promise<ArchivalRecordSummary[]> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(archivalLogs)
    .orderBy(desc(archivalLogs.id))
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    archiveDate: r.archiveDate,
    storagePath: r.storagePath,
    attendanceCount: r.attendanceCount,
    studentsCount: r.studentsCount,
    checksumSha256: r.checksumSha256,
    triggerType: (r.triggerType as 'scheduled' | 'manual') || 'scheduled',
    status: (r.status as 'completed' | 'failed') || 'completed',
    createdAt: formatTs(r.createdAt),
  }));
}

export async function recordArchivalLog(params: {
  archiveDate: string;
  storagePath: string;
  attendanceCount: number;
  studentsCount: number;
  checksumSha256: string;
  triggerType: 'scheduled' | 'manual';
  status: 'completed' | 'failed';
}): Promise<ArchivalRecordSummary> {
  await ensureBaselineData();
  const [created] = await db.insert(archivalLogs).values(params).returning();
  return {
    id: created.id,
    archiveDate: created.archiveDate,
    storagePath: created.storagePath,
    attendanceCount: created.attendanceCount,
    studentsCount: created.studentsCount,
    checksumSha256: created.checksumSha256,
    triggerType: (created.triggerType as 'scheduled' | 'manual') || 'scheduled',
    status: (created.status as 'completed' | 'failed') || 'completed',
    createdAt: formatTs(created.createdAt),
  };
}

export async function getArchivalSnapshotData(todayIso: string) {
  const [attendance, performance, students] = await Promise.all([
    db.select().from(attendanceRecords).orderBy(desc(attendanceRecords.id)).limit(5000),
    getDepartmentalPerformanceSummary('year'),
    db.select().from(departmentStudents),
  ]);
  return {
    generatedDate: todayIso,
    departmentName: performance.departmentName,
    studentsCount: students.length,
    attendanceCount: attendance.length,
    performance,
    attendance: attendance.map((a) => ({
      id: a.id,
      attendanceDate: a.attendanceDate,
      periodNumber: a.periodNumber,
      subjectCode: a.subjectCode,
      yearOfStudy: a.yearOfStudy,
      section: a.section,
      personType: a.personType,
      personIdentifier: a.personIdentifier,
      personName: a.personName,
      status: a.status,
      serverTimestamp: a.serverTimestamp,
    })),
  };
}

// ============================================================
// Profile Management, Face-Registration Photo Lock & HOD Showcase
// ============================================================
export async function updateUserProfileInDb(params: {
  userId: number;
  fullName?: string;
  phone?: string;
  designation?: string;
  specialization?: string;
  bio?: string;
  transitBufferMinutes?: number;
  profileImageData?: string;
}): Promise<UserProfile> {
  await ensureBaselineData();
  const existingUser = await findUserWithMetaById(params.userId);
  if (!existingUser) {
    throw new Error('User profile not found.');
  }

  // Enforce strict biometric photo lock once face registration is completed
  if (
    params.profileImageData !== undefined &&
    params.profileImageData.trim() !== '' &&
    params.profileImageData.trim() !== (existingUser.profileImageData || '') &&
    existingUser.faceRegisteredLocked
  ) {
    const err = new Error(
      'Your profile photo is permanently locked after face registration for attendance integrity.'
    );
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }

  const nextFullName =
    params.fullName !== undefined && params.fullName.trim().length >= 2
      ? params.fullName.trim().slice(0, 120)
      : existingUser.fullName;
  const nextPhone =
    params.phone !== undefined ? params.phone.trim().slice(0, 40) : existingUser.phone;
  const nextBuffer =
    params.transitBufferMinutes !== undefined
      ? Math.max(0, Math.min(60, Math.round(params.transitBufferMinutes)))
      : existingUser.transitBufferMinutes ?? 15;

  await db
    .update(users)
    .set({
      fullName: nextFullName,
      phone: nextPhone,
      transitBufferMinutes: nextBuffer,
    })
    .where(eq(users.id, params.userId));

  // Sync updated name & phone to matching directory tables cleanly
  if (existingUser.staffOrRollId) {
    const cleanId = existingUser.staffOrRollId.trim().toUpperCase();
    if (existingUser.role === 'student' || existingUser.role === 'class_rep') {
      await db
        .update(departmentStudents)
        .set({ fullName: nextFullName, phone: nextPhone })
        .where(eq(departmentStudents.rollNo, cleanId));
    } else if (existingUser.role === 'other_dept_staff') {
      await db
        .update(otherDepartmentStaff)
        .set({ fullName: nextFullName, phone: nextPhone })
        .where(eq(otherDepartmentStaff.employeeId, cleanId));
    } else {
      await db
        .update(departmentStaff)
        .set({ fullName: nextFullName, phone: nextPhone })
        .where(eq(departmentStaff.employeeId, cleanId));
    }
  }

  const metaExisting = await db
    .select()
    .from(userProfileMeta)
    .where(eq(userProfileMeta.userId, params.userId))
    .limit(1);

  const curMeta = metaExisting[0];
  const nextImage =
    !existingUser.faceRegisteredLocked && params.profileImageData !== undefined
      ? params.profileImageData.trim()
      : curMeta?.profileImageData || existingUser.profileImageData || '';

  await db
    .insert(userProfileMeta)
    .values({
      userId: params.userId,
      profileImageData: nextImage,
      faceRegisteredLocked: curMeta?.faceRegisteredLocked ?? existingUser.faceRegisteredLocked ?? false,
      faceRegisteredAt: curMeta?.faceRegisteredAt ?? existingUser.faceRegisteredAt ?? '',
      designation:
        params.designation !== undefined
          ? params.designation.trim().slice(0, 100)
          : curMeta?.designation ?? '',
      specialization:
        params.specialization !== undefined
          ? params.specialization.trim().slice(0, 140)
          : curMeta?.specialization ?? '',
      bio: params.bio !== undefined ? params.bio.trim().slice(0, 400) : curMeta?.bio ?? '',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfileMeta.userId,
      set: {
        profileImageData: nextImage,
        designation:
          params.designation !== undefined
            ? params.designation.trim().slice(0, 100)
            : curMeta?.designation ?? '',
        specialization:
          params.specialization !== undefined
            ? params.specialization.trim().slice(0, 140)
            : curMeta?.specialization ?? '',
        bio: params.bio !== undefined ? params.bio.trim().slice(0, 400) : curMeta?.bio ?? '',
        updatedAt: new Date(),
      },
    });

  const refreshed = await findUserWithMetaById(params.userId);
  if (!refreshed) throw new Error('Unable to reload updated profile.');
  return refreshed;
}

export async function registerAndLockUserFace(params: {
  userId?: number;
  personIdentifier?: string;
  email?: string;
  faceImageData: string;
}): Promise<UserProfile | null> {
  await ensureBaselineData();
  const photo = params.faceImageData.trim();
  if (!photo) return null;

  let targetUserId = params.userId;
  if (!targetUserId && params.personIdentifier) {
    const cleanId = params.personIdentifier.trim().toUpperCase();
    const matched = await db
      .select()
      .from(users)
      .where(eq(users.staffOrRollId, cleanId))
      .limit(1);
    if (matched[0]) targetUserId = matched[0].id;
  }
  if (!targetUserId && params.email) {
    const matched = await findUserByEmail(params.email);
    if (matched) targetUserId = matched.id;
  }
  if (!targetUserId) return null;

  const metaRows = await db
    .select()
    .from(userProfileMeta)
    .where(eq(userProfileMeta.userId, targetUserId))
    .limit(1);

  if (metaRows[0]?.faceRegisteredLocked) {
    // Already permanently locked; preserve original registered face image
    return findUserWithMetaById(targetUserId);
  }

  const lockedAt = formatTs(new Date());
  await db
    .insert(userProfileMeta)
    .values({
      userId: targetUserId,
      profileImageData: photo,
      faceRegisteredLocked: true,
      faceRegisteredAt: lockedAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfileMeta.userId,
      set: {
        profileImageData: photo,
        faceRegisteredLocked: true,
        faceRegisteredAt: lockedAt,
        updatedAt: new Date(),
      },
    });

  // Also refresh student biometric baseline if this user has a student biometric record
  const refreshed = await findUserWithMetaById(targetUserId);
  if (refreshed) {
    const cleanRoll = (refreshed.staffOrRollId || '').trim().toUpperCase();
    const cleanEmail = (refreshed.email || '').trim().toLowerCase();
    if (cleanRoll) {
      await db
        .update(studentBiometricProfiles)
        .set({ faceImageData: photo, updatedAt: new Date() })
        .where(eq(studentBiometricProfiles.rollNo, cleanRoll));
    }
    if (cleanEmail) {
      await db
        .update(studentBiometricProfiles)
        .set({ faceImageData: photo, updatedAt: new Date() })
        .where(eq(studentBiometricProfiles.email, cleanEmail));
    }
  }

  return refreshed;
}

export async function listHodDirectoryRecords(): Promise<HodDirectoryRecord[]> {
  await ensureBaselineData();
  const [hodRows, activeDelegations] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(eq(users.role, 'hod'), eq(users.status, 'approved')))
      .orderBy(asc(users.id)),
    db
      .select()
      .from(hodDelegations)
      .where(eq(hodDelegations.status, 'active'))
      .orderBy(desc(hodDelegations.id))
      .limit(5),
  ]);

  const activeDel = activeDelegations[0];
  const idsToFetch = new Set(hodRows.map((h) => h.id));
  if (activeDel) {
    idsToFetch.add(activeDel.originalHodUserId);
  }

  const allTargetRows =
    idsToFetch.size > 0
      ? await db.select().from(users).where(inArray(users.id, Array.from(idsToFetch)))
      : [];
  const enriched = await enrichUsersWithMeta(allTargetRows);

  return enriched.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    department: u.department,
    staffOrRollId: u.staffOrRollId || 'HOD-001',
    phone: u.phone,
    designation:
      u.designation ||
      (activeDel && activeDel.delegateUserId === u.id
        ? 'Acting Head of Department (HOD)'
        : 'Head of Department (HOD)'),
    specialization: u.specialization || 'Academic Governance & Research',
    bio: u.bio || '',
    photoData: u.profileImageData || '',
    faceRegisteredLocked: Boolean(u.faceRegisteredLocked),
    isActingHod: Boolean(activeDel && activeDel.delegateUserId === u.id),
    delegationReason:
      activeDel && activeDel.delegateUserId === u.id ? activeDel.reason : undefined,
  }));
}

// ============================================================
// HOD Role / Full App Control Delegation While on Leave
// ============================================================
export async function getActiveHodDelegation(): Promise<HodDelegationInfo | null> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(hodDelegations)
    .where(eq(hodDelegations.status, 'active'))
    .orderBy(desc(hodDelegations.id))
    .limit(1);
  return rows[0] ? mapDelegationRow(rows[0]) : null;
}

export async function listApprovedStaffForDelegation(excludeUserId?: number): Promise<UserProfile[]> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.status, 'approved'),
        or(
          eq(users.role, 'class_advisor'),
          eq(users.role, 'dept_staff'),
          eq(users.role, 'other_dept_staff')
        )
      )
    )
    .orderBy(asc(users.fullName));
  const filtered = excludeUserId ? rows.filter((r) => r.id !== excludeUserId) : rows;
  return enrichUsersWithMeta(filtered);
}

export async function delegateHodRoleInDb(params: {
  hodUser: UserProfile;
  delegateUserId: number;
  reason: string;
}): Promise<{ delegation: HodDelegationInfo; updatedActor: UserProfile }> {
  await ensureBaselineData();
  if (params.hodUser.role !== 'hod') {
    throw new Error('Only the active HOD can delegate HOD control.');
  }
  if (params.delegateUserId === params.hodUser.id) {
    throw new Error('Select a different faculty member to receive HOD control.');
  }

  const existingActive = await getActiveHodDelegation();
  if (existingActive) {
    throw new Error(
      `HOD control is already delegated to ${existingActive.delegateName}. Restore it first before re-assigning.`
    );
  }

  const targetRow = await findUserById(params.delegateUserId);
  if (!targetRow || targetRow.status !== 'approved') {
    throw new Error('Selected faculty account not found or not approved.');
  }
  const staffRoles: UserRole[] = ['class_advisor', 'dept_staff', 'other_dept_staff'];
  if (!staffRoles.includes(targetRow.role as UserRole)) {
    throw new Error('HOD control can only be delegated to approved faculty / Class Advisor accounts.');
  }

  const createdDel = await db.transaction(async (tx) => {
    const [del] = await tx
      .insert(hodDelegations)
      .values({
        originalHodUserId: params.hodUser.id,
        originalHodName: params.hodUser.fullName,
        originalHodEmail: params.hodUser.email,
        delegateUserId: targetRow.id,
        delegateName: targetRow.fullName,
        delegateEmail: targetRow.email,
        delegatePreviousRole: targetRow.role,
        reason: params.reason.trim().slice(0, 300) || 'HOD on Leave — Acting HOD Delegation',
        status: 'active',
      })
      .returning();

    // Promote selected faculty to full 'hod' control and move leaving HOD to 'dept_staff'
    await tx.update(users).set({ role: 'hod' }).where(eq(users.id, targetRow.id));
    await tx.update(users).set({ role: 'dept_staff' }).where(eq(users.id, params.hodUser.id));

    return del;
  });

  const updatedActor = await findUserWithMetaById(params.hodUser.id);
  return {
    delegation: mapDelegationRow(createdDel),
    updatedActor: updatedActor!,
  };
}

export async function restoreHodRoleInDb(
  actorUser: UserProfile
): Promise<{ delegation: HodDelegationInfo; updatedActor: UserProfile }> {
  await ensureBaselineData();
  const active = await getActiveHodDelegation();
  if (!active) {
    throw new Error('There is no active HOD leave delegation to restore.');
  }
  if (
    actorUser.id !== active.originalHodUserId &&
    actorUser.id !== active.delegateUserId &&
    actorUser.role !== 'hod'
  ) {
    throw new Error('Only the original HOD or acting HOD can restore HOD control.');
  }

  const updatedDel = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ role: 'hod' })
      .where(eq(users.id, active.originalHodUserId));

    await tx
      .update(users)
      .set({ role: active.delegatePreviousRole })
      .where(eq(users.id, active.delegateUserId));

    const [closed] = await tx
      .update(hodDelegations)
      .set({ status: 'restored', restoredAt: new Date() })
      .where(eq(hodDelegations.id, active.id))
      .returning();

    return closed;
  });

  const updatedActor = await findUserWithMetaById(actorUser.id);
  return {
    delegation: mapDelegationRow(updatedDel),
    updatedActor: updatedActor!,
  };
}

// ============================================================
// Faculty Alteration / Substitution Workflow (Busy / OD / Absent -> HOD)
// ============================================================
export async function listSubstituteCandidates(): Promise<
  {
    userId: number | null;
    fullName: string;
    email: string;
    phone: string;
    designation: string;
    role: string;
  }[]
> {
  await ensureBaselineData();
  const [userRows, staffRows, otherRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(
        and(
          eq(users.status, 'approved'),
          or(
            eq(users.role, 'class_advisor'),
            eq(users.role, 'dept_staff'),
            eq(users.role, 'other_dept_staff'),
            eq(users.role, 'hod')
          )
        )
      ),
    db.select().from(departmentStaff),
    db.select().from(otherDepartmentStaff),
  ]);

  const byNormName = new Map<
    string,
    {
      userId: number | null;
      fullName: string;
      email: string;
      phone: string;
      designation: string;
      role: string;
    }
  >();

  for (const s of staffRows) {
    byNormName.set(normalizeFacultyMatchKey(s.fullName), {
      userId: null,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      designation: s.designation,
      role: s.isClassAdvisor ? 'class_advisor' : 'dept_staff',
    });
  }
  for (const o of otherRows) {
    const k = normalizeFacultyMatchKey(o.fullName);
    if (!byNormName.has(k)) {
      byNormName.set(k, {
        userId: null,
        fullName: o.fullName,
        email: o.email,
        phone: o.phone,
        designation: o.designation,
        role: 'other_dept_staff',
      });
    }
  }
  for (const u of userRows) {
    const k = normalizeFacultyMatchKey(u.fullName);
    const prev = byNormName.get(k);
    byNormName.set(k, {
      userId: u.id,
      fullName: u.fullName,
      email: u.email || prev?.email || '',
      phone: u.phone || prev?.phone || '',
      designation: prev?.designation || 'Faculty Member',
      role: u.role,
    });
  }

  return Array.from(byNormName.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function createFacultyAlterationRequest(params: {
  timetableSlotId: number | null;
  alterationDate: string;
  substituteFacultyName: string;
  substituteUserId?: number | null;
  substituteEmail?: string;
  substitutePhone?: string;
  reasonCategory: 'busy' | 'od' | 'absent';
  reasonNote: string;
  user: UserProfile;
  departmentFallback: string;
  dayFallback: string;
  periodFallback: number;
  subjectCodeFallback: string;
  subjectNameFallback: string;
  yearFallback: string;
  sectionFallback: string;
  roomFallback: string;
}): Promise<FacultyAlterationItem> {
  await ensureBaselineData();

  let slot: typeof timetableSlots.$inferSelect | null = null;
  if (params.timetableSlotId) {
    const found = await db
      .select()
      .from(timetableSlots)
      .where(eq(timetableSlots.id, params.timetableSlotId))
      .limit(1);
    slot = found[0] ?? null;
  }

  const candidates = await listSubstituteCandidates();
  const subMatch =
    candidates.find((c) => params.substituteUserId && c.userId === params.substituteUserId) ??
    candidates.find(
      (c) =>
        normalizeFacultyMatchKey(c.fullName) ===
        normalizeFacultyMatchKey(params.substituteFacultyName)
    );

  const [created] = await db
    .insert(facultyAlterations)
    .values({
      department: slot?.department || params.departmentFallback,
      yearOfStudy: slot?.yearOfStudy || params.yearFallback || 'III Year',
      section: (slot?.section || params.sectionFallback || 'A').toUpperCase(),
      dayOfWeek: slot?.dayOfWeek || params.dayFallback,
      periodNumber: slot?.periodNumber || params.periodFallback || 1,
      alterationDate: params.alterationDate,
      timetableSlotId: slot?.id ?? null,
      subjectCode: (slot?.subjectCode || params.subjectCodeFallback || 'CLASS').toUpperCase(),
      subjectName: slot?.subjectName || params.subjectNameFallback || 'Scheduled Class',
      roomNo: slot?.roomNo || params.roomFallback || '',
      requestingUserId: params.user.id,
      requestingFacultyName: slot?.facultyName || params.user.fullName,
      substituteUserId: subMatch?.userId ?? params.substituteUserId ?? null,
      substituteFacultyName: subMatch?.fullName || params.substituteFacultyName.trim(),
      substituteEmail: subMatch?.email || params.substituteEmail || '',
      substitutePhone: subMatch?.phone || params.substitutePhone || '',
      reasonCategory: params.reasonCategory,
      reasonNote: params.reasonNote.trim().slice(0, 300),
      status: 'pending_hod',
    })
    .returning();

  return mapFacultyAlterationRow(created);
}

export async function listFacultyAlterationsForUser(
  user: UserProfile
): Promise<FacultyAlterationItem[]> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(facultyAlterations)
    .orderBy(desc(facultyAlterations.id))
    .limit(120);
  const mapped = rows.map(mapFacultyAlterationRow);
  if (user.role === 'hod' || user.role === 'class_advisor') {
    return mapped;
  }
  const userNorm = normalizeFacultyMatchKey(user.fullName);
  return mapped.filter((a) => {
    if (a.requestingUserId === user.id || a.substituteUserId === user.id) return true;
    const reqNorm = normalizeFacultyMatchKey(a.requestingFacultyName);
    const subNorm = normalizeFacultyMatchKey(a.substituteFacultyName);
    if (userNorm && (reqNorm === userNorm || subNorm === userNorm)) return true;
    if ((user.role === 'student' || user.role === 'class_rep') && a.status === 'approved') {
      return !user.yearOfStudy || !a.yearOfStudy || a.yearOfStudy === user.yearOfStudy;
    }
    return false;
  });
}

export async function decideFacultyAlteration(params: {
  id: number;
  reviewer: UserProfile;
  decision: 'approve' | 'reject';
  remarks: string;
}): Promise<FacultyAlterationItem | null> {
  await ensureBaselineData();
  const status = params.decision === 'approve' ? 'approved' : 'rejected';
  const [updated] = await db
    .update(facultyAlterations)
    .set({
      status,
      hodReviewedBy: params.reviewer.fullName,
      hodRemarks: params.remarks.trim().slice(0, 300),
      hodReviewedAt: new Date(),
    })
    .where(eq(facultyAlterations.id, params.id))
    .returning();
  return updated ? mapFacultyAlterationRow(updated) : null;
}

// ============================================================
// HOD Biometric Photo Unlock Governance (Students, Faculty & HOD)
// ============================================================
const BIOMETRIC_UNLOCK_REQUESTS_KEY = 'biometric_unlock_requests_json';

export async function listBiometricUnlockRequests(): Promise<
  import('../types.ts').BiometricUnlockRequestItem[]
> {
  await ensureBaselineData();
  const raw = await getSetting(BIOMETRIC_UNLOCK_REQUESTS_KEY, '[]');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveBiometricUnlockRequests(
  items: import('../types.ts').BiometricUnlockRequestItem[]
): Promise<void> {
  await setSetting(BIOMETRIC_UNLOCK_REQUESTS_KEY, JSON.stringify(items.slice(0, 200)));
}

export async function listUsersBiometricLockStatus(): Promise<
  import('../types.ts').BiometricLockUserSummary[]
> {
  await ensureBaselineData();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.status, 'approved'))
    .orderBy(asc(users.role), asc(users.fullName));
  const enriched = await enrichUsersWithMeta(rows);
  return enriched.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    staffOrRollId: u.staffOrRollId || '',
    department: u.department,
    profileImageData: u.profileImageData || '',
    faceRegisteredLocked: Boolean(u.faceRegisteredLocked),
    faceRegisteredAt: u.faceRegisteredAt ?? null,
  }));
}

export async function createBiometricUnlockRequest(params: {
  user: UserProfile;
  reason: string;
}): Promise<import('../types.ts').BiometricUnlockRequestItem> {
  const current = await listBiometricUnlockRequests();
  const existingPending = current.find(
    (r) => r.userId === params.user.id && r.status === 'pending'
  );
  if (existingPending) {
    existingPending.reason = params.reason.trim().slice(0, 240) || existingPending.reason;
    existingPending.requestedAt = formatTs(new Date());
    await saveBiometricUnlockRequests(current);
    return existingPending;
  }

  const item: import('../types.ts').BiometricUnlockRequestItem = {
    id: `bu_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    userId: params.user.id,
    fullName: params.user.fullName,
    email: params.user.email,
    role: params.user.role,
    staffOrRollId: params.user.staffOrRollId || '',
    department: params.user.department,
    reason: params.reason.trim().slice(0, 240) || 'Requesting permission to retake biometric photo',
    status: 'pending',
    requestedAt: formatTs(new Date()),
  };
  await saveBiometricUnlockRequests([item, ...current]);
  return item;
}

export async function setUserBiometricLockInDb(params: {
  targetUserId: number;
  locked: boolean;
  hodName: string;
  remarks?: string;
}): Promise<UserProfile> {
  await ensureBaselineData();
  const target = await findUserWithMetaById(params.targetUserId);
  if (!target) {
    const err = new Error('Target user account not found.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const existingMeta = await db
    .select()
    .from(userProfileMeta)
    .where(eq(userProfileMeta.userId, params.targetUserId))
    .limit(1);
  const cur = existingMeta[0];

  const lockedAt = params.locked
    ? cur?.faceRegisteredAt || target.faceRegisteredAt || formatTs(new Date())
    : '';

  await db
    .insert(userProfileMeta)
    .values({
      userId: params.targetUserId,
      profileImageData: cur?.profileImageData || target.profileImageData || '',
      faceRegisteredLocked: params.locked,
      faceRegisteredAt: lockedAt,
      designation: cur?.designation ?? target.designation ?? '',
      specialization: cur?.specialization ?? target.specialization ?? '',
      bio: cur?.bio ?? target.bio ?? '',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfileMeta.userId,
      set: {
        profileImageData: cur?.profileImageData || target.profileImageData || '',
        faceRegisteredLocked: params.locked,
        faceRegisteredAt: lockedAt,
        updatedAt: new Date(),
      },
    });

  // When HOD unlocks a user, automatically approve any pending unlock requests for that user
  if (!params.locked) {
    const reqs = await listBiometricUnlockRequests();
    let changed = false;
    const nowTs = formatTs(new Date());
    const updatedReqs = reqs.map((r) => {
      if (r.userId === params.targetUserId && r.status === 'pending') {
        changed = true;
        return {
          ...r,
          status: 'approved' as const,
          hodReviewedBy: params.hodName,
          hodRemarks: (params.remarks || 'Unlocked by HOD for biometric photo retake').slice(0, 240),
          hodReviewedAt: nowTs,
        };
      }
      return r;
    });
    if (changed) {
      await saveBiometricUnlockRequests(updatedReqs);
    }
  }

  const refreshed = await findUserWithMetaById(params.targetUserId);
  if (!refreshed) throw new Error('Unable to reload user after biometric lock change.');
  return refreshed;
}

export async function decideBiometricUnlockRequestInDb(params: {
  requestId: string;
  decision: 'approve' | 'reject';
  hodName: string;
  remarks?: string;
}): Promise<{
  request: import('../types.ts').BiometricUnlockRequestItem;
  user: UserProfile | null;
}> {
  const reqs = await listBiometricUnlockRequests();
  const targetReq = reqs.find((r) => r.id === params.requestId);
  if (!targetReq) {
    const err = new Error('Biometric unlock request not found.');
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }

  const nowTs = formatTs(new Date());
  const nextStatus = params.decision === 'approve' ? 'approved' : 'rejected';
  let updatedUser: UserProfile | null = null;

  if (params.decision === 'approve') {
    updatedUser = await setUserBiometricLockInDb({
      targetUserId: targetReq.userId,
      locked: false,
      hodName: params.hodName,
      remarks: params.remarks,
    });
  }

  const latestReqs = await listBiometricUnlockRequests();
  const updatedReqs = latestReqs.map((r) =>
    r.id === params.requestId
      ? {
          ...r,
          status: nextStatus as 'approved' | 'rejected',
          hodReviewedBy: params.hodName,
          hodRemarks: (params.remarks || '').trim().slice(0, 240),
          hodReviewedAt: nowTs,
        }
      : r
  );
  await saveBiometricUnlockRequests(updatedReqs);

  const finalReq = updatedReqs.find((r) => r.id === params.requestId)!;
  return { request: finalReq, user: updatedUser };
}



