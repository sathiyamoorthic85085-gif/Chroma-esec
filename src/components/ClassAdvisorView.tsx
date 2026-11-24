import { useMemo, useState } from 'react';
import { PenLine, RotateCcw, Upload } from 'lucide-react';
import type { DepartmentStudent, UploadModule, UserProfile } from '../types';
import { ManualRecordForm } from './ManualRecordForm';
import {
  DirectorySearchBar,
  matchesDirectorySearch,
  type DirectorySearchField,
} from './DirectorySearchBar';

interface ClassAdvisorViewProps {
  token: string;
  user: UserProfile;
  students: DepartmentStudent[];
  onOpenUpload: (module: UploadModule) => void;
  onRecordAdded: () => Promise<void>;
}

export function ClassAdvisorView({
  token,
  user,
  students,
  onOpenUpload,
  onRecordAdded,
}: ClassAdvisorViewProps) {
  const classGroups = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => set.add(`${s.yearOfStudy}::${s.section}`));
    if (user.yearOfStudy && user.section) {
      set.add(`${user.yearOfStudy}::${user.section}`);
    }
    return ['ALL', ...Array.from(set).sort()];
  }, [students, user.yearOfStudy, user.section]);

  const departments = useMemo(() => {
    const set = new Set(students.map((s) => s.department.trim()).filter(Boolean));
    return Array.from(set).sort();
  }, [students]);

  const initialSelection =
    user.yearOfStudy && user.section && classGroups.includes(`${user.yearOfStudy}::${user.section}`)
      ? `${user.yearOfStudy}::${user.section}`
      : classGroups[1] ?? 'ALL';

  const [selectedClass, setSelectedClass] = useState(initialSelection);
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState<DirectorySearchField>('all');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState<'all' | 'cr' | 'student'>('all');
  const [manualModule, setManualModule] = useState<'department_students' | 'class_representatives' | null>(null);

  const hasActiveFilters =
    query.trim().length > 0 ||
    searchField !== 'all' ||
    departmentFilter !== 'ALL' ||
    selectedClass !== 'ALL' ||
    roleFilter !== 'all';

  const resetFilters = () => {
    setQuery('');
    setSearchField('all');
    setDepartmentFilter('ALL');
    setSelectedClass('ALL');
    setRoleFilter('all');
  };

  const scopedStudents = useMemo(() => {
    return students.filter((st) => {
      if (selectedClass !== 'ALL') {
        const [yr, sec] = selectedClass.split('::');
        if (st.yearOfStudy !== yr || st.section !== sec) return false;
      }
      if (departmentFilter !== 'ALL' && st.department.trim() !== departmentFilter) {
        return false;
      }
      if (roleFilter === 'cr' && !st.isClassRep) return false;
      if (roleFilter === 'student' && st.isClassRep) return false;
      return matchesDirectorySearch(query, searchField, {
        name: st.fullName,
        id: st.rollNo,
        department: st.department,
        extra: [st.email, st.phone, st.crResponsibility, st.advisorName, st.yearOfStudy, st.section],
      });
    });
  }, [students, selectedClass, departmentFilter, roleFilter, query, searchField]);

  const classReps = useMemo(
    () => scopedStudents.filter((s) => s.isClassRep),
    [scopedStudents]
  );

  const selectedLabel =
    selectedClass === 'ALL'
      ? 'All Department Classes'
      : selectedClass.replace('::', ' · Section ');

  return (
    <div className="space-y-6">
      {/* Unified Search, Filter & Document Upload Toolbar */}
      <DirectorySearchBar
        query={query}
        onQueryChange={setQuery}
        searchField={searchField}
        onSearchFieldChange={setSearchField}
        idLabel="Roll No"
        placeholder="Search students or CRs by name, roll no, department..."
        departmentFilter={departmentFilter}
        onDepartmentFilterChange={setDepartmentFilter}
        departments={departments}
        totalCount={students.length}
        filteredCount={scopedStudents.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={resetFilters}
        extraFilters={
          <>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              aria-label="Filter by advised class"
              className="min-h-[36px] px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900"
            >
              {classGroups.map((g) => (
                <option key={g} value={g}>
                  {g === 'ALL' ? 'All Department Classes' : g.replace('::', ' — Section ')}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All Roles' },
                  { id: 'cr', label: 'Class Reps' },
                  { id: 'student', label: 'Students' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRoleFilter(opt.id)}
                  className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    roleFilter === opt.id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        }
        actions={
          user.role === 'hod' || user.role === 'class_advisor' ? (
            <>
              <button
                type="button"
                onClick={() =>
                  setManualModule((prev) =>
                    prev === 'class_representatives' ? null : 'class_representatives'
                  )
                }
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {manualModule === 'class_representatives' ? 'Hide CR Form' : 'Add Custom CR'}
              </button>
              <button
                type="button"
                onClick={() =>
                  setManualModule((prev) =>
                    prev === 'department_students' ? null : 'department_students'
                  )
                }
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <PenLine className="w-3.5 h-3.5" />
                {manualModule === 'department_students' ? 'Hide Student Form' : 'Add Custom Student'}
              </button>
              <button
                type="button"
                onClick={() => onOpenUpload('class_representatives')}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs font-medium text-slate-800 border border-slate-300 bg-white hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Import CR Document
              </button>
              <button
                type="button"
                onClick={() => onOpenUpload('department_students')}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Class Roster
              </button>
            </>
          ) : undefined
        }
      />

      {(user.role === 'hod' || user.role === 'class_advisor') && manualModule && (
        <ManualRecordForm
          token={token}
          targetModule={manualModule}
          defaultDepartment={user.department}
          onCommitted={onRecordAdded}
          onClose={() => setManualModule(null)}
          compact
        />
      )}

      {/* Section 1: Class Representatives Listing */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Class Representatives — {selectedLabel}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Designated student representatives coordinating attendance, lab readiness, and circulars.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-indigo-800 font-medium">
            {classReps.length} Representative{classReps.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Representative Name</th>
                <th className="py-3 px-4">Class &amp; Department</th>
                <th className="py-3 px-4">Assigned CR Responsibility</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4 text-right">CGPA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {classReps.map((cr) => (
                <tr key={cr.id} className="hover:bg-slate-50/70">
                  <td className="py-3.5 px-4 font-mono text-xs tabular-nums font-semibold text-indigo-800">
                    {cr.rollNo}
                  </td>
                  <td className="py-3.5 px-4 font-medium text-slate-900">
                    {cr.fullName}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-700">
                    <div className="whitespace-nowrap font-medium text-slate-800">
                      {cr.yearOfStudy} · Sec {cr.section}
                    </div>
                    {cr.department && (
                      <div className="text-slate-500 mt-0.5">{cr.department}</div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-700">
                    {cr.crResponsibility || 'General Class Coordination'}
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-600">
                    <div>{cr.email}</div>
                    {cr.phone && <div className="text-slate-500">{cr.phone}</div>}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                    {cr.cgpa || '—'}
                  </td>
                </tr>
              ))}
              {classReps.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-xs text-slate-500">
                    {students.length > 0 && hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <span>No Class Representatives match the active search or filter criteria.</span>
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
                      'No Class Representatives assigned yet. Upload a CR roster document or add a custom CR.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Complete Students Roster for the Class */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Class Student Roster — {selectedLabel}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Complete arranged student records imported from department Excel, PDF, or Word documents.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {scopedStudents.length} Student{scopedStudents.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Roll No</th>
                <th className="py-3 px-4">Student Name</th>
                <th className="py-3 px-4">Department &amp; Role</th>
                <th className="py-3 px-4">Email &amp; Phone</th>
                <th className="py-3 px-4">Advisor</th>
                <th className="py-3 px-4 text-right">CGPA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {scopedStudents.map((st) => (
                <tr key={st.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-mono text-xs tabular-nums font-medium text-slate-900">
                    {st.rollNo}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {st.fullName}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {st.isClassRep ? (
                      <div className="font-semibold text-indigo-800">Class Rep</div>
                    ) : (
                      <div className="text-slate-700">Student</div>
                    )}
                    {st.department && (
                      <div className="text-slate-500 mt-0.5">{st.department}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    <div>{st.email}</div>
                    {st.phone && <div className="text-slate-500">{st.phone}</div>}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700">
                    {st.advisorName || '—'}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-800">
                    {st.cgpa || '—'}
                  </td>
                </tr>
              ))}
              {scopedStudents.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-xs text-slate-500">
                    {students.length > 0 && hasActiveFilters ? (
                      <div className="flex flex-col items-center gap-2.5">
                        <span>No student records match the current search or filter criteria.</span>
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
                      'No student records imported yet. Use Add Custom Student or Import Class Roster above.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

