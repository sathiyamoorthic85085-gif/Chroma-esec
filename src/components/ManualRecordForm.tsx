import { type FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Plus, Save, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { MODULE_LABELS, type UploadModule } from '../types';

interface ManualRecordFormProps {
  token: string;
  targetModule: UploadModule;
  defaultDepartment?: string;
  onCommitted: () => Promise<void>;
  onClose?: () => void;
  compact?: boolean;
}

type ManualRow = Record<string, string | number | boolean>;

const YEAR_OPTIONS = ['I Year', 'II Year', 'III Year', 'IV Year'];
const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PERIOD_DEFAULTS: Record<number, { start: string; end: string }> = {
  1: { start: '08:45', end: '09:35' },
  2: { start: '09:35', end: '10:25' },
  3: { start: '10:40', end: '11:30' },
  4: { start: '11:30', end: '12:20' },
  5: { start: '13:15', end: '14:05' },
  6: { start: '14:05', end: '14:55' },
  7: { start: '15:05', end: '15:55' },
  8: { start: '15:55', end: '16:45' },
  9: { start: '16:45', end: '17:35' },
  10: { start: '17:35', end: '18:25' },
  11: { start: '18:25', end: '19:15' },
  12: { start: '19:15', end: '20:05' },
};

export function ManualRecordForm({
  token,
  targetModule,
  defaultDepartment = 'Computer Science & Engineering',
  onCommitted,
  onClose,
  compact = false,
}: ManualRecordFormProps) {
  // Student & CR fields
  const [rollNo, setRollNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState(defaultDepartment);
  const [yearOfStudy, setYearOfStudy] = useState('III Year');
  const [customYear, setCustomYear] = useState('');
  const [section, setSection] = useState('A');
  const [phone, setPhone] = useState('');
  const [isClassRep, setIsClassRep] = useState(targetModule === 'class_representatives');
  const [crResponsibility, setCrResponsibility] = useState('');
  const [advisorName, setAdvisorName] = useState('');
  const [cgpa, setCgpa] = useState('');

  // Staff fields (home & other dept)
  const [employeeId, setEmployeeId] = useState('');
  const [designation, setDesignation] = useState('Assistant Professor');
  const [specialization, setSpecialization] = useState('');
  const [isClassAdvisor, setIsClassAdvisor] = useState(false);
  const [advisingClass, setAdvisingClass] = useState('');
  const [homeDepartment, setHomeDepartment] = useState('');
  const [handlingSubject, setHandlingSubject] = useState('');
  const [visitingDays, setVisitingDays] = useState('Mon, Wed, Fri');

  // Timetable fields
  const [dayOfWeek, setDayOfWeek] = useState('Monday');
  const [periodNumber, setPeriodNumber] = useState(1);
  const [startTime, setStartTime] = useState(PERIOD_DEFAULTS[1].start);
  const [endTime, setEndTime] = useState(PERIOD_DEFAULTS[1].end);
  const [subjectCode, setSubjectCode] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [facultyName, setFacultyName] = useState('');
  const [facultyType, setFacultyType] = useState<'department' | 'other_department'>('department');
  const [roomNo, setRoomNo] = useState('');

  // Staging queue & submission state
  const [stagedRows, setStagedRows] = useState<ManualRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setStagedRows([]);
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsClassRep(targetModule === 'class_representatives');
  }, [targetModule]);

  const handlePeriodChange = (num: number) => {
    setPeriodNumber(num);
    const def = PERIOD_DEFAULTS[num];
    if (def) {
      setStartTime(def.start);
      setEndTime(def.end);
    }
  };

  const resetInputs = () => {
    setRollNo('');
    setFullName('');
    setEmail('');
    setPhone('');
    setCrResponsibility('');
    setAdvisorName('');
    setCgpa('');
    setEmployeeId('');
    setSpecialization('');
    setIsClassAdvisor(false);
    setAdvisingClass('');
    setHomeDepartment('');
    setHandlingSubject('');
    setSubjectCode('');
    setSubjectName('');
    setFacultyName('');
    setRoomNo('');
  };

  const buildCurrentRow = (): ManualRow | null => {
    setErrorMsg(null);
    const resolvedYear = yearOfStudy === 'CUSTOM' ? customYear.trim() || 'III Year' : yearOfStudy;
    const resolvedSection = section.trim().toUpperCase() || 'A';

    if (targetModule === 'department_students' || targetModule === 'class_representatives') {
      const cleanRoll = rollNo.trim().toUpperCase();
      const cleanName = fullName.trim();
      if (!cleanRoll || !cleanName) {
        setErrorMsg('Roll No and Full Name are required.');
        return null;
      }
      return {
        rollNo: cleanRoll,
        fullName: cleanName,
        email: email.trim().toLowerCase(),
        department: department.trim() || defaultDepartment,
        yearOfStudy: resolvedYear,
        section: resolvedSection,
        phone: phone.trim(),
        isClassRep: targetModule === 'class_representatives' ? true : isClassRep,
        crResponsibility:
          targetModule === 'class_representatives' || isClassRep
            ? crResponsibility.trim() || `${resolvedYear} ${resolvedSection} Class Representative`
            : '',
        advisorName: advisorName.trim(),
        cgpa: cgpa.trim(),
      };
    }

    if (targetModule === 'department_staff') {
      const cleanEmpId = employeeId.trim().toUpperCase();
      const cleanName = fullName.trim();
      if (!cleanEmpId || !cleanName) {
        setErrorMsg('Employee ID and Full Name are required.');
        return null;
      }
      return {
        employeeId: cleanEmpId,
        fullName: cleanName,
        email: email.trim().toLowerCase(),
        department: department.trim() || defaultDepartment,
        designation: designation.trim() || 'Assistant Professor',
        specialization: specialization.trim(),
        phone: phone.trim(),
        isClassAdvisor,
        advisingClass: isClassAdvisor ? advisingClass.trim() : '',
      };
    }

    if (targetModule === 'other_department_staff') {
      const cleanEmpId = employeeId.trim().toUpperCase();
      const cleanName = fullName.trim();
      const cleanHome = homeDepartment.trim();
      if (!cleanEmpId || !cleanName || !cleanHome) {
        setErrorMsg('Employee ID, Full Name, and Home Department are required.');
        return null;
      }
      return {
        employeeId: cleanEmpId,
        fullName: cleanName,
        email: email.trim().toLowerCase(),
        homeDepartment: cleanHome,
        handlingSubject: handlingSubject.trim(),
        designation: designation.trim() || 'Assistant Professor',
        phone: phone.trim(),
        visitingDays: visitingDays.trim(),
      };
    }

    // Timetable slot
    const cleanSubject = subjectName.trim();
    const cleanFaculty = facultyName.trim();
    if (!cleanSubject || !cleanFaculty) {
      setErrorMsg('Subject Name and Faculty Name are required for a timetable slot.');
      return null;
    }
    return {
      department: department.trim() || defaultDepartment,
      yearOfStudy: resolvedYear,
      section: resolvedSection,
      dayOfWeek,
      periodNumber,
      startTime: startTime.trim() || PERIOD_DEFAULTS[periodNumber]?.start || '08:45',
      endTime: endTime.trim() || PERIOD_DEFAULTS[periodNumber]?.end || '09:35',
      subjectCode: (subjectCode.trim() || `CS350${periodNumber}`).toUpperCase(),
      subjectName: cleanSubject,
      facultyName: cleanFaculty,
      facultyType,
      roomNo: roomNo.trim() || 'CSE-301',
    };
  };

  const commitRows = async (rowsToSave: ManualRow[]) => {
    if (rowsToSave.length === 0) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.commitDocumentRows(token, {
        targetModule,
        originalFilename: `Manual Custom Entry — ${MODULE_LABELS[targetModule]}`,
        fileType: 'manual',
        rows: rowsToSave,
      });
      setSuccessMsg(res.message);
      setStagedRows([]);
      resetInputs();
      await onCommitted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save custom record.');
    } finally {
      setSaving(false);
    }
  };

  const handleDirectSave = async (e: FormEvent) => {
    e.preventDefault();
    const row = buildCurrentRow();
    if (!row) return;
    await commitRows([...stagedRows, row]);
  };

  const handleAddToQueue = () => {
    setSuccessMsg(null);
    const row = buildCurrentRow();
    if (!row) return;
    setStagedRows((prev) => [...prev, row]);
    resetInputs();
  };

  const formatRowSummary = (row: ManualRow): string => {
    if (targetModule === 'department_students' || targetModule === 'class_representatives') {
      return `${row.rollNo} · ${row.fullName} · ${row.yearOfStudy} Sec ${row.section}${row.isClassRep ? ' · Class Rep' : ''}`;
    }
    if (targetModule === 'department_staff') {
      return `${row.employeeId} · ${row.fullName} · ${row.designation}${row.isClassAdvisor ? ` · Advisor (${row.advisingClass || 'Assigned'})` : ''}`;
    }
    if (targetModule === 'other_department_staff') {
      return `${row.employeeId} · ${row.fullName} · ${row.homeDepartment} · ${row.handlingSubject || 'Visiting'}`;
    }
    return `${row.yearOfStudy} Sec ${row.section} · ${row.dayOfWeek} P${row.periodNumber} (${row.startTime}–${row.endTime}) · ${row.subjectCode} ${row.subjectName} · ${row.facultyName}`;
  };

  const inputClass =
    'w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600/20';

  return (
    <div
      className={
        compact
          ? 'bg-white border border-slate-200 rounded-lg p-5 space-y-4'
          : 'border border-slate-200 rounded-lg p-5 bg-slate-50/50 space-y-4'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Manual / Custom Entry — {MODULE_LABELS[targetModule]}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Add individual or custom records directly without uploading a file. Duplicate IDs update existing records automatically.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
            aria-label="Close manual entry form"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleDirectSave} className="space-y-4">
        {/* Module 1 & 2: Department Students & Class Representatives */}
        {(targetModule === 'department_students' || targetModule === 'class_representatives') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Roll No *</span>
              <input
                type="text"
                required
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                placeholder="e.g. 22CSE045"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Full Name *</span>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Student full name"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@chromagrade.edu"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Year of Study</span>
              <select
                value={yearOfStudy}
                onChange={(e) => setYearOfStudy(e.target.value)}
                className={inputClass}
              >
                {YEAR_OPTIONS.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
                <option value="CUSTOM">Custom Year / Program...</option>
              </select>
            </label>

            {yearOfStudy === 'CUSTOM' && (
              <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-700">Custom Year Label</span>
                <input
                  type="text"
                  value={customYear}
                  onChange={(e) => setCustomYear(e.target.value)}
                  placeholder="e.g. M.E. I Year"
                  className={inputClass}
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Section</span>
              <input
                type="text"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="A"
                maxLength={6}
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Phone</span>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98400 00000"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Class Advisor Name</span>
              <input
                type="text"
                value={advisorName}
                onChange={(e) => setAdvisorName(e.target.value)}
                placeholder="Prof. Arvind Narayanan"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">CGPA</span>
              <input
                type="text"
                value={cgpa}
                onChange={(e) => setCgpa(e.target.value)}
                placeholder="8.95"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Department</span>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </label>

            {targetModule === 'department_students' && (
              <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={isClassRep}
                  onChange={(e) => setIsClassRep(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                />
                Designate as Class Representative (CR)
              </label>
            )}

            {(targetModule === 'class_representatives' || isClassRep) && (
              <label className="space-y-1 sm:col-span-2">
                <span className="block text-xs font-medium text-slate-700">
                  Class Representative Responsibility
                </span>
                <input
                  type="text"
                  value={crResponsibility}
                  onChange={(e) => setCrResponsibility(e.target.value)}
                  placeholder="e.g. Academic Coordination, Lab Roster & Circulars"
                  className={inputClass}
                />
              </label>
            )}
          </div>
        )}

        {/* Module 3: Department Staff */}
        {targetModule === 'department_staff' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Employee ID *</span>
              <input
                type="text"
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. CSE-FAC-112"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Full Name *</span>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. / Prof. Full Name"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="faculty@chromagrade.edu"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Designation</span>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Assistant Professor"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Specialization</span>
              <input
                type="text"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="e.g. Distributed Systems & Cloud"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Phone</span>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98401 00000"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Department</span>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isClassAdvisor}
                onChange={(e) => setIsClassAdvisor(e.target.checked)}
                className="rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
              />
              Assigned as Class Advisor
            </label>

            {isClassAdvisor && (
              <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-700">Advising Class</span>
                <input
                  type="text"
                  value={advisingClass}
                  onChange={(e) => setAdvisingClass(e.target.value)}
                  placeholder="e.g. III Year - A"
                  className={inputClass}
                />
              </label>
            )}
          </div>
        )}

        {/* Module 4: Other Department Staff */}
        {targetModule === 'other_department_staff' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Employee ID *</span>
              <input
                type="text"
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. MAT-FAC-215"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Full Name *</span>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. / Prof. Full Name"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Home Department *</span>
              <input
                type="text"
                required
                value={homeDepartment}
                onChange={(e) => setHomeDepartment(e.target.value)}
                placeholder="e.g. Mathematics / ECE / Physics"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Handling Subject</span>
              <input
                type="text"
                value={handlingSubject}
                onChange={(e) => setHandlingSubject(e.target.value)}
                placeholder="e.g. Probability & Queueing Theory"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Designation</span>
              <input
                type="text"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="Associate Professor"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="visiting@chromagrade.edu"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Phone</span>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98402 00000"
                className={inputClass}
              />
            </label>

            <label className="space-y-1 sm:col-span-2">
              <span className="block text-xs font-medium text-slate-700">Visiting Days</span>
              <input
                type="text"
                value={visitingDays}
                onChange={(e) => setVisitingDays(e.target.value)}
                placeholder="e.g. Mon, Wed, Fri"
                className={inputClass}
              />
            </label>
          </div>
        )}

        {/* Module 5: Timetable */}
        {targetModule === 'timetable' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Year of Study</span>
              <select
                value={yearOfStudy}
                onChange={(e) => setYearOfStudy(e.target.value)}
                className={inputClass}
              >
                {YEAR_OPTIONS.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
                <option value="CUSTOM">Custom Year / Program...</option>
              </select>
            </label>

            {yearOfStudy === 'CUSTOM' && (
              <label className="space-y-1">
                <span className="block text-xs font-medium text-slate-700">Custom Year Label</span>
                <input
                  type="text"
                  value={customYear}
                  onChange={(e) => setCustomYear(e.target.value)}
                  placeholder="e.g. M.E. I Year"
                  className={inputClass}
                />
              </label>
            )}

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Section</span>
              <input
                type="text"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="A"
                maxLength={6}
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Day of Week</span>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(e.target.value)}
                className={inputClass}
              >
                {WEEKDAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Period (1–12)</span>
              <select
                value={periodNumber}
                onChange={(e) => handlePeriodChange(Number(e.target.value))}
                className={inputClass}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                  <option key={n} value={n}>
                    Period {n} ({PERIOD_DEFAULTS[n].start}–{PERIOD_DEFAULTS[n].end})
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Start Time</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">End Time</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputClass}
              />
            </label>

            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Time Period (Per Hour)</span>
              <div className="px-3 py-2 text-xs font-mono bg-indigo-50 text-indigo-900 border border-indigo-200 rounded-lg">
                {startTime || '--:--'}–{endTime || '--:--'} · Hr {periodNumber}
              </div>
            </div>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Subject Code</span>
              <input
                type="text"
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
                placeholder="e.g. CS3501"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Subject Name *</span>
              <input
                type="text"
                required
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="e.g. Machine Learning"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Faculty Name *</span>
              <input
                type="text"
                required
                value={facultyName}
                onChange={(e) => setFacultyName(e.target.value)}
                placeholder="e.g. Prof. Arvind Narayanan"
                className={inputClass}
              />
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Faculty Type</span>
              <select
                value={facultyType}
                onChange={(e) =>
                  setFacultyType(
                    e.target.value === 'other_department' ? 'other_department' : 'department'
                  )
                }
                className={inputClass}
              >
                <option value="department">Department Faculty</option>
                <option value="other_department">Other Department / Visiting Faculty</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-xs font-medium text-slate-700">Room / Lab No</span>
              <input
                type="text"
                value={roomNo}
                onChange={(e) => setRoomNo(e.target.value)}
                placeholder="e.g. CSE-301 / AI Lab"
                className={inputClass}
              />
            </label>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
          >
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddToQueue}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add to Batch Queue
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              {saving
                ? 'Saving...'
                : stagedRows.length > 0
                ? `Save Current + ${stagedRows.length} Queued`
                : 'Save Custom Record'}
            </button>
          </div>

          {stagedRows.length > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => commitRows(stagedRows)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-800 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              Commit {stagedRows.length} Queued Record{stagedRows.length === 1 ? '' : 's'} Only
            </button>
          )}
        </div>
      </form>

      {/* Queued custom entries preview */}
      {stagedRows.length > 0 && (
        <div className="pt-3 border-t border-slate-200 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">
              Staged Custom Entries ({stagedRows.length})
            </span>
            <button
              type="button"
              onClick={() => setStagedRows([])}
              className="text-slate-500 hover:text-red-700 text-xs"
            >
              Clear Queue
            </button>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
            {stagedRows.map((row, idx) => (
              <div
                key={idx}
                className="px-3.5 py-2 flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-slate-800 truncate">{formatRowSummary(row)}</span>
                <button
                  type="button"
                  onClick={() =>
                    setStagedRows((prev) => prev.filter((_, i) => i !== idx))
                  }
                  className="text-slate-400 hover:text-red-700 shrink-0"
                  aria-label="Remove staged entry"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
