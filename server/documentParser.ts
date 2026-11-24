import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { ParsedPreviewResponse, UploadModule } from '../src/types.ts';
import { ACADEMIC_PERIODS } from './serverTime.ts';

const DAY_ORDER: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const YEAR_ORDER: Record<string, number> = {
  'i year': 1,
  '1st year': 1,
  '1': 1,
  'ii year': 2,
  '2nd year': 2,
  '2': 2,
  'iii year': 3,
  '3rd year': 3,
  '3': 3,
  'iv year': 4,
  '4th year': 4,
  '4': 4,
};

function cleanHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickField(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const key = cleanHeader(alias);
    if (row[key] !== undefined && String(row[key]).trim() !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function normalizeYear(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return 'III Year';
  if (v === '1' || v.startsWith('1st') || v === 'i' || v === 'i year') return 'I Year';
  if (v === '2' || v.startsWith('2nd') || v === 'ii' || v === 'ii year') return 'II Year';
  if (v === '3' || v.startsWith('3rd') || v === 'iii' || v === 'iii year') return 'III Year';
  if (v === '4' || v.startsWith('4th') || v === 'iv' || v === 'iv year') return 'IV Year';
  return raw.trim();
}

function normalizeDay(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (v.startsWith('mon')) return 'Monday';
  if (v.startsWith('tue')) return 'Tuesday';
  if (v.startsWith('wed')) return 'Wednesday';
  if (v.startsWith('thu')) return 'Thursday';
  if (v.startsWith('fri')) return 'Friday';
  if (v.startsWith('sat')) return 'Saturday';
  return 'Monday';
}

function toBool(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return ['yes', 'true', '1', 'cr', 'y', 'advisor', 'class rep', 'class representative'].includes(v);
}

function parseLinesToMatrix(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('---') && !l.startsWith('==='));

  const rows: string[][] = [];
  for (const line of lines) {
    let cells: string[];
    if (line.includes('|')) {
      cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c, i, arr) => !(c === '' && (i === 0 || i === arr.length - 1)));
    } else if (line.includes('\t')) {
      cells = line.split('\t').map((c) => c.trim());
    } else if (line.includes(',')) {
      cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    } else if (/\s{2,}/.test(line)) {
      cells = line.split(/\s{2,}/).map((c) => c.trim());
    } else {
      continue;
    }
    if (cells.length >= 2) {
      rows.push(cells);
    }
  }
  return rows;
}

function extractHtmlTableMatrix(html: string): string[][] {
  const rows: string[][] = [];
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi);
  if (!trMatches) return rows;

  for (const tr of trMatches) {
    const cellMatches = tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi);
    if (!cellMatches) continue;
    const cells = cellMatches.map((cell) =>
      cell
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (cells.some((c) => c.length > 0)) {
      rows.push(cells);
    }
  }
  return rows;
}

function matrixToNormalizedRows(matrix: string[][]): Record<string, string>[] {
  if (matrix.length < 2) return [];
  // Find best header row (first row with >= 2 non-empty cells that looks like headers)
  let headerIndex = 0;
  for (let i = 0; i < Math.min(matrix.length, 5); i++) {
    const joined = matrix[i].join(' ').toLowerCase();
    if (
      joined.includes('name') ||
      joined.includes('roll') ||
      joined.includes('employee') ||
      joined.includes('subject') ||
      joined.includes('period') ||
      joined.includes('faculty')
    ) {
      headerIndex = i;
      break;
    }
  }

  const headers = matrix[headerIndex].map((h) => cleanHeader(String(h ?? '')));
  const results: Record<string, string>[] = [];

  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const rowCells = matrix[i];
    if (!rowCells || rowCells.every((c) => String(c ?? '').trim() === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      if (headers[c]) {
        obj[headers[c]] = String(rowCells[c] ?? '').trim();
      }
    }
    results.push(obj);
  }
  return results;
}

function cellValueToString(val: ExcelJS.CellValue): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return String(val).trim();
  }
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    if ('text' in val && typeof val.text === 'string') return val.text.trim();
    if ('result' in val && val.result !== undefined && val.result !== null) {
      return String(val.result).trim();
    }
    if ('richText' in val && Array.isArray(val.richText)) {
      return val.richText.map((rt) => rt.text).join('').trim();
    }
  }
  return String(val).trim();
}

function parseCsvMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

async function extractRawRows(
  buffer: Buffer,
  fileType: string
): Promise<Record<string, string>[]> {
  if (fileType === 'csv') {
    return matrixToNormalizedRows(parseCsvMatrix(buffer.toString('utf8')));
  }

  if (fileType === 'xlsx') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const matrix: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      const colCount = row.cellCount;
      for (let c = 1; c <= colCount; c++) {
        vals.push(cellValueToString(row.getCell(c).value));
      }
      if (vals.some((v) => v.length > 0)) {
        matrix.push(vals);
      }
    });
    return matrixToNormalizedRows(matrix);
  }

  if (fileType === 'xls') {
    // Attempt xlsx loader first (some .xls exports are OOXML), then fallback to HTML table or delimited text
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        const matrix: string[][] = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          for (let c = 1; c <= row.cellCount; c++) {
            vals.push(cellValueToString(row.getCell(c).value));
          }
          if (vals.some((v) => v.length > 0)) matrix.push(vals);
        });
        if (matrix.length >= 2) return matrixToNormalizedRows(matrix);
      }
    } catch {
      // Fallback to HTML table or TSV/CSV text inside legacy .xls
    }
    const text = buffer.toString('utf8');
    const htmlMatrix = extractHtmlTableMatrix(text);
    if (htmlMatrix.length >= 2) return matrixToNormalizedRows(htmlMatrix);
    const cleaned = text.replace(/[^\x20-\x7E\r\n\t|,-]/g, ' ');
    return matrixToNormalizedRows(parseLinesToMatrix(cleaned));
  }

  if (fileType === 'docx') {
    const htmlRes = await mammoth.convertToHtml({ buffer });
    const tableMatrix = extractHtmlTableMatrix(htmlRes.value);
    if (tableMatrix.length >= 2) {
      return matrixToNormalizedRows(tableMatrix);
    }
    const rawRes = await mammoth.extractRawText({ buffer });
    const lineMatrix = parseLinesToMatrix(rawRes.value);
    return matrixToNormalizedRows(lineMatrix);
  }

  if (fileType === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const textResult = await parser.getText();
      const lineMatrix = parseLinesToMatrix(textResult.text || '');
      return matrixToNormalizedRows(lineMatrix);
    } finally {
      await parser.destroy();
    }
  }

  // Legacy .doc fallback (UTF-8 / ASCII lines)
  const text = buffer.toString('utf8').replace(/[^\x20-\x7E\r\n\t|,-]/g, ' ');
  return matrixToNormalizedRows(parseLinesToMatrix(text));
}

