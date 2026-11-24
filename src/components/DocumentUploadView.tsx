import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  PenLine,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  MODULE_LABELS,
  type ParsedPreviewResponse,
  type UploadBatch,
  type UploadModule,
  type UserProfile,
} from '../types';
import { ManualRecordForm } from './ManualRecordForm';

interface DocumentUploadViewProps {
  token: string;
  user: UserProfile;
  initialModule?: UploadModule;
  batches: UploadBatch[];
  onImportCommitted: () => Promise<void>;
}

const HOD_MODULES: UploadModule[] = [
  'department_students',
  'department_staff',
  'other_department_staff',
  'class_representatives',
  'timetable',
];

const ADVISOR_MODULES: UploadModule[] = [
  'department_students',
  'class_representatives',
  'timetable',
];

export function DocumentUploadView({
  token,
  user,
  initialModule,
  batches,
  onImportCommitted,
}: DocumentUploadViewProps) {
  const allowedModules = user.role === 'hod' ? HOD_MODULES : ADVISOR_MODULES;
  const [selectedModule, setSelectedModule] = useState<UploadModule>(
    initialModule && allowedModules.includes(initialModule)
      ? initialModule
      : allowedModules[0]
  );
  const [entryMode, setEntryMode] = useState<'document' | 'manual'>('document');

  useEffect(() => {
    if (initialModule && allowedModules.includes(initialModule)) {
      setSelectedModule(initialModule);
    }
  }, [initialModule, allowedModules]);

  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<ParsedPreviewResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setPreview(null);
    setParsing(true);
    try {
      const parsed = await api.parseDocument(token, selectedModule, file);
      setPreview(parsed);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse document.');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCommit = async () => {
    if (!preview || preview.validRows.length === 0) return;
    setCommitting(true);
    setErrorMsg(null);
    try {
      const res = await api.commitDocumentRows(token, {
        targetModule: preview.targetModule,
        originalFilename: preview.originalFilename,
        fileType: preview.fileType,
        rows: preview.validRows,
      });
      setSuccessMsg(res.message);
      setPreview(null);
      await onImportCommitted();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not commit imported records.');
    } finally {
      setCommitting(false);
    }
  };

  const handleTemplateDownload = async (format: 'xlsx' | 'pdf' | 'csv') => {
    setErrorMsg(null);
    try {
      await api.downloadTemplate(token, selectedModule, format);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not download template.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload & Manual Entry Card */}
      <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Document Upload & Manual Custom Entry
            </h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Upload structured Excel (.xlsx, .xls), Word (.docx, .doc), PDF (.pdf), or CSV documents, or switch to Manual / Custom Entry to add individual department records directly.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleTemplateDownload('xlsx')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Sample Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => handleTemplateDownload('pdf')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Sample PDF (.pdf)
            </button>
          </div>
        </div>

        {/* Step 1: Target module selector */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-700">
            1. Select Target Record Directory
          </div>
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg w-fit">
            {allowedModules.map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => {
                  setSelectedModule(mod);
                  setPreview(null);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedModule === mod
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {MODULE_LABELS[mod]}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Entry method toggle (Upload Document vs Manual Custom Entry) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-medium text-slate-700">
              2. Choose Input Method for {MODULE_LABELS[selectedModule]}
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setEntryMode('document');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  entryMode === 'document'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                Upload Document
              </button>
              <button
                type="button"
                onClick={() => {
                  setEntryMode('manual');
                  setPreview(null);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  entryMode === 'manual'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                Manual / Custom Adding
              </button>
            </div>
          </div>

          {entryMode === 'document' ? (
            <div className="border border-dashed border-slate-300 rounded-lg p-8 bg-slate-50/70 flex flex-col items-center text-center gap-3">
              <div className="flex items-center gap-3 text-slate-500">
                <FileSpreadsheet className="w-6 h-6" />
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-900">
                  {parsing
                    ? 'Parsing and arranging document records...'
                    : `Select a structured document for ${MODULE_LABELS[selectedModule]}`}
                </p>
                <p className="text-xs text-slate-500">
                  Accepted formats: .xlsx · .xls · .pdf · .docx · .doc · .csv (max 10 MB)
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.pdf,.docx,.doc,.csv"
                onChange={handleFileSelected}
                className="hidden"
                id="chromagrade-doc-upload"
              />
              <label
                htmlFor="chromagrade-doc-upload"
                className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4" />
                {parsing ? 'Parsing Document...' : 'Choose Document File'}
              </label>
            </div>
          ) : (
            <ManualRecordForm
              token={token}
              targetModule={selectedModule}
              defaultDepartment={user.department}
              onCommitted={onImportCommitted}
            />
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800"
          >
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div
            role="status"
            className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-900 flex items-center gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Parsed Preview Table */}
        {preview && (
          <div className="space-y-4 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Arranged Preview — {preview.originalFilename}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                  {preview.validRows.length} valid record(s) ready for{' '}
                  {MODULE_LABELS[preview.targetModule]} · Format: .{preview.fileType}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={committing || preview.validRows.length === 0}
                  onClick={handleCommit}
                  className="px-4 py-2 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {committing
                    ? 'Creating Records...'
                    : `Confirm & Create ${preview.validRows.length} Record(s)`}
                </button>
              </div>
            </div>

            {preview.warnings.length > 0 && (
              <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                {preview.warnings.slice(0, 6).map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            )}

            {preview.validRows.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      {preview.columns.map((col) => (
                        <th key={col} className="py-2.5 px-3 whitespace-nowrap">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs">
                    {preview.validRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {preview.columns.map((col) => (
                          <td
                            key={col}
                            className="py-2.5 px-3 text-slate-800 whitespace-nowrap tabular-nums"
                          >
                            {typeof row[col] === 'boolean'
                              ? row[col]
                                ? 'Yes'
                                : 'No'
                              : String(row[col] ?? '—') || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Document Import Audit History */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Document Import Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Traceability log of all Excel, Word, PDF, and CSV documents imported into ChromaGrade.
            </p>
          </div>
          <span className="text-xs text-slate-500 tabular-nums">
            {batches.length} batch{batches.length === 1 ? '' : 'es'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Document Filename</th>
                <th className="py-3 px-4">Target Directory</th>
                <th className="py-3 px-4">Format</th>
                <th className="py-3 px-4 text-right">Inserted</th>
                <th className="py-3 px-4 text-right">Updated</th>
                <th className="py-3 px-4">Uploaded By</th>
                <th className="py-3 px-4">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {b.originalFilename}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {MODULE_LABELS[b.targetModule] ?? b.targetModule}
                  </td>
                  <td className="py-3 px-4 font-mono uppercase text-slate-600">
                    .{b.fileType}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-700 font-medium">
                    +{b.recordsInserted}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {b.recordsUpdated}
                  </td>
                  <td className="py-3 px-4 text-slate-700">{b.uploadedByName}</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {b.createdAt}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No document imports recorded yet.
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
