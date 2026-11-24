import { useMemo, useState } from 'react';
import { PenLine, RotateCcw, Upload } from 'lucide-react';
import type {
  DepartmentStaff,
  DepartmentStudent,
  OtherDepartmentStaff,
  UploadModule,
} from '../types';
import { ManualRecordForm } from './ManualRecordForm';
import {
  DirectorySearchBar,
  matchesDirectorySearch,
  type DirectorySearchField,
} from './DirectorySearchBar';

interface DirectoryCommonProps {
  token: string;
  defaultDepartment: string;
  canUpload: boolean;
  onOpenUpload: (module: UploadModule) => void;
  onRecordAdded: () => Promise<void>;
}

export function DepartmentStudentsView({
  token,
  defaultDepartment,
  students,
  canUpload,
  onOpenUpload,
  onRecordAdded,
}: DirectoryCommonProps & { students: DepartmentStudent[] }) {
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<DirectorySearchField>('all');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [yearFilter, setYearFilter] = useState('ALL');
  const [sectionFilter, setSectionFilter] = useState('ALL');
  const [crOnly, setCrOnly] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  const departments = useMemo(() => {
    const set = new Set(students.map((st) => st.department.trim()).filter(Boolean));
    return Array.from(set).sort();
  }, [students]);

  const years = useMemo(() => {
    const s = new Set(students.map((st) => st.yearOfStudy).filter(Boolean));
    return ['ALL', ...Array.from(s).sort()];
  }, [students]);

  const sections = useMemo(() => {
    const s = new Set(students.map((st) => st.section).filter(Boolean));
    return ['ALL', ...Array.from(s).sort()];
  }, [students]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    searchField !== 'all' ||
    departmentFilter !== 'ALL' ||
    yearFilter !== 'ALL' ||
    sectionFilter !== 'ALL' ||
    crOnly;

  const resetFilters = () => {
    setQuery('');
    setSearchField('all');
    setDepartmentFilter('ALL');
    setYearFilter('ALL');
    setSectionFilter('ALL');
    setCrOnly(false);
  };

  const filtered = useMemo(() => {
    return students.filter((st) => {
      if (departmentFilter !== 'ALL' && st.department.trim() !== departmentFilter) return false;
      if (yearFilter !== 'ALL' && st.yearOfStudy !== yearFilter) return false;
      if (sectionFilter !== 'ALL' && st.section !== sectionFilter) return false;
      if (crOnly && !st.isClassRep) return false;
      return matchesDirectorySearch(query, searchField, {
        name: st.fullName,
        id: st.rollNo,
        department: st.department,
        extra: [st.email, st.phone, st.advisorName, st.crResponsibility, st.yearOfStudy, st.section],
      });
    });
  }, [students, query, searchField, departmentFilter, yearFilter, sectionFilter, crOnly]);

  const crCount = students.filter((s) => s.isClassRep).length;

  return (
    <div className="space-y-5">
      <DirectorySearchBar
        query={query}
        onQueryChange={setQuery}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        idLabel="Roll No"
        placeholder="Search by name, roll no, department, advisor..."
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        departments={departments}
        totalCount={students.length}
        filteredCount={filtered.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetFilters}
        extraFilters={
          <>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
              {years.map((yr) => (
                <button
                  key={yr}
                  type="button"
                  onClick={() => setYearFilter(yr)}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    yearFilter === yr
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {yr === 'ALL' ? 'All Years' : yr}
                </button>
              ))}
            </div>

            {sections.length > 1 && (
              <select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                aria-label="Filter by section"
                className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800"
              >
                {sections.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec === 'ALL' ? 'All Sections' : `Section ${sec}`}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setCrOnly((prev) => !prev)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                crOnly
                  ? 'border-indigo-700 bg-indigo-50 text-indigo-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Class Reps Only ({crCount})
            </button>
          </>
        }
        actions={
          canUpload ? (
            <>
              <button
                type="button"
                onClick={() => setShowManualAdd((prev) => !prev)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {showManualAdd ? 'Hide Manual Entry' : 'Add Custom Student'}
              </button>
              <button
                type="button"
                onClick={() => onOpenUpload('department_students')}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Students Document
              </button>
            </>
          ) : undefined
        }
      />

      {canUpload && showManualAdd && (
        <ManualRecordForm
          token={token}
          targetModule="department_students"
          defaultDepartment={defaultDepartment}
          onCommitted={onRecordAdded}
          onClose={() => setShowManualAdd(false)}
          compact
        />
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Department Student Directory · Sorted by Year, Section, CR Status, and Roll No
          </span>
          <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
            Showing {filtered.length} of {students.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Class &amp; Department</th>
                <th className="py-3 px-4">Designation</th>
                <th className="py-3 px-4">Class Advisor</th>
                <th className="py-3 px-4 text-right">CGPA</th>
                <th className="py-3 px-4">Source Document</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {st.rollNo}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{st.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {st.email} {st.phone ? `· ${st.phone}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    <div className="whitespace-nowrap font-medium text-slate-800">
                      {st.yearOfStudy} · Sec {st.section}
                    </div>
                    {st.department && (
                      <div className="text-slate-500 mt-0.5">{st.department}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {st.isClassRep ? (
                      <div>
                        <span className="font-semibold text-indigo-800">
                          Class Representative
                        </span>
                        {st.crResponsibility && (
                          <div className="text-slate-500 mt-0.5">{st.crResponsibility}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500">Student</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    {st.advisorName || '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                    {st.cgpa || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 max-w-[200px] truncate">
                    {st.sourceFilename || '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 px-4 text-center text-xs text-slate-500">
                    {students.length > 0 && hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <span>No students match your current search or filter criteria.</span>
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 rounded-lg"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Filters
                        </button>
                      </div>
                    ) : (
                      'No student records found yet. Import an Excel, Word, or PDF roster or add a custom student.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function DepartmentStaffView({
  token,
  defaultDepartment,
  staff,
  canUpload,
  onOpenUpload,
  onRecordAdded,
}: DirectoryCommonProps & { staff: DepartmentStaff[] }) {
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<DirectorySearchField>('all');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [advisorsOnly, setAdvisorsOnly] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);

  const departments = useMemo(() => {
    const set = new Set(staff.map((f) => f.department.trim()).filter(Boolean));
    return Array.from(set).sort();
  }, [staff]);

  const designations = useMemo(() => {
    const set = new Set(staff.map((f) => f.designation.trim()).filter(Boolean));
    return ['ALL', ...Array.from(set).sort()];
  }, [staff]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    searchField !== 'all' ||
    departmentFilter !== 'ALL' ||
    designationFilter !== 'ALL' ||
    advisorsOnly;

  const resetFilters = () => {
    setQuery('');
    setSearchField('all');
    setDepartmentFilter('ALL');
    setDesignationFilter('ALL');
    setAdvisorsOnly(false);
  };

  const filtered = useMemo(() => {
    return staff.filter((f) => {
      if (departmentFilter !== 'ALL' && f.department.trim() !== departmentFilter) return false;
      if (designationFilter !== 'ALL' && f.designation.trim() !== designationFilter) return false;
      if (advisorsOnly && !f.isClassAdvisor) return false;
      return matchesDirectorySearch(query, searchField, {
        name: f.fullName,
        id: f.employeeId,
        department: f.department,
        extra: [f.email, f.phone, f.designation, f.specialization, f.advisingClass],
      });
    });
  }, [staff, query, searchField, departmentFilter, designationFilter, advisorsOnly]);

  const advisorCount = staff.filter((f) => f.isClassAdvisor).length;

  return (
    <div className="space-y-5">
      <DirectorySearchBar
        query={query}
        onQueryChange={setQuery}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        idLabel="Employee ID"
        placeholder="Search by name, employee ID, department, specialization..."
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        departments={departments}
        totalCount={staff.length}
        filteredCount={filtered.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetFilters}
        extraFilters={
          <>
            <select
              value={designationFilter}
              onChange={(e) => setDesignationFilter(e.target.value)}
              aria-label="Filter by designation"
              className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800"
            >
              {designations.map((des) => (
                <option key={des} value={des}>
                  {des === 'ALL' ? 'All Designations' : des}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAdvisorsOnly((prev) => !prev)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                advisorsOnly
                  ? 'border-indigo-700 bg-indigo-50 text-indigo-800'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Class Advisors Only ({advisorCount})
            </button>
          </>
        }
        actions={
          canUpload ? (
            <>
              <button
                type="button"
                onClick={() => setShowManualAdd((prev) => !prev)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {showManualAdd ? 'Hide Manual Entry' : 'Add Custom Staff'}
              </button>
              <button
                type="button"
                onClick={() => onOpenUpload('department_staff')}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Department Staff Document
              </button>
            </>
          ) : undefined
        }
      />

      {canUpload && showManualAdd && (
        <ManualRecordForm
          token={token}
          targetModule="department_staff"
          defaultDepartment={defaultDepartment}
          onCommitted={onRecordAdded}
          onClose={() => setShowManualAdd(false)}
          compact
        />
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Home Department Faculty Listing · Managed separately from visiting inter-department staff
          </span>
          <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
            Showing {filtered.length} of {staff.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Employee ID</th>
                <th className="py-3 px-4">Faculty Member</th>
                <th className="py-3 px-4">Department &amp; Designation</th>
                <th className="py-3 px-4">Specialization</th>
                <th className="py-3 px-4">Class Advisor Role</th>
                <th className="py-3 px-4">Source Document</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {f.employeeId}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{f.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {f.email} {f.phone ? `· ${f.phone}` : ''}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <div className="font-medium text-slate-800">{f.designation}</div>
                    {f.department && (
                      <div className="text-slate-500 mt-0.5">{f.department}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    {f.specialization || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {f.isClassAdvisor ? (
                      <span className="font-medium text-indigo-800">
                        Advisor · {f.advisingClass || 'Assigned'}
                      </span>
                    ) : (
                      <span className="text-slate-500">Teaching Faculty</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 max-w-[200px] truncate">
                    {f.sourceFilename || '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-xs text-slate-500">
                    {staff.length > 0 && hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <span>No faculty members match your current search or filter criteria.</span>
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 rounded-lg"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Filters
                        </button>
                      </div>
                    ) : (
                      'No home-department faculty records found yet. Import a staff document or add a custom faculty record.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function OtherDepartmentStaffView({
  token,
  defaultDepartment,
  staff,
  canUpload,
  onOpenUpload,
  onRecordAdded,
}: DirectoryCommonProps & { staff: OtherDepartmentStaff[] }) {
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<DirectorySearchField>('all');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [designationFilter, setDesignationFilter] = useState('ALL');
  const [showManualAdd, setShowManualAdd] = useState(false);

  const homeDepts = useMemo(() => {
    const set = new Set(staff.map((f) => f.homeDepartment.trim()).filter(Boolean));
    return Array.from(set).sort();
  }, [staff]);

  const designations = useMemo(() => {
    const set = new Set(staff.map((f) => f.designation.trim()).filter(Boolean));
    return ['ALL', ...Array.from(set).sort()];
  }, [staff]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    searchField !== 'all' ||
    deptFilter !== 'ALL' ||
    designationFilter !== 'ALL';

  const resetFilters = () => {
    setQuery('');
    setSearchField('all');
    setDeptFilter('ALL');
    setDesignationFilter('ALL');
  };

  const filtered = useMemo(() => {
    return staff.filter((f) => {
      if (deptFilter !== 'ALL' && f.homeDepartment.trim() !== deptFilter) return false;
      if (designationFilter !== 'ALL' && f.designation.trim() !== designationFilter) return false;
      return matchesDirectorySearch(query, searchField, {
        name: f.fullName,
        id: f.employeeId,
        department: f.homeDepartment,
        extra: [f.email, f.phone, f.designation, f.handlingSubject, f.visitingDays],
      });
    });
  }, [staff, query, searchField, deptFilter, designationFilter]);

  return (
    <div className="space-y-5">
      <DirectorySearchBar
        query={query}
        onQueryChange={setQuery}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        idLabel="Employee ID"
        placeholder="Search by name, employee ID, home department, subject..."
        departmentFilter={deptFilter}
        onDepartmentFilterChange={setDeptFilter}
        departments={homeDepts}
        allDepartmentsLabel="All Home Departments"
        totalCount={staff.length}
        filteredCount={filtered.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetFilters}
        extraFilters={
          <select
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            aria-label="Filter by designation"
            className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800"
          >
            {designations.map((des) => (
              <option key={des} value={des}>
                {des === 'ALL' ? 'All Designations' : des}
              </option>
            ))}
          </select>
        }
        actions={
          canUpload ? (
            <>
              <button
                type="button"
                onClick={() => setShowManualAdd((prev) => !prev)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {showManualAdd ? 'Hide Manual Entry' : 'Add Custom Visiting Staff'}
              </button>
              <button
                type="button"
                onClick={() => onOpenUpload('other_department_staff')}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Other Dept Staff Document
              </button>
            </>
          ) : undefined
        }
      />

      {canUpload && showManualAdd && (
        <ManualRecordForm
          token={token}
          targetModule="other_department_staff"
          defaultDepartment={defaultDepartment}
          onCommitted={onRecordAdded}
          onClose={() => setShowManualAdd(false)}
          compact
        />
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            Other Department / Allied Faculty Listing · Handling interdisciplinary subjects for this department
          </span>
          <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
            Showing {filtered.length} of {staff.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Employee ID</th>
                <th className="py-3 px-4">Faculty Member</th>
                <th className="py-3 px-4">Home Department</th>
                <th className="py-3 px-4">Handling Subject</th>
                <th className="py-3 px-4">Visiting Days</th>
                <th className="py-3 px-4">Source Document</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {f.employeeId}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{f.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {f.designation} · {f.email}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-medium text-slate-800">
                    {f.homeDepartment}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    {f.handlingSubject}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                    {f.visitingDays || '—'}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 max-w-[200px] truncate">
                    {f.sourceFilename || '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-xs text-slate-500">
                    {staff.length > 0 && hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <span>No visiting faculty match your current search or filter criteria.</span>
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50 rounded-lg"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reset Filters
                        </button>
                      </div>
                    ) : (
                      'No other-department faculty records found yet. Import a visiting staff document or add a custom entry.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

