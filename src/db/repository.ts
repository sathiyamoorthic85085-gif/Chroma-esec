import crypto from 'crypto';
import { and, asc, desc, eq, gt, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import type {
  ActivePowerBoostAlert,
  AttendancePersonType,
  AttendanceRecordItem,
  ChatAttachmentPayload,
  ChatAttachmentType,
  ChatMessageItem,
  CommunityCategory,
  CommunityGroupItem,
  CommunityItem,
  DeduplicateReport,
  DepartmentStaff,
  DepartmentStudent,
  EmailIntimation,
  OtherDepartmentStaff,
  PowerBoostAcknowledgementItem,
  PowerBoostEngagementSummary,
  PowerBoostMessageStatItem,
  TimetableSlot,
  UploadBatch,
  UploadModule,
  UserProfile,
  UserRole,
} from '../types.ts';
import { db } from './index.ts';
import {
  appSettings,
  attendanceRecords,
  chatMessages,
  communities,
  communityGroups,
  communityMembers,
  departmentStaff,
  departmentStudents,
  emailIntimations,
  messageAcknowledgements,
  otherDepartmentStaff,
  sessions,
  timetableSlots,
  uploadBatches,
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
  };
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

export async function syncFirebaseUserToDb(params: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<UserProfile> {
  try {
    await ensureBaselineData();
    const emailLower = params.email.trim().toLowerCase();
    const deptName = await getSetting('department_name', 'Computer Science & Engineering');

    const byUid = await findUserByUid(params.uid);
    if (byUid) {
      if (byUid.email !== emailLower) {
        const [updated] = await db
          .update(users)
          .set({ email: emailLower })
          .where(eq(users.id, byUid.id))
          .returning();
        return mapUser(updated);
      }
      return mapUser(byUid);
    }

    const byEmail = await findUserByEmail(emailLower);
    if (byEmail) {
      const [linked] = await db
        .update(users)
        .set({ uid: params.uid })
        .where(eq(users.id, byEmail.id))
        .returning();
      return mapUser(linked);
    }

    // If no HOD exists yet, grant HOD role to first Google Sign-In administrator
    const hodCount = await getHodCount();
    const isInitialHod = hodCount === 0;

    const [created] = await db
      .insert(users)
      .values({
        uid: params.uid,
        fullName: params.displayName?.trim() || emailLower.split('@')[0],
        email: emailLower,
        role: isInitialHod ? 'hod' : 'student',
        department: deptName,
        staffOrRollId: isInitialHod ? 'HOD-001' : '',
        status: isInitialHod ? 'approved' : 'pending',
        approvedBy: isInitialHod ? 'Google Workspace Setup' : null,
        approvedAt: isInitialHod ? formatTs(new Date()) : null,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { uid: params.uid },
      })
      .returning();

    return mapUser(created);
  } catch (error) {
    console.error('Failed to sync Firebase user:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
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
    return rows[0] ? mapUser(rows[0].user) : null;
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
export async function listDepartmentStudents(): Promise<DepartmentStudent[]> {
  try {
    await ensureBaselineData();
    const rows = await db
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
      );

    return rows.map(({ student, sourceFilename }) => ({
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
    }));
  } catch (error) {
    console.error('Failed to list students:', error);
    throw new Error('Unable to load student records.', { cause: error });
  }
}

export async function listDepartmentStaff(): Promise<DepartmentStaff[]> {
  try {
    await ensureBaselineData();
    const rows = await db
      .select({
        staff: departmentStaff,
        sourceFilename: uploadBatches.originalFilename,
      })
      .from(departmentStaff)
      .leftJoin(uploadBatches, eq(departmentStaff.sourceBatchId, uploadBatches.id))
      .orderBy(asc(departmentStaff.employeeId));

    return rows.map(({ staff, sourceFilename }) => ({
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
    }));
  } catch (error) {
    console.error('Failed to list department staff:', error);
    throw new Error('Unable to load department staff.', { cause: error });
  }
}

export async function listOtherDepartmentStaff(): Promise<OtherDepartmentStaff[]> {
  try {
    await ensureBaselineData();
    const rows = await db
      .select({
        staff: otherDepartmentStaff,
        sourceFilename: uploadBatches.originalFilename,
      })
      .from(otherDepartmentStaff)
      .leftJoin(uploadBatches, eq(otherDepartmentStaff.sourceBatchId, uploadBatches.id))
      .orderBy(asc(otherDepartmentStaff.homeDepartment), asc(otherDepartmentStaff.employeeId));

    return rows.map(({ staff, sourceFilename }) => ({
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
    }));
  } catch (error) {
    console.error('Failed to list other department staff:', error);
    throw new Error('Unable to load other department staff.', { cause: error });
  }
}

export async function listTimetableSlots(): Promise<TimetableSlot[]> {
  try {
    await ensureBaselineData();
    const rows = await db
      .select()
      .from(timetableSlots)
      .orderBy(
        asc(timetableSlots.yearOfStudy),
        asc(timetableSlots.section),
        asc(timetableSlots.dayOfWeek),
        asc(timetableSlots.periodNumber)
      );

    return rows.map((r) => ({
      id: r.id,
      department: r.department,
      yearOfStudy: r.yearOfStudy,
      section: r.section,
      dayOfWeek: r.dayOfWeek,
      periodNumber: r.periodNumber,
      startTime: r.startTime,
      endTime: r.endTime,
      subjectCode: r.subjectCode,
      subjectName: r.subjectName,
      facultyName: r.facultyName,
      facultyType: r.facultyType as 'department' | 'other_department',
      roomNo: r.roomNo,
      sourceBatchId: r.sourceBatchId ?? null,
      createdAt: formatTs(r.createdAt),
    }));
  } catch (error) {
    console.error('Failed to list timetable slots:', error);
    throw new Error('Unable to load timetable records.', { cause: error });
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
        for (const r of params.rows) {
          const dept = String(r.department ?? params.defaultDepartment).trim();
          const yearOfStudy = String(r.yearOfStudy ?? 'III Year').trim();
          const section = String(r.section ?? 'A').trim().toUpperCase();
          const dayOfWeek = String(r.dayOfWeek ?? 'Monday').trim();
          const periodNumber = Number(r.periodNumber ?? 1);
          const subjectName = String(r.subjectName ?? '').trim();
          const facultyName = String(r.facultyName ?? '').trim();
          const key = `${dept}|${yearOfStudy}|${section}|${dayOfWeek}|${periodNumber}`;
          if (!subjectName || !facultyName || seenKeys.has(key)) continue;
          seenKeys.add(key);

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
  return ['hod', 'class_advisor', 'dept_staff', 'other_dept_staff', 'class_rep'].includes(role);
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

export function mapChatMessageRow(
  m: typeof chatMessages.$inferSelect,
  acknowledgements: PowerBoostAcknowledgementItem[] = [],
  viewerUserId?: number
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
  };
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
    const ackMap = new Map<number, PowerBoostAcknowledgementItem[]>();

    if (msgIds.length > 0) {
      const ackRows = await db
        .select()
        .from(messageAcknowledgements)
        .where(inArray(messageAcknowledgements.messageId, msgIds))
        .orderBy(asc(messageAcknowledgements.acknowledgedAt));

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

    return rows.map((m) => mapChatMessageRow(m, ackMap.get(m.id) ?? [], viewerUserId));
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

    return mapChatMessageRow(inserted, [], params.user.id);
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
  status: 'present' | 'late' | 'rejected';
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

    const order: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    return rows
      .map(mapUser)
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
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
