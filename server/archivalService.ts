import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  getArchivalSnapshotData,
  getSetting,
  listArchivalLogs,
  recordArchivalLog,
} from '../src/db/repository.ts';
import type { ArchivalRecordSummary } from '../src/types.ts';
import { computeServerTimeStatus } from './serverTime.ts';

function resolveArchiveRootDir(): string {
  const configured = process.env.ARCHIVE_STORAGE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), 'archives', 'daily');
}

export async function runDailyDepartmentArchival(
  triggerType: 'scheduled' | 'manual' = 'scheduled'
): Promise<ArchivalRecordSummary> {
  const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
  const dept = await getSetting('department_name', 'Computer Science & Engineering');
  const serverTime = computeServerTimeStatus(tz, dept);
  const archiveDate = serverTime.isoDate;

  const snapshot = await getArchivalSnapshotData(archiveDate);
  const archiveRoot = resolveArchiveRootDir();
  const dayDir = path.join(archiveRoot, archiveDate);
  fs.mkdirSync(dayDir, { recursive: true });

  const jsonContent = JSON.stringify(snapshot, null, 2);
  const jsonFilePath = path.join(dayDir, `chromagrade_backup_${archiveDate}.json`);
  fs.writeFileSync(jsonFilePath, jsonContent, 'utf8');

  const csvLines = [
    'Date,Period,Subject,Year,Section,PersonType,Identifier,Name,Status,ServerTimestamp',
    ...snapshot.attendance.map((r) =>
      [
        r.attendanceDate,
        r.periodNumber,
        r.subjectCode,
        r.yearOfStudy,
        r.section,
        r.personType,
        r.personIdentifier,
        r.personName,
        r.status,
        r.serverTimestamp,
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];
  const csvFilePath = path.join(dayDir, `attendance_logs_${archiveDate}.csv`);
  fs.writeFileSync(csvFilePath, '\uFEFF' + csvLines.join('\r\n') + '\r\n', 'utf8');

  const checksumSha256 = crypto.createHash('sha256').update(jsonContent).digest('hex');
  const storagePath = `cloud-vault://${path.basename(archiveRoot)}/${archiveDate}/chromagrade_backup_${archiveDate}.json`;

  return recordArchivalLog({
    archiveDate,
    storagePath,
    attendanceCount: snapshot.attendanceCount,
    studentsCount: snapshot.studentsCount,
    checksumSha256,
    triggerType,
    status: 'completed',
  });
}

let archivalTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyArchivalScheduler(): void {
  if (archivalTimer) return;

  const checkAndRun = async () => {
    try {
      const tz = await getSetting('academic_timezone', 'Asia/Kolkata');
      const dept = await getSetting('department_name', 'Computer Science & Engineering');
      const todayIso = computeServerTimeStatus(tz, dept).isoDate;
      const logs = await listArchivalLogs();
      const alreadyDoneToday = logs.some(
        (l) => l.archiveDate === todayIso && l.status === 'completed'
      );
      if (!alreadyDoneToday) {
        await runDailyDepartmentArchival('scheduled');
      }
    } catch (err) {
      console.error('Automated daily archival background tick skipped:', err);
    }
  };

  // Run initial check 20s after boot so startup latency is untouched, then every 6 hours
  setTimeout(() => {
    void checkAndRun();
  }, 20000);
  archivalTimer = setInterval(() => {
    void checkAndRun();
  }, 6 * 60 * 60 * 1000);
}
