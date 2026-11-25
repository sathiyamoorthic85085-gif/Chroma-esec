import ExcelJS from 'exceljs';
import type { AttendanceRecordItem, BatchComparisonPayload } from '../src/types.ts';

export interface AttendanceExportMeta {
  departmentName: string;
  attendanceDate: string;
  scopeLabel: string;
  generatedAt: string;
}

function neutralizeCsvCell(value: unknown): string {
  const raw = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildAttendanceCsvBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta
): Buffer {
  const headers = [
    'Date',
    'Day',
    'Period',
    'Subject Code',
    'Subject Name',
    'Room',
    'Year',
    'Section',
    'Role',
    'ID / Roll No',
    'Full Name',
    'Status',
    'Face Verified',
    'Face Confidence (%)',
    'Environment Verified',
    'Environment Label',
    'Verification Summary',
    'Marked By',
    'Server Timestamp',
  ];

  const rows: string[] = [
    headers.map(neutralizeCsvCell).join(','),
    ...records.map((r) =>
      [
        r.attendanceDate || meta.attendanceDate,
        r.dayOfWeek,
        `P${r.periodNumber}`,
        r.subjectCode,
        r.subjectName,
        r.roomNo,
        r.yearOfStudy,
        r.section,
        r.personType === 'faculty' ? 'Department Faculty' : 'Student',
        r.personIdentifier,
        r.personName,
        r.status === 'present' ? 'Present' : r.status === 'late' ? 'Late' : 'Rejected',
        r.faceDetected ? 'Yes' : 'No',
        r.faceConfidence,
        r.environmentVerified ? 'Yes' : 'No',
        r.environmentLabel,
        r.verificationSummary,
        r.markedByName,
        r.serverTimestamp,
      ]
        .map(neutralizeCsvCell)
        .join(',')
    ),
  ];

  // UTF-8 BOM ensures Microsoft Excel opens international names cleanly
  return Buffer.from('\uFEFF' + rows.join('\r\n') + '\r\n', 'utf8');
}

