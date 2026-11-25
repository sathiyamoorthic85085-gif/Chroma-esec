import { useCallback, useEffect, useState } from 'react';
import { Archive, DatabaseBackup, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { ArchivalRecordSummary, UserProfile } from '../types';

interface DailyArchivalCardProps {
  token: string;
  user: UserProfile;
}

export function DailyArchivalCard({ token, user }: DailyArchivalCardProps) {
  const [logs, setLogs] = useState<ArchivalRecordSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getArchivalLogs(token);
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load archival logs.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  if (user.role !== 'hod' && user.role !== 'class_advisor') {
    return null;
  }

  const handleManualBackup = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await api.triggerManualArchival(token);
      setLogs((prev) => [res.record, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run manual backup.');
    } finally {
      setRunning(false);
    }
  };

  const latest = logs[0] ?? null;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Archive className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Automated Daily Archival &amp; Cloud Storage Backup
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Automated daily 23:55 snapshot of attendance and engagement logs with SHA-256 verification
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadLogs}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          {user.role === 'hod' && (
            <button
              type="button"
              onClick={handleManualBackup}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <DatabaseBackup className="w-3.5 h-3.5" />
              {running ? 'Archiving...' : 'Run Backup Now'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="px-6 py-3 text-xs text-rose-700">{error}</div>}

      {latest && (
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="font-mono tabular-nums text-slate-700 truncate">
            Latest Path: <span className="font-semibold text-slate-900">{latest.storagePath}</span>
          </div>
          <div className="font-mono tabular-nums text-slate-600">
            SHA-256: {latest.checksumSha256.slice(0, 16)}… · {latest.attendanceCount} attendance /{' '}
            {latest.studentsCount} student rows
          </div>
        </div>
      )}

      {loading && logs.length === 0 ? (
        <div className="px-6 py-8 text-center text-xs text-slate-500">
          Loading archival backup records...
        </div>
      ) : logs.length === 0 ? (
        <div className="px-6 py-8 text-center text-xs text-slate-500">
          No archival snapshots recorded yet. Automated daily backups execute at 23:55 server academic time.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-6 py-2.5 font-medium">Archive Date</th>
                <th className="px-6 py-2.5 font-medium">Storage Path</th>
                <th className="px-6 py-2.5 font-medium">Records</th>
                <th className="px-6 py-2.5 font-medium">SHA-256 Checksum</th>
                <th className="px-6 py-2.5 font-medium">Trigger</th>
                <th className="px-6 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
              {logs.slice(0, 8).map((log) => (
                <tr key={log.id}>
                  <td className="px-6 py-2.5 text-slate-900">{log.archiveDate}</td>
                  <td className="px-6 py-2.5 text-slate-600 max-w-[260px] truncate">
                    {log.storagePath}
                  </td>
                  <td className="px-6 py-2.5 text-slate-700">
                    {log.attendanceCount} att · {log.studentsCount} stu
                  </td>
                  <td className="px-6 py-2.5 text-slate-600">
                    {log.checksumSha256.slice(0, 14)}…
                  </td>
                  <td className="px-6 py-2.5 font-sans capitalize text-slate-700">
                    {log.triggerType}
                  </td>
                  <td
                    className={`px-6 py-2.5 font-sans font-medium capitalize ${
                      log.status === 'completed' ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {log.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
