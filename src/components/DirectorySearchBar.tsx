import type { ReactNode } from 'react';
import { RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';

export type DirectorySearchField = 'all' | 'name' | 'id' | 'department';

export function matchesDirectorySearch(
  query: string,
  field: DirectorySearchField,
  values: {
    name: string;
    id: string;
    department: string;
    extra?: string[];
  }
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const norm = (val: string | null | undefined) => (val ?? '').toLowerCase();

  if (field === 'name') return norm(values.name).includes(q);
  if (field === 'id') return norm(values.id).includes(q);
  if (field === 'department') return norm(values.department).includes(q);

  return (
    norm(values.name).includes(q) ||
    norm(values.id).includes(q) ||
    norm(values.department).includes(q) ||
    (values.extra ?? []).some((item) => norm(item).includes(q))
  );
}

interface DirectorySearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  searchField: DirectorySearchField;
  onSearchFieldChange: (value: DirectorySearchField) => void;
  idLabel: string;
  placeholder: string;
  departmentFilter: string;
  onDepartmentFilterChange: (value: string) => void;
  departments: string[];
  allDepartmentsLabel?: string;
  totalCount: number;
  filteredCount: number;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  extraFilters?: ReactNode;
  actions?: ReactNode;
}

export function DirectorySearchBar({
  query,
  onQueryChange,
  searchField,
  onSearchFieldChange,
  idLabel,
  placeholder,
  departmentFilter,
  onDepartmentFilterChange,
  departments,
  allDepartmentsLabel = 'All Departments',
  totalCount,
  filteredCount,
  hasActiveFilters,
  onResetFilters,
  extraFilters,
  actions,
}: DirectorySearchBarProps) {
  const resolvedPlaceholder =
    searchField === 'name'
      ? 'Search by individual name...'
      : searchField === 'id'
      ? `Search by ${idLabel}...`
      : searchField === 'department'
      ? 'Search by department name...'
      : placeholder;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 space-y-3">
      {/* Row 1: Primary Search Input, Field Scope, Department Filter & Action Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5 flex-1 min-w-0">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[210px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={resolvedPlaceholder}
              aria-label={resolvedPlaceholder}
              className="w-full min-h-[40px] pl-9 pr-8 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Clear search query"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Search Scope Selector (All / Name / ID / Department) */}
          <div className="flex items-center gap-2">
            <select
              value={searchField}
              onChange={(e) => onSearchFieldChange(e.target.value as DirectorySearchField)}
              aria-label="Search by field"
              className="w-full sm:w-auto min-h-[40px] px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
            >
              <option value="all">Search: All Fields</option>
              <option value="name">Search: Name</option>
              <option value="id">Search: {idLabel}</option>
              <option value="department">Search: Department</option>
            </select>

            {/* Department Filter */}
            <select
              value={departmentFilter}
              onChange={(e) => onDepartmentFilterChange(e.target.value)}
              aria-label="Filter by department"
              className="w-full sm:w-auto min-h-[40px] max-w-[240px] px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
            >
              <option value="ALL">{allDepartmentsLabel}</option>
              {departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right-aligned View Actions (Manual Entry / Upload) */}
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Row 2: Secondary View-Specific Filters + Active Match Summary & Reset */}
      <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 mr-0.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            Filters
          </span>
          {extraFilters}
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {hasActiveFilters
              ? `${filteredCount} of ${totalCount} matched`
              : `${totalCount} total`}
          </span>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1.5 min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