function sanitizePdfAscii(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00B7/g, '|')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfString(value: string): string {
  return sanitizePdfAscii(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function fitText(value: string, maxChars: number): string {
  const clean = sanitizePdfAscii(value);
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, Math.max(1, maxChars - 3)) + '...';
}

interface PdfColumn {
  label: string;
  x: number;
  maxChars: number;
}

const PDF_COLUMNS: PdfColumn[] = [
  { label: 'ID / Roll No', x: 36, maxChars: 14 },
  { label: 'Name', x: 118, maxChars: 22 },
  { label: 'Role', x: 244, maxChars: 10 },
  { label: 'Period & Subject', x: 302, maxChars: 26 },
  { label: 'Room', x: 454, maxChars: 11 },
  { label: 'Face Check', x: 522, maxChars: 15 },
  { label: 'Environment', x: 608, maxChars: 18 },
  { label: 'Status', x: 710, maxChars: 10 },
  { label: 'Timestamp', x: 766, maxChars: 11 },
];

export function buildAttendancePdfBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta
): Buffer {
  // A4 Landscape: 842 x 595 pt
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 36;
  const rowsPerPage = 24;

  const totalCount = records.length;
  const presentCount = records.filter((r) => r.status === 'present').length;
  const rejectedCount = records.filter((r) => r.status === 'rejected').length;
  const studentCount = records.filter((r) => r.personType === 'student').length;
  const facultyCount = records.filter((r) => r.personType === 'faculty').length;

  const chunks: AttendanceRecordItem[][] = [];
  if (records.length === 0) {
    chunks.push([]);
  } else {
    for (let i = 0; i < records.length; i += rowsPerPage) {
      chunks.push(records.slice(i, i + rowsPerPage));
    }
  }

  const totalPages = chunks.length;
  const pageStreams: string[] = [];

  chunks.forEach((chunk, pageIndex) => {
    const cmds: string[] = [];

    // Header band line & typography
    cmds.push('0.12 0.16 0.24 rg');
    cmds.push('BT /F2 15 Tf 36 554 Td (ChromaGrade - Daily Timetable Attendance Register) Tj ET');

    cmds.push('0.32 0.37 0.45 rg');
    const subline = `${meta.departmentName}  |  Date: ${meta.attendanceDate}  |  Scope: ${meta.scopeLabel}`;
    cmds.push(`BT /F1 9 Tf 36 538 Td (${escapePdfString(fitText(subline, 125))}) Tj ET`);

    const summaryLine = `Total Records: ${totalCount}  |  Present: ${presentCount}  |  Rejected: ${rejectedCount}  |  Students: ${studentCount}  |  Faculty: ${facultyCount}  |  Exported: ${meta.generatedAt}`;
    cmds.push(`BT /F1 8.5 Tf 36 523 Td (${escapePdfString(fitText(summaryLine, 130))}) Tj ET`);

    // Divider line
    cmds.push('0.80 0.84 0.89 RG 0.8 w 36 513 m 806 513 l S');

    // Table header background
    cmds.push('0.95 0.96 0.98 rg 36 490 770 18 re f');
    cmds.push('0.20 0.25 0.33 rg');
    for (const col of PDF_COLUMNS) {
      cmds.push(`BT /F2 8 Tf ${col.x} 496 Td (${escapePdfString(col.label)}) Tj ET`);
    }
    cmds.push('0.80 0.84 0.89 RG 0.6 w 36 490 m 806 490 l S');

    // Table body
    if (chunk.length === 0) {
      cmds.push('0.40 0.45 0.53 rg');
      cmds.push(
        `BT /F1 9.5 Tf 36 468 Td (${escapePdfString(
          `No daily attendance logs recorded for ${meta.attendanceDate} (${meta.scopeLabel}).`
        )}) Tj ET`
      );
    } else {
      let y = 474;
      chunk.forEach((rec, idx) => {
        if (idx % 2 === 1) {
          cmds.push(`0.98 0.985 0.995 rg 36 ${y - 4} 770 16 re f`);
        }

        const timeMatch = rec.serverTimestamp.match(/(\d{2}:\d{2}(?::\d{2})?)/);
        const shortTime = timeMatch ? timeMatch[1] : rec.createdAt.slice(11, 19);

        const cells = [
          rec.personIdentifier,
          rec.personName,
          rec.personType === 'faculty' ? 'Faculty' : 'Student',
          `P${rec.periodNumber} ${rec.subjectCode} - ${rec.subjectName}`,
          rec.roomNo || '-',
          rec.faceDetected ? `Verified (${rec.faceConfidence}%)` : 'Not Detected',
          rec.environmentLabel || (rec.environmentVerified ? 'Verified' : 'Unverified'),
          rec.status === 'present' ? 'Present' : rec.status === 'late' ? 'Late' : 'Rejected',
          shortTime,
        ];

        cells.forEach((cellVal, colIdx) => {
          const col = PDF_COLUMNS[colIdx];
          if (colIdx === 7) {
            if (rec.status === 'present') cmds.push('0.04 0.47 0.29 rg');
            else cmds.push('0.72 0.14 0.16 rg');
          } else {
            cmds.push('0.12 0.16 0.24 rg');
          }
          const font = colIdx === 0 || colIdx === 7 ? '/F2' : '/F1';
          cmds.push(
            `BT ${font} 7.8 Tf ${col.x} ${y} Td (${escapePdfString(fitText(cellVal, col.maxChars))}) Tj ET`
          );
        });

        cmds.push(`0.91 0.93 0.95 RG 0.4 w 36 ${y - 4} m 806 ${y - 4} l S`);
        y -= 17;
      });
    }

    // Footer
    cmds.push('0.80 0.84 0.89 RG 0.6 w 36 42 m 806 42 l S');
    cmds.push('0.42 0.47 0.55 rg');
    cmds.push(
      `BT /F1 8 Tf ${marginX} 28 Td (${escapePdfString(
        'ChromaGrade Academic Attendance Record - Dual-Camera Verified Register'
      )}) Tj ET`
    );
    cmds.push(
      `BT /F1 8 Tf ${pageWidth - 96} 28 Td (${escapePdfString(
        `Page ${pageIndex + 1} of ${totalPages}`
      )}) Tj ET`
    );

    pageStreams.push(cmds.join('\n'));
  });

  // Assemble multi-page PDF objects cleanly
  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Helvetica Regular, Obj 4: Helvetica Bold
  // Pages start at Obj 5 (pair: Page obj + Content stream obj)
  const objects: string[] = [];
  const pageObjectIds: number[] = [];

  for (let i = 0; i < pageStreams.length; i++) {
    pageObjectIds.push(5 + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  );
  objects.push(
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n'
  );

  pageStreams.forEach((stream, i) => {
    const pageObjId = 5 + i * 2;
    const contentObjId = pageObjId + 1;
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

interface MonthlyIndividualSummary {
  personIdentifier: string;
  personName: string;
  personType: 'student' | 'faculty';
  department: string;
  yearOfStudy: string;
  section: string;
  presentSessions: number;
  lateSessions: number;
  rejectedSessions: number;
  totalSessions: number;
  activeDays: number;
  attendanceRate: number;
}

function aggregateMonthlyIndividuals(records: AttendanceRecordItem[]): MonthlyIndividualSummary[] {
  const map = new Map<
    string,
    {
      personIdentifier: string;
      personName: string;
      personType: 'student' | 'faculty';
      department: string;
      yearOfStudy: string;
      section: string;
      presentSessions: number;
      lateSessions: number;
      rejectedSessions: number;
      daysSet: Set<string>;
    }
  >();

  for (const r of records) {
    const key = `${r.personType}::${r.personIdentifier}`;
    const entry = map.get(key) ?? {
      personIdentifier: r.personIdentifier,
      personName: r.personName,
      personType: r.personType,
      department: r.department,
      yearOfStudy: r.yearOfStudy,
      section: r.section,
      presentSessions: 0,
      lateSessions: 0,
      rejectedSessions: 0,
      daysSet: new Set<string>(),
    };

    if (r.status === 'present') {
      entry.presentSessions += 1;
      entry.daysSet.add(r.attendanceDate);
    } else if (r.status === 'late') {
      entry.lateSessions += 1;
      entry.daysSet.add(r.attendanceDate);
    } else {
      entry.rejectedSessions += 1;
    }
    map.set(key, entry);
  }

  return Array.from(map.values())
    .map((e) => {
      const totalSessions = e.presentSessions + e.lateSessions + e.rejectedSessions;
      const verified = e.presentSessions + e.lateSessions;
      return {
        personIdentifier: e.personIdentifier,
        personName: e.personName,
        personType: e.personType,
        department: e.department,
        yearOfStudy: e.yearOfStudy,
        section: e.section,
        presentSessions: e.presentSessions,
        lateSessions: e.lateSessions,
        rejectedSessions: e.rejectedSessions,
        totalSessions,
        activeDays: e.daysSet.size,
        attendanceRate: totalSessions > 0 ? Math.round((verified / totalSessions) * 100) : 0,
      };
    })
    .sort((a, b) => a.personIdentifier.localeCompare(b.personIdentifier));
}

export function buildMonthlySummaryCsvBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta & { monthLabel: string }
): Buffer {
  const summaries = aggregateMonthlyIndividuals(records);
  const totalPresent = records.filter((r) => r.status === 'present' || r.status === 'late').length;
  const totalRejected = records.filter((r) => r.status === 'rejected').length;
  const uniqueDates = new Set(records.map((r) => r.attendanceDate)).size;

  const lines: string[] = [
    ['ChromaGrade Monthly Attendance Summary', meta.monthLabel, meta.departmentName, meta.scopeLabel, `Generated: ${meta.generatedAt}`]
      .map(neutralizeCsvCell)
      .join(','),
    ['Summary Totals', `Individuals: ${summaries.length}`, `Active Days: ${uniqueDates}`, `Verified Present: ${totalPresent}`, `Rejected: ${totalRejected}`, `Total Logs: ${records.length}`]
      .map(neutralizeCsvCell)
      .join(','),
    '',
    [
      'ID / Roll No',
      'Full Name',
      'Role',
      'Department',
      'Year',
      'Section',
      'Days Present',
      'Present Sessions',
      'Late Sessions',
      'Rejected Sessions',
      'Total Sessions',
      'Verification Rate (%)',
    ]
      .map(neutralizeCsvCell)
      .join(','),
    ...summaries.map((s) =>
      [
        s.personIdentifier,
        s.personName,
        s.personType === 'faculty' ? 'Department Faculty' : 'Student',
        s.department,
        s.yearOfStudy,
        s.section,
        s.activeDays,
        s.presentSessions,
        s.lateSessions,
        s.rejectedSessions,
        s.totalSessions,
        `${s.attendanceRate}%`,
      ]
        .map(neutralizeCsvCell)
        .join(',')
    ),
  ];

  // Append Day-by-Day Summary Section
  const dayBuckets = new Map<string, { present: number; rejected: number; students: number; faculty: number }>();
  for (const r of records) {
    const b = dayBuckets.get(r.attendanceDate) ?? { present: 0, rejected: 0, students: 0, faculty: 0 };
    if (r.status === 'present' || r.status === 'late') {
      b.present += 1;
      if (r.personType === 'student') b.students += 1;
      else b.faculty += 1;
    } else {
      b.rejected += 1;
    }
    dayBuckets.set(r.attendanceDate, b);
  }

  lines.push('');
  lines.push(['Daily Breakdown', 'Students Present', 'Faculty Present', 'Total Verified', 'Rejected', 'Total Logs'].map(neutralizeCsvCell).join(','));
  for (const [date, b] of Array.from(dayBuckets.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push([date, b.students, b.faculty, b.present, b.rejected, b.present + b.rejected].map(neutralizeCsvCell).join(','));
  }

  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
}

const MONTHLY_PDF_COLUMNS: PdfColumn[] = [
  { label: 'ID / Roll No', x: 36, maxChars: 15 },
  { label: 'Full Name', x: 122, maxChars: 26 },
  { label: 'Role', x: 268, maxChars: 10 },
  { label: 'Class', x: 332, maxChars: 15 },
  { label: 'Days Present', x: 428, maxChars: 12 },
  { label: 'Verified', x: 508, maxChars: 10 },
  { label: 'Rejected', x: 578, maxChars: 10 },
  { label: 'Total Logs', x: 648, maxChars: 10 },
  { label: 'Rate (%)', x: 724, maxChars: 10 },
];

export function buildMonthlySummaryPdfBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta & { monthLabel: string }
): Buffer {
  const pageWidth = 842;
  const pageHeight = 595;
  const marginX = 36;
  const rowsPerPage = 24;

  const summaries = aggregateMonthlyIndividuals(records);
  const totalPresent = records.filter((r) => r.status === 'present' || r.status === 'late').length;
  const totalRejected = records.filter((r) => r.status === 'rejected').length;
  const activeDays = new Set(records.map((r) => r.attendanceDate)).size;
  const overallRate = records.length > 0 ? Math.round((totalPresent / records.length) * 100) : 0;

  const chunks: MonthlyIndividualSummary[][] = [];
  if (summaries.length === 0) {
    chunks.push([]);
  } else {
    for (let i = 0; i < summaries.length; i += rowsPerPage) {
      chunks.push(summaries.slice(i, i + rowsPerPage));
    }
  }

  const totalPages = chunks.length;
  const pageStreams: string[] = [];

  chunks.forEach((chunk, pageIndex) => {
    const cmds: string[] = [];

    cmds.push('0.12 0.16 0.24 rg');
    cmds.push(`BT /F2 15 Tf 36 554 Td (${escapePdfString(`ChromaGrade - Monthly Attendance Summary (${meta.monthLabel})`)}) Tj ET`);

    cmds.push('0.32 0.37 0.45 rg');
    const subline = `${meta.departmentName}  |  Month: ${meta.monthLabel}  |  Scope: ${meta.scopeLabel}`;
    cmds.push(`BT /F1 9 Tf 36 538 Td (${escapePdfString(fitText(subline, 125))}) Tj ET`);

    const summaryLine = `Individuals: ${summaries.length}  |  Active Days: ${activeDays}  |  Verified Present: ${totalPresent}  |  Rejected: ${totalRejected}  |  Overall Rate: ${overallRate}%  |  Exported: ${meta.generatedAt}`;
    cmds.push(`BT /F1 8.5 Tf 36 523 Td (${escapePdfString(fitText(summaryLine, 132))}) Tj ET`);

    cmds.push('0.80 0.84 0.89 RG 0.8 w 36 513 m 806 513 l S');

    cmds.push('0.95 0.96 0.98 rg 36 490 770 18 re f');
    cmds.push('0.20 0.25 0.33 rg');
    for (const col of MONTHLY_PDF_COLUMNS) {
      cmds.push(`BT /F2 8 Tf ${col.x} 496 Td (${escapePdfString(col.label)}) Tj ET`);
    }
    cmds.push('0.80 0.84 0.89 RG 0.6 w 36 490 m 806 490 l S');

    if (chunk.length === 0) {
      cmds.push('0.40 0.45 0.53 rg');
      cmds.push(
        `BT /F1 9.5 Tf 36 468 Td (${escapePdfString(
          `No attendance logs recorded for ${meta.monthLabel} (${meta.scopeLabel}).`
        )}) Tj ET`
      );
    } else {
      let y = 474;
      chunk.forEach((row, idx) => {
        if (idx % 2 === 1) {
          cmds.push(`0.98 0.985 0.995 rg 36 ${y - 4} 770 16 re f`);
        }

        const classLabel = row.yearOfStudy
          ? `${row.yearOfStudy}${row.section ? ` ${row.section}` : ''}`
          : '-';

        const cells = [
          row.personIdentifier,
          row.personName,
          row.personType === 'faculty' ? 'Faculty' : 'Student',
          classLabel,
          String(row.activeDays),
          String(row.presentSessions + row.lateSessions),
          String(row.rejectedSessions),
          String(row.totalSessions),
          `${row.attendanceRate}%`,
        ];

        cells.forEach((cellVal, colIdx) => {
          const col = MONTHLY_PDF_COLUMNS[colIdx];
          if (colIdx === 8) {
            if (row.attendanceRate >= 75) cmds.push('0.04 0.47 0.29 rg');
            else cmds.push('0.72 0.14 0.16 rg');
          } else {
            cmds.push('0.12 0.16 0.24 rg');
          }
          const font = colIdx === 0 || colIdx === 8 ? '/F2' : '/F1';
          cmds.push(
            `BT ${font} 8 Tf ${col.x} ${y} Td (${escapePdfString(fitText(cellVal, col.maxChars))}) Tj ET`
          );
        });

        cmds.push(`0.91 0.93 0.95 RG 0.4 w 36 ${y - 4} m 806 ${y - 4} l S`);
        y -= 17;
      });
    }

    cmds.push('0.80 0.84 0.89 RG 0.6 w 36 42 m 806 42 l S');
    cmds.push('0.42 0.47 0.55 rg');
    cmds.push(
      `BT /F1 8 Tf ${marginX} 28 Td (${escapePdfString(
        'ChromaGrade Monthly Attendance Summary - Dual-Camera Verified Register'
      )}) Tj ET`
    );
    cmds.push(
      `BT /F1 8 Tf ${pageWidth - 96} 28 Td (${escapePdfString(
        `Page ${pageIndex + 1} of ${totalPages}`
      )}) Tj ET`
    );

    pageStreams.push(cmds.join('\n'));
  });

  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  for (let i = 0; i < pageStreams.length; i++) {
    pageObjectIds.push(5 + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>\nendobj\n`
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  pageStreams.forEach((stream, i) => {
    const pageObjId = 5 + i * 2;
    const contentObjId = pageObjId + 1;
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

export async function buildAttendanceXlsxBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ChromaGrade';
  wb.created = new Date();
  const ws = wb.addWorksheet('Daily Attendance');

  ws.addRow([
    `ChromaGrade Daily Attendance Register — ${meta.departmentName}`,
  ]);
  ws.addRow([
    `Date: ${meta.attendanceDate}`,
    `Scope: ${meta.scopeLabel}`,
    `Generated: ${meta.generatedAt}`,
  ]);
  ws.addRow([]);

  const headerRow = ws.addRow([
    'Date',
    'Day',
    'Period',
    'Subject Code',
    'Subject Name',
    'Room',
    'Year',
    'Section',
    'Role',
    'ID / Roll No',
    'Full Name',
    'Status',
    'Face Verified',
    'Face Confidence (%)',
    'Environment Verified',
    'Environment Label',
    'Verification Summary',
    'Marked By',
    'Server Timestamp',
  ]);
  headerRow.font = { bold: true };

  for (const r of records) {
    ws.addRow([
      r.attendanceDate || meta.attendanceDate,
      r.dayOfWeek,
      `P${r.periodNumber}`,
      r.subjectCode,
      r.subjectName,
      r.roomNo,
      r.yearOfStudy,
      r.section,
      r.personType === 'faculty' ? 'Department Faculty' : 'Student',
      r.personIdentifier,
      r.personName,
      r.status.toUpperCase(),
      r.faceDetected ? 'Yes' : 'No',
      r.faceConfidence,
      r.environmentVerified ? 'Yes' : 'No',
      r.environmentLabel,
      r.verificationSummary,
      r.markedByName,
      r.serverTimestamp,
    ]);
  }

  ws.columns.forEach((col) => {
    col.width = 18;
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function buildMonthlySummaryXlsxBuffer(
  records: AttendanceRecordItem[],
  meta: AttendanceExportMeta & { monthLabel: string }
): Promise<Buffer> {
  const summaries = aggregateMonthlyIndividuals(records);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ChromaGrade';
  wb.created = new Date();
  const ws = wb.addWorksheet('Monthly Summary');

  ws.addRow([`ChromaGrade Monthly Attendance Summary — ${meta.monthLabel}`]);
  ws.addRow([
    `Department: ${meta.departmentName}`,
    `Scope: ${meta.scopeLabel}`,
    `Generated: ${meta.generatedAt}`,
  ]);
  ws.addRow([]);

  const headerRow = ws.addRow([
    'ID / Roll No',
    'Full Name',
    'Role',
    'Department',
    'Year',
    'Section',
    'Days Present',
    'Present Sessions',
    'Late Sessions',
    'Rejected Sessions',
    'Total Sessions',
    'Verification Rate (%)',
  ]);
  headerRow.font = { bold: true };

  for (const s of summaries) {
    ws.addRow([
      s.personIdentifier,
      s.personName,
      s.personType === 'faculty' ? 'Department Faculty' : 'Student',
      s.department,
      s.yearOfStudy,
      s.section,
      s.activeDays,
      s.presentSessions,
      s.lateSessions,
      s.rejectedSessions,
      s.totalSessions,
      s.attendanceRate,
    ]);
  }

  ws.columns.forEach((col) => {
    col.width = 18;
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildBatchComparisonPdfBuffer(
  payload: BatchComparisonPayload,
  generatedAt: string
): Buffer {
  const pageWidth = 842;
  const pageHeight = 595;
  const cmds: string[] = [];

  cmds.push('0.12 0.16 0.24 rg');
  cmds.push(
    `BT /F2 15 Tf 36 554 Td (${escapePdfString(
      `ChromaGrade - Batch Comparison Summary Report (${payload.batchA.batchLabel} vs ${payload.batchB.batchLabel})`
    )}) Tj ET`
  );

  cmds.push('0.32 0.37 0.45 rg');
  cmds.push(
    `BT /F1 9 Tf 36 536 Td (${escapePdfString(
      `${payload.departmentName}  |  Exported: ${generatedAt}`
    )}) Tj ET`
  );
  cmds.push('0.80 0.84 0.89 RG 0.8 w 36 524 m 806 524 l S');

  // Side-by-side summary table
  cmds.push('0.95 0.96 0.98 rg 36 498 770 20 re f');
  cmds.push('0.18 0.22 0.30 rg');
  cmds.push('BT /F2 9 Tf 44 505 Td (Comparison Dimension) Tj ET');
  cmds.push(`BT /F2 9 Tf 300 505 Td (${escapePdfString(fitText(payload.batchA.batchLabel, 24))}) Tj ET`);
  cmds.push(`BT /F2 9 Tf 540 505 Td (${escapePdfString(fitText(payload.batchB.batchLabel, 24))}) Tj ET`);

  const rows: [string, string, string][] = [
    ['Enrolled Students', String(payload.batchA.studentCount), String(payload.batchB.studentCount)],
    [
      'Average Attendance Rate',
      `${payload.batchA.averageAttendanceRate.toFixed(1)}%`,
      `${payload.batchB.averageAttendanceRate.toFixed(1)}%`,
    ],
    [
      'Composite Engagement Score',
      `${payload.batchA.academicEngagementScore.toFixed(1)} / 100`,
      `${payload.batchB.academicEngagementScore.toFixed(1)} / 100`,
    ],
    [
      'Average CGPA',
      payload.batchA.averageCgpa !== null ? payload.batchA.averageCgpa.toFixed(2) : '-',
      payload.batchB.averageCgpa !== null ? payload.batchB.averageCgpa.toFixed(2) : '-',
    ],
    [
      'Portal & Chat Activity',
      `${payload.batchA.portalParticipationRate}%`,
      `${payload.batchB.portalParticipationRate}%`,
    ],
    [
      'Achievement Badges Awarded',
      String(payload.batchA.badgesCount),
      String(payload.batchB.badgesCount),
    ],
    [
      'Standing',
      payload.batchA.standing,
      payload.batchB.standing,
    ],
    [
      '4-Wk Predictive Risk Status',
      payload.predictiveRisk.batchA.atPredictiveRisk ? 'RISK ALERT' : 'Stable',
      payload.predictiveRisk.batchB.atPredictiveRisk ? 'RISK ALERT' : 'Stable',
    ],
  ];

  let y = 478;
  rows.forEach(([label, valA, valB], idx) => {
    if (idx % 2 === 1) {
      cmds.push(`0.98 0.985 0.995 rg 36 ${y - 4} 770 18 re f`);
    }
    cmds.push('0.15 0.20 0.28 rg');
    cmds.push(`BT /F2 8.5 Tf 44 ${y} Td (${escapePdfString(label)}) Tj ET`);
    cmds.push(`BT /F1 8.5 Tf 300 ${y} Td (${escapePdfString(valA)}) Tj ET`);
    cmds.push(`BT /F1 8.5 Tf 540 ${y} Td (${escapePdfString(valB)}) Tj ET`);
    cmds.push(`0.91 0.93 0.95 RG 0.4 w 36 ${y - 4} m 806 ${y - 4} l S`);
    y -= 22;
  });

  // 4-Week History + 2-Week Linear Regression Projection section
  y -= 14;
  cmds.push('0.12 0.16 0.24 rg');
  cmds.push(
    `BT /F2 10.5 Tf 36 ${y} Td (Weekly Attendance & 2-Week Linear Regression Forecast) Tj ET`
  );
  y -= 20;
  cmds.push(`0.95 0.96 0.98 rg 36 ${y - 4} 770 18 re f`);
  cmds.push('0.20 0.25 0.33 rg');
  cmds.push(`BT /F2 8.5 Tf 44 ${y} Td (Week Window) Tj ET`);
  cmds.push(`BT /F2 8.5 Tf 240 ${y} Td (Type) Tj ET`);
  cmds.push(`BT /F2 8.5 Tf 400 ${y} Td (${escapePdfString(fitText(payload.batchA.batchLabel, 22))}) Tj ET`);
  cmds.push(`BT /F2 8.5 Tf 600 ${y} Td (${escapePdfString(fitText(payload.batchB.batchLabel, 22))}) Tj ET`);
  y -= 20;

  for (const pt of payload.weeklySeries) {
    const valA = pt.isProjection
      ? `${pt.batchAProjected ?? 0}% (Projected)`
      : `${pt.batchAAttendance ?? 0}%`;
    const valB = pt.isProjection
      ? `${pt.batchBProjected ?? 0}% (Projected)`
      : `${pt.batchBAttendance ?? 0}%`;
    cmds.push('0.15 0.20 0.28 rg');
    cmds.push(`BT /F1 8.5 Tf 44 ${y} Td (${escapePdfString(pt.weekLabel)}) Tj ET`);
    cmds.push(
      `BT /F1 8.5 Tf 240 ${y} Td (${escapePdfString(
        pt.isProjection ? 'Regression Forecast' : 'Recorded'
      )}) Tj ET`
    );
    cmds.push(`BT /F1 8.5 Tf 400 ${y} Td (${escapePdfString(valA)}) Tj ET`);
    cmds.push(`BT /F1 8.5 Tf 600 ${y} Td (${escapePdfString(valB)}) Tj ET`);
    cmds.push(`0.91 0.93 0.95 RG 0.4 w 36 ${y - 4} m 806 ${y - 4} l S`);
    y -= 18;
  }

  cmds.push('0.80 0.84 0.89 RG 0.6 w 36 42 m 806 42 l S');
  cmds.push('0.42 0.47 0.55 rg');
  cmds.push(
    'BT /F1 8 Tf 36 28 Td (ChromaGrade Batch Comparison & Predictive Analytics Report) Tj ET'
  );
  cmds.push(`BT /F1 8 Tf ${pageWidth - 96} 28 Td (Page 1 of 1) Tj ET`);

  const stream = cmds.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [5 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 6 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`,
    `6 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}


