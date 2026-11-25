import { useEffect, useMemo, useState } from 'react';
import { BellRing, Crown, Lock, PenLine, RotateCcw, Upload } from 'lucide-react';
import { api } from '../lib/api';
import type {
  DepartmentStaff,
  DepartmentStudent,
  HodDelegationInfo,
  HodDirectoryRecord,
  OtherDepartmentStaff,
  UploadModule,
} from '../types';
import { ManualRecordForm } from './ManualRecordForm';
import { RecordProfileModal, type RecordShowcasePerson } from './RecordProfileModal';
import {
  DirectorySearchBar,
  matchesDirectorySearch,
  type DirectorySearchField,
} from './DirectorySearchBar';

function AvatarBadge({ name, photoData }: { name: string; photoData?: string }) {
  if (photoData) {
    return (
      <img
        src={photoData}
        alt={name}
        className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0"
      />
    );
  }
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');
  return (
    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-800 font-bold text-xs flex items-center justify-center border border-indigo-200 shrink-0">
      {initials || 'AE'}
    </div>
  );
}

function HodDirectoryShowcaseBanner({
  token,
  onSelectPerson,
}: {
  token: string;
  onSelectPerson: (person: RecordShowcasePerson) => void;
}) {
  const [hodRecords, setHodRecords] = useState<HodDirectoryRecord[]>([]);
  const [delegation, setDelegation] = useState<HodDelegationInfo | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getHodRecords(token)
      .then((res) => {
        if (!active) return;
        setHodRecords(res.hodRecords);
        setDelegation(res.activeDelegation);
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [token]);

  if (hodRecords.length === 0) return null;

  return (
    <section className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl border border-indigo-800/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-300" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-200">
            Department Leadership / HOD Directory (Profile & Wake-Up Page-Call Only)
          </h3>
        </div>
        {delegation && delegation.status === 'active' && (
          <span className="text-[11px] px-2.5 py-0.5 rounded-md bg-amber-400/20 text-amber-200 border border-amber-300/30">
            Acting HOD: {delegation.delegateName}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {hodRecords.map((hod) => (
          <button
            key={hod.id}
            type="button"
            onClick={() =>
              onSelectPerson({
                userId: hod.id,
                fullName: hod.fullName,
                roleLabel: hod.isActingHod
                  ? 'Acting Head of Department (HOD)'
                  : 'Head of Department (HOD)',
                identifier: hod.staffOrRollId,
                email: hod.email,
                phone: hod.phone,
                department: hod.department,
                yearSectionOrSpec: hod.specialization,
                designationOrSubLabel: hod.designation,
                photoData: hod.photoData,
                faceRegisteredLocked: hod.faceRegisteredLocked,
                bio: hod.bio,
              })
            }
            className="flex items-center gap-3 bg-white/10 hover:bg-white/15 border border-white/15 rounded-xl p-3 text-left transition-colors"
          >
            <AvatarBadge name={hod.fullName} photoData={hod.photoData} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-white truncate">{hod.fullName}</span>
                {hod.faceRegisteredLocked && <Lock className="w-3 h-3 text-emerald-300 shrink-0" />}
              </div>
              <div className="text-[11px] text-amber-200 truncate">{hod.designation}</div>
              <div className="text-[11px] text-slate-300 truncate">
                {hod.email} {hod.phone ? `· ${hod.phone}` : ''}
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600/90 text-white text-[10px] font-semibold shrink-0">
              <BellRing className="w-3 h-3" />
              Page-Call
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

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
  const [selectedProfile, setSelectedProfile] = useState<RecordShowcasePerson | null>(null);

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
      <HodDirectoryShowcaseBanner token={token} onSelectPerson={setSelectedProfile} />
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
                <th className="py-3 px-4">Student Profile</th>
                <th className="py-3 px-4">Class &amp; Department</th>
                <th className="py-3 px-4">Designation</th>
                <th className="py-3 px-4">Class Advisor</th>
                <th className="py-3 px-4 text-right">CGPA</th>
                <th className="py-3 px-4 text-right">Profile &amp; Page-Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {st.rollNo}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <AvatarBadge name={st.fullName} photoData={st.photoData} />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{st.fullName}</span>
                          {st.faceRegisteredLocked && (
                            <span title="Face Registered" className="inline-flex shrink-0">
                              <Lock className="w-3 h-3 text-emerald-600" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {st.email} {st.phone ? `· ${st.phone}` : ''}
                        </div>
                      </div>
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
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedProfile({
                          fullName: st.fullName,
                          roleLabel: st.isClassRep ? 'Class Representative' : 'Student',
                          identifier: st.rollNo,
                          email: st.email,
                          phone: st.phone,
                          department: st.department,
                          yearSectionOrSpec: `${st.yearOfStudy} · Sec ${st.section}`,
                          designationOrSubLabel: st.crResponsibility || st.advisorName,
                          photoData: st.photoData,
                          faceRegisteredLocked: st.faceRegisteredLocked,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold whitespace-nowrap"
                    >
                      <BellRing className="w-3 h-3" />
                      Profile / Call
                    </button>
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
      <RecordProfileModal
        open={Boolean(selectedProfile)}
        onClose={() => setSelectedProfile(null)}
        token={token}
        person={selectedProfile}
      />
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
  const [selectedProfile, setSelectedProfile] = useState<RecordShowcasePerson | null>(null);

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
      <HodDirectoryShowcaseBanner token={token} onSelectPerson={setSelectedProfile} />
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
                <th className="py-3 px-4">Faculty Profile</th>
                <th className="py-3 px-4">Department &amp; Designation</th>
                <th className="py-3 px-4">Specialization</th>
                <th className="py-3 px-4">Class Advisor Role</th>
                <th className="py-3 px-4 text-right">Profile &amp; Page-Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {f.employeeId}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <AvatarBadge name={f.fullName} photoData={f.photoData} />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{f.fullName}</span>
                          {f.faceRegisteredLocked && (
                            <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {f.email} {f.phone ? `· ${f.phone}` : ''}
                        </div>
                      </div>
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
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedProfile({
                          fullName: f.fullName,
                          roleLabel: f.isClassAdvisor ? 'Class Advisor' : 'Department Faculty',
                          identifier: f.employeeId,
                          email: f.email,
                          phone: f.phone,
                          department: f.department,
                          yearSectionOrSpec: f.specialization,
                          designationOrSubLabel: f.designation,
                          photoData: f.photoData,
                          faceRegisteredLocked: f.faceRegisteredLocked,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold whitespace-nowrap"
                    >
                      <BellRing className="w-3 h-3" />
                      Profile / Call
                    </button>
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
      <RecordProfileModal
        open={Boolean(selectedProfile)}
        onClose={() => setSelectedProfile(null)}
        token={token}
        person={selectedProfile}
      />
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
  const [selectedProfile, setSelectedProfile] = useState<RecordShowcasePerson | null>(null);

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
                <th className="py-3 px-4">Faculty Profile</th>
                <th className="py-3 px-4">Home Department</th>
                <th className="py-3 px-4">Handling Subject</th>
                <th className="py-3 px-4">Visiting Days</th>
                <th className="py-3 px-4 text-right">Profile &amp; Page-Call</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {f.employeeId}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2.5">
                      <AvatarBadge name={f.fullName} photoData={f.photoData} />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{f.fullName}</span>
                          {f.faceRegisteredLocked && (
                            <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {f.designation} · {f.email}
                        </div>
                      </div>
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
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedProfile({
                          fullName: f.fullName,
                          roleLabel: 'Other-Department Faculty',
                          identifier: f.employeeId,
                          email: f.email,
                          phone: f.phone,
                          department: f.homeDepartment,
                          yearSectionOrSpec: f.handlingSubject,
                          designationOrSubLabel: f.designation,
                          photoData: f.photoData,
                          faceRegisteredLocked: f.faceRegisteredLocked,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold whitespace-nowrap"
                    >
                      <BellRing className="w-3 h-3" />
                      Profile / Call
                    </button>
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
      <RecordProfileModal
        open={Boolean(selectedProfile)}
        onClose={() => setSelectedProfile(null)}
        token={token}
        person={selectedProfile}
      />
    </div>
  );
}