export async function parseUploadedDocument(
  buffer: Buffer,
  originalFilename: string,
  targetModule: UploadModule,
  defaultDepartment: string
): Promise<ParsedPreviewResponse> {
  const ext = (originalFilename.split('.').pop() || '').toLowerCase();
  const allowed = ['xlsx', 'xls', 'csv', 'pdf', 'docx', 'doc'];
  if (!allowed.includes(ext)) {
    throw new Error('Only structured document files (.xlsx, .xls, .pdf, .docx, .doc, .csv) are accepted.');
  }

  const rawRows = await extractRawRows(buffer, ext);
  const warnings: string[] = [];
  const validRows: Record<string, string | number | boolean>[] = [];

  if (rawRows.length === 0) {
    warnings.push(
      'No structured tabular rows were detected in this document. Download a sample template for this module to match column headers.'
    );
  }

  if (targetModule === 'department_students' || targetModule === 'class_representatives') {
    const forceCr = targetModule === 'class_representatives';
    rawRows.forEach((r, idx) => {
      const rollNo = pickField(r, ['rollno', 'registerno', 'regno', 'register_number', 'studentid', 'id']);
      const fullName = pickField(r, ['fullname', 'studentname', 'name', 'crname']);
      if (!rollNo || !fullName) {
        warnings.push(`Row ${idx + 2}: Skipped (missing Roll No or Full Name).`);
        return;
      }
      const isClassRep = forceCr
        ? true
        : toBool(pickField(r, ['isclassrep', 'classrep', 'cr', 'role', 'representative']));
      validRows.push({
        rollNo: rollNo.toUpperCase(),
        fullName,
        email: pickField(r, ['email', 'emailid', 'mail']) || `${rollNo.toLowerCase()}@chromagrade.edu`,
        department: pickField(r, ['department', 'dept']) || defaultDepartment,
        yearOfStudy: normalizeYear(pickField(r, ['yearofstudy', 'year', 'class'])),
        section: (pickField(r, ['section', 'sec']) || 'A').toUpperCase(),
        phone: pickField(r, ['phone', 'mobile', 'contact']),
        isClassRep,
        crResponsibility:
          pickField(r, ['crresponsibility', 'responsibility', 'duty', 'duties']) ||
          (isClassRep ? 'Class Academic Coordination' : ''),
        advisorName: pickField(r, ['advisorname', 'classadvisor', 'advisor']),
        cgpa: pickField(r, ['cgpa', 'gpa', 'grade']),
      });
    });

    validRows.sort((a, b) => {
      const yA = YEAR_ORDER[String(a.yearOfStudy).toLowerCase()] ?? 9;
      const yB = YEAR_ORDER[String(b.yearOfStudy).toLowerCase()] ?? 9;
      if (yA !== yB) return yA - yB;
      const secCmp = String(a.section).localeCompare(String(b.section));
      if (secCmp !== 0) return secCmp;
      return String(a.rollNo).localeCompare(String(b.rollNo));
    });

    return {
      targetModule,
      originalFilename,
      fileType: ext,
      totalRows: rawRows.length,
      validRows,
      warnings,
      columns: [
        'rollNo',
        'fullName',
        'yearOfStudy',
        'section',
        'email',
        'phone',
        'isClassRep',
        'crResponsibility',
        'advisorName',
        'cgpa',
      ],
    };
  }

  if (targetModule === 'department_staff') {
    rawRows.forEach((r, idx) => {
      const employeeId = pickField(r, ['employeeid', 'staffid', 'facultyid', 'empid', 'id']);
      const fullName = pickField(r, ['fullname', 'staffname', 'facultyname', 'name']);
      if (!employeeId || !fullName) {
        warnings.push(`Row ${idx + 2}: Skipped (missing Employee ID or Full Name).`);
        return;
      }
      const advisingClass = pickField(r, ['advisingclass', 'assignedclass', 'classadvising', 'class']);
      const isClassAdvisor =
        toBool(pickField(r, ['isclassadvisor', 'classadvisor', 'advisor'])) || advisingClass.length > 0;
      validRows.push({
        employeeId: employeeId.toUpperCase(),
        fullName,
        email: pickField(r, ['email', 'emailid', 'mail']) || `${employeeId.toLowerCase()}@chromagrade.edu`,
        department: pickField(r, ['department', 'dept']) || defaultDepartment,
        designation: pickField(r, ['designation', 'title', 'position']) || 'Assistant Professor',
        specialization: pickField(r, ['specialization', 'domain', 'area', 'subject']),
        phone: pickField(r, ['phone', 'mobile', 'contact']),
        isClassAdvisor,
        advisingClass,
      });
    });

    validRows.sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId)));

    return {
      targetModule,
      originalFilename,
      fileType: ext,
      totalRows: rawRows.length,
      validRows,
      warnings,
      columns: [
        'employeeId',
        'fullName',
        'designation',
        'specialization',
        'email',
        'phone',
        'isClassAdvisor',
        'advisingClass',
      ],
    };
  }

  if (targetModule === 'other_department_staff') {
    rawRows.forEach((r, idx) => {
      const employeeId = pickField(r, ['employeeid', 'staffid', 'facultyid', 'empid', 'id']);
      const fullName = pickField(r, ['fullname', 'staffname', 'facultyname', 'name']);
      if (!employeeId || !fullName) {
        warnings.push(`Row ${idx + 2}: Skipped (missing Employee ID or Full Name).`);
        return;
      }
      validRows.push({
        employeeId: employeeId.toUpperCase(),
        fullName,
        email: pickField(r, ['email', 'emailid', 'mail']) || `${employeeId.toLowerCase()}@chromagrade.edu`,
        homeDepartment:
          pickField(r, ['homedepartment', 'parentdepartment', 'department', 'dept']) || 'Allied Department',
        handlingSubject:
          pickField(r, ['handlingsubject', 'subject', 'course', 'coursename']) || 'Allied Engineering Course',
        designation: pickField(r, ['designation', 'title', 'position']) || 'Assistant Professor',
        phone: pickField(r, ['phone', 'mobile', 'contact']),
        visitingDays: pickField(r, ['visitingdays', 'days', 'schedule']) || 'Mon, Wed',
      });
    });

    validRows.sort((a, b) => {
      const dCmp = String(a.homeDepartment).localeCompare(String(b.homeDepartment));
      if (dCmp !== 0) return dCmp;
      return String(a.employeeId).localeCompare(String(b.employeeId));
    });

    return {
      targetModule,
      originalFilename,
      fileType: ext,
      totalRows: rawRows.length,
      validRows,
      warnings,
      columns: [
        'employeeId',
        'fullName',
        'homeDepartment',
        'handlingSubject',
        'designation',
        'visitingDays',
        'email',
        'phone',
      ],
    };
  }

  // Timetable
  rawRows.forEach((r, idx) => {
    const dayRaw = pickField(r, ['dayofweek', 'day', 'weekday']);
    const periodRaw = pickField(r, ['periodnumber', 'period', 'hour', 'slot']);
    const subjectName = pickField(r, ['subjectname', 'subject', 'course', 'coursename']);
    const facultyName = pickField(r, ['facultyname', 'faculty', 'staff', 'instructor']);
    const periodNumber = Math.max(1, Math.min(8, Number.parseInt(periodRaw, 10) || 0));

    if (!dayRaw || !periodNumber || !subjectName || !facultyName) {
      warnings.push(`Row ${idx + 2}: Skipped (requires Day, Period 1-8, Subject Name, and Faculty Name).`);
      return;
    }

    const periodWindow = ACADEMIC_PERIODS.find((p) => p.periodNumber === periodNumber) ?? ACADEMIC_PERIODS[0];
    const fTypeRaw = pickField(r, ['facultytype', 'stafftype', 'type']).toLowerCase();
    const facultyType =
      fTypeRaw.includes('other') || fTypeRaw.includes('visit') || fTypeRaw.includes('external')
        ? 'other_department'
        : 'department';

    validRows.push({
      department: pickField(r, ['department', 'dept']) || defaultDepartment,
      yearOfStudy: normalizeYear(pickField(r, ['yearofstudy', 'year', 'class'])),
      section: (pickField(r, ['section', 'sec']) || 'A').toUpperCase(),
      dayOfWeek: normalizeDay(dayRaw),
      periodNumber,
      startTime: pickField(r, ['starttime', 'start', 'from']) || periodWindow.startTime,
      endTime: pickField(r, ['endtime', 'end', 'to']) || periodWindow.endTime,
      subjectCode: (pickField(r, ['subjectcode', 'coursecode', 'code']) || `CS350${periodNumber}`).toUpperCase(),
      subjectName,
      facultyName,
      facultyType,
      roomNo: pickField(r, ['roomno', 'room', 'hall', 'lab']) || 'CSE-301',
    });
  });

  validRows.sort((a, b) => {
    const dA = DAY_ORDER[String(a.dayOfWeek).toLowerCase()] ?? 9;
    const dB = DAY_ORDER[String(b.dayOfWeek).toLowerCase()] ?? 9;
    if (dA !== dB) return dA - dB;
    return Number(a.periodNumber) - Number(b.periodNumber);
  });

  return {
    targetModule,
    originalFilename,
    fileType: ext,
    totalRows: rawRows.length,
    validRows,
    warnings,
    columns: [
      'yearOfStudy',
      'section',
      'dayOfWeek',
      'periodNumber',
      'startTime',
      'endTime',
      'subjectCode',
      'subjectName',
      'facultyName',
      'facultyType',
      'roomNo',
    ],
  };
}

