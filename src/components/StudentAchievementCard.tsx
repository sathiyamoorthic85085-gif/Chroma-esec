import { useCallback, useEffect, useState } from 'react';
import { Award, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import type { StudentAchievementBadge, StudentAchievementsPayload } from '../types';

interface StudentAchievementCardProps {
  token: string;
  refreshKey?: number;
}

const TIER_TEXT_CLASSES: Record<StudentAchievementBadge['tier'], string> = {
  platinum: 'text-indigo-800 border-indigo-200 bg-indigo-50/70',
  gold: 'text-amber-800 border-amber-200 bg-amber-50/70',
  silver: 'text-slate-700 border-slate-200 bg-slate-50',
};

export function StudentAchievementCard({ token, refreshKey = 0 }: StudentAchievementCardProps) {
  const [selectedBatch, setSelectedBatch] = useState<string>('all');
  const [data, setData] = useState<StudentAchievementsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAchievements = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getStudentAchievements(token, selectedBatch);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load student achievements.');
    } finally {
      setLoading(false);
    }
  }, [token, selectedBatch]);

  useEffect(() => {
    loadAchievements();
  }, [loadAchievements, refreshKey]);

  const studentsWithBadges = data?.students ?? [];
  const availableBatches = data?.availableBatches ?? [];

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Student Achievement</h3>
            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
              Digital badges awarded for consistent attendance and top-tier academic engagement ·{' '}
              {data ? `${data.totalAwardsCount} badge${data.totalAwardsCount === 1 ? '' : 's'} earned` : 'Syncing'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="achievement-batch-filter" className="sr-only">
            Filter achievements by academic batch
          </label>
          <select
            id="achievement-batch-filter"
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-800 focus:outline-none focus:border-indigo-700"
          >
            <option value="all">All Batches / Cohorts</option>
            {availableBatches.map((batch) => (
              <option key={batch} value={batch}>
                {batch}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={loadAchievements}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="px-6 py-4 text-xs text-rose-700">{error}</div>}

      {loading && !data ? (
        <div className="px-6 py-10 text-center text-xs text-slate-500">
          Evaluating attendance streaks and engagement badges...
        </div>
      ) : studentsWithBadges.length === 0 ? (
        <div className="px-6 py-10 text-center text-xs text-slate-500">
          No achievement badges found for the selected batch filter yet. Badges appear as attendance streaks and engagement scores accumulate.
        </div>
      ) : (
        <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
          {studentsWithBadges.slice(0, 12).map((student) => (
            <div
              key={student.rollNo}
              className="px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-slate-900">{student.fullName}</span>
                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                    {student.rollNo}
                  </span>
                  <span className="text-xs text-slate-500">
                    · {student.yearOfStudy} {student.section ? `Sec ${student.section}` : ''}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 font-mono tabular-nums">
                  <span>Attendance: {student.attendanceRate.toFixed(1)}%</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span>Engagement: {student.engagementScore.toFixed(1)}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span>Streak: {student.streakDays}d</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {student.badges.map((badge) => (
                  <div
                    key={`${student.rollNo}-${badge.code}`}
                    title={badge.criteria}
                    className={`px-2.5 py-1 border rounded text-[11px] font-medium ${TIER_TEXT_CLASSES[badge.tier]}`}
                  >
                    <span className="uppercase tracking-wider text-[10px] font-mono mr-1.5 opacity-80">
                      {badge.tier}
                    </span>
                    <span>{badge.title}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
