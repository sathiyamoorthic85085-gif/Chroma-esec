import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Trophy, Users, X } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { LeaderboardAndBuddiesPayload, TopPerformerItem } from '../types';

interface TopPerformersAndStudyBuddySectionProps {
  token: string;
  refreshKey?: number;
}

export function TopPerformersAndStudyBuddySection({
  token,
  refreshKey = 0,
}: TopPerformersAndStudyBuddySectionProps) {
  const [data, setData] = useState<LeaderboardAndBuddiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullModalOpen, setFullModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<TopPerformerItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getLeaderboardAndBuddies(token);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leaderboard and pairings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  const performers = data?.performers ?? [];
  const studyBuddies = data?.studyBuddies ?? [];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Top Performers Leaderboard Card */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Top Performers</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ranked by engagement score &amp; attendance streaks · Click any student for history
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setFullModalOpen(true)}
              disabled={performers.length === 0}
              className="px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              View Full Rankings
            </button>
          </div>

          {error && <div className="px-6 py-4 text-xs text-rose-700">{error}</div>}

          {loading && !data ? (
            <div className="px-6 py-10 text-center text-xs text-slate-500">
              Calculating cumulative rankings...
            </div>
          ) : performers.length === 0 ? (
            <div className="px-6 py-10 text-center text-xs text-slate-500">
              No student performance records available yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 flex-1">
              {performers.slice(0, 5).map((item) => (
                <div
                  key={item.rollNo}
                  className="px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-semibold tabular-nums text-slate-500 w-6 shrink-0">
                      #{item.rank}
                    </span>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedStudent(item)}
                        className="text-sm font-semibold text-indigo-800 hover:text-indigo-950 hover:underline text-left truncate block"
                      >
                        {item.fullName}
                      </button>
                      <div className="text-xs text-slate-500 font-mono tabular-nums truncate">
                        {item.rollNo} · {item.yearOfStudy}{' '}
                        {item.section ? `Sec ${item.section}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono text-xs tabular-nums shrink-0">
                    <div className="font-semibold text-slate-900">
                      {item.engagementScore.toFixed(1)} eng · {item.streakDays}d streak
                    </div>
                    <div className="text-slate-500">
                      {item.attendanceRate.toFixed(1)}% att · {item.badgesCount} badge
                      {item.badgesCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Study Buddy Pairing Card */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Study Buddy Pairing</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Complementary peer matches pairing high-consistency students with peers needing a boost
              </p>
            </div>
          </div>

          {loading && !data ? (
            <div className="px-6 py-10 text-center text-xs text-slate-500">
              Matching peer study partners...
            </div>
          ) : studyBuddies.length === 0 ? (
            <div className="px-6 py-10 text-center text-xs text-slate-500">
              Add at least two students in a cohort to generate Study Buddy pairings.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 flex-1 max-h-[380px] overflow-y-auto">
              {studyBuddies.map((pair) => (
                <div key={pair.id} className="px-6 py-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-700 font-semibold">
                      {pair.focusArea}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {pair.mentor.yearOfStudy}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex-1 min-w-0 border border-emerald-200 bg-emerald-50/40 rounded px-2.5 py-2">
                      <div className="text-[10px] font-mono uppercase text-emerald-800">Mentor</div>
                      <div className="font-semibold text-slate-900 truncate">
                        {pair.mentor.fullName}
                      </div>
                      <div className="font-mono text-[11px] tabular-nums text-slate-600">
                        {pair.mentor.attendanceRate.toFixed(0)}% · {pair.mentor.engagementScore.toFixed(0)} eng
                      </div>
                    </div>

                    <ArrowLeftRight className="w-4 h-4 text-slate-400 shrink-0" />

                    <div className="flex-1 min-w-0 border border-amber-200 bg-amber-50/40 rounded px-2.5 py-2">
                      <div className="text-[10px] font-mono uppercase text-amber-800">Peer</div>
                      <div className="font-semibold text-slate-900 truncate">
                        {pair.mentee.fullName}
                      </div>
                      <div className="font-mono text-[11px] tabular-nums text-slate-600">
                        {pair.mentee.attendanceRate.toFixed(0)}% · {pair.mentee.engagementScore.toFixed(0)} eng
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">{pair.matchReason}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* View Full Rankings Modal */}
      {fullModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label="Full Top Performers Rankings"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  Full Department Performers Leaderboard
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any student name to inspect their individual attendance trend and engagement history
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFullModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Close rankings modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Rank</th>
                    <th className="px-4 py-2.5 font-medium">Student</th>
                    <th className="px-4 py-2.5 font-medium">Cohort</th>
                    <th className="px-4 py-2.5 font-medium">Attendance</th>
                    <th className="px-4 py-2.5 font-medium">Engagement</th>
                    <th className="px-4 py-2.5 font-medium">Streak</th>
                    <th className="px-4 py-2.5 font-medium">Badges</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 tabular-nums">
                  {performers.map((p) => (
                    <tr key={p.rollNo} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono font-semibold text-slate-600">
                        #{p.rank}
                      </td>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setSelectedStudent(p)}
                          className="font-semibold text-indigo-800 hover:underline text-left"
                        >
                          {p.fullName}
                        </button>
                        <div className="font-mono text-[11px] text-slate-500">{p.rollNo}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">
                        {p.yearOfStudy} {p.section ? `Sec ${p.section}` : ''}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-800">
                        {p.attendanceRate.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-800">
                        {p.engagementScore.toFixed(1)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-800">{p.streakDays}d</td>
                      <td className="px-4 py-2.5 font-mono text-slate-800">{p.badgesCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Individual Student Attendance & Engagement History Modal */}
      {selectedStudent && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedStudent.fullName} performance history`}
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  {selectedStudent.fullName} — Individual Trend &amp; History
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                  {selectedStudent.rollNo} · {selectedStudent.yearOfStudy}{' '}
                  {selectedStudent.section ? `Sec ${selectedStudent.section}` : ''} · Rank #
                  {selectedStudent.rank}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStudent(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Close student history modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                <div className="border border-slate-200 rounded-lg p-3">
                  <div className="text-[11px] font-sans text-slate-500">Attendance Rate</div>
                  <div className="text-lg font-semibold text-indigo-700 mt-0.5">
                    {selectedStudent.attendanceRate.toFixed(1)}%
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3">
                  <div className="text-[11px] font-sans text-slate-500">Engagement Score</div>
                  <div className="text-lg font-semibold text-emerald-700 mt-0.5">
                    {selectedStudent.engagementScore.toFixed(1)}
                  </div>
                </div>
                <div className="border border-slate-200 rounded-lg p-3">
                  <div className="text-[11px] font-sans text-slate-500">Active Streak</div>
                  <div className="text-lg font-semibold text-slate-900 mt-0.5">
                    {selectedStudent.streakDays} days
                  </div>
                </div>
              </div>

              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={selectedStudent.history}
                    margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="attendanceRate"
                      name="Attendance Rate (%)"
                      stroke="#4338ca"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="engagementScore"
                      name="Engagement Score"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