export function getTemplateRows(module: UploadModule): string[][] {
  switch (module) {
    case 'department_students':
      return [
        ['Roll No', 'Full Name', 'Email', 'Department', 'Year', 'Section', 'Phone', 'Is Class Rep', 'CR Responsibility', 'Advisor Name', 'CGPA'],
        ['22CSE006', 'Farhan Ahamed', 'farhan.22cse@chromagrade.edu', 'Computer Science & Engineering', 'III Year', 'A', '+91 97901 10006', 'No', '', 'Prof. Arvind Narayanan', '8.74'],
        ['22CSE007', 'Gayathri Mohan', 'gayathri.22cse@chromagrade.edu', 'Computer Science & Engineering', 'III Year', 'A', '+91 97901 10007', 'No', '', 'Prof. Arvind Narayanan', '9.08'],
      ];
    case 'class_representatives':
      return [
        ['Roll No', 'Full Name', 'Email', 'Year', 'Section', 'Phone', 'CR Responsibility', 'Advisor Name', 'CGPA'],
        ['23CSE015', 'Nithin Subash', 'nithin.23cse@chromagrade.edu', 'II Year', 'A', '+91 97901 20015', 'II Year A Co-Representative & Lab Roster', 'Dr. Rajeshwari Krishnan', '9.02'],
        ['21CSE014', 'Priyanka Devi', 'priyanka.21cse@chromagrade.edu', 'IV Year', 'A', '+91 97901 30014', 'IV Year A Academic & Symposium Coordinator', 'Prof. Deepika Ramanathan', '9.18'],
      ];
    case 'department_staff':
      return [
        ['Employee ID', 'Full Name', 'Email', 'Department', 'Designation', 'Specialization', 'Phone', 'Is Class Advisor', 'Advising Class'],
        ['CSE-FAC-107', 'Dr. Senthilkumar P', 'senthil.p@chromagrade.edu', 'Computer Science & Engineering', 'Professor', 'Cybersecurity & Forensics', '+91 98401 22107', 'No', ''],
        ['CSE-FAC-108', 'Prof. Revathi Natarajan', 'revathi.n@chromagrade.edu', 'Computer Science & Engineering', 'Assistant Professor', 'Software Engineering', '+91 98401 22108', 'Yes', 'II Year - B'],
      ];
    case 'other_department_staff':
      return [
        ['Employee ID', 'Full Name', 'Email', 'Home Department', 'Handling Subject', 'Designation', 'Phone', 'Visiting Days'],
        ['MAT-FAC-209', 'Prof. Raghuraman V', 'raghuraman.mat@chromagrade.edu', 'Mathematics', 'Discrete Structures & Graph Theory', 'Associate Professor', '+91 98402 33109', 'Tue, Thu, Sat'],
        ['ENG-FAC-144', 'Prof. Shalini George', 'shalini.eng@chromagrade.edu', 'English & Communication', 'Technical Writing & Presentation', 'Assistant Professor', '+91 98402 33110', 'Mon, Fri'],
      ];
    case 'timetable':
      return [
        ['Year', 'Section', 'Day', 'Period', 'Start Time', 'End Time', 'Subject Code', 'Subject Name', 'Faculty Name', 'Faculty Type', 'Room No'],
        ['III Year', 'B', 'Monday', '1', '08:45', '09:35', 'CS3505', 'Compiler Design', 'Prof. Meenakshi Sundaram', 'department', 'CSE-302'],
        ['III Year', 'B', 'Monday', '2', '09:35', '10:25', 'MA3502', 'Probability & Queueing Theory', 'Dr. Srinivasamurthy R', 'other_department', 'CSE-302'],
        ['III Year', 'B', 'Monday', '3', '10:40', '11:30', 'CS3501', 'Machine Learning', 'Prof. Arvind Narayanan', 'department', 'CSE-302'],
      ];
  }
}

export async function buildXlsxTemplateBuffer(module: UploadModule): Promise<Buffer> {
  const rows = getTemplateRows(module);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Records');
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function buildCsvTemplateBuffer(module: UploadModule): Buffer {
  const rows = getTemplateRows(module);
  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  return Buffer.from(csv, 'utf8');
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildPdfTemplateBuffer(module: UploadModule): Buffer {
  const rows = getTemplateRows(module);
  const lines = rows.map((r) => r.join(' | '));

  const streamCommands = [
    'BT',
    '/F1 8 Tf',
    '30 760 Td',
    '14 TL',
    ...lines.map((line, i) => (i === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`)),
    'ET',
  ].join('\n');

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamCommands, 'utf8')} >>\nstream\n${streamCommands}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

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
