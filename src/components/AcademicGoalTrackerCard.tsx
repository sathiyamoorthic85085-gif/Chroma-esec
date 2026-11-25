import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  History,
  Save,
  Target,
  X,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { AcademicGoalPayload, UserProfile } from '../types';

interface AcademicGoalTrackerCardProps {
  token: string;
  user: UserProfile;
  refreshKey?: number;
}

export function AcademicGoalTrackerCard({
  token,
  user,
  refreshKey = 0,
}: AcademicGoalTrackerCardProps) {
  const [goal, setGoal] = useState<AcademicGoalPayload | null>(null);
  const [attendanceTarget, setAttendanceTarget] = useState<number>(85);
  const [engagementTarget, setEngagementTarget] = useState<number>(80);
  const [note, setNote] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [nudging, setNudging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadGoal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyAcademicGoal(token);
      setGoal(res.goal);
      setAttendanceTarget(res.goal.weeklyAttendanceTarget);
      setEngagementTarget(res.goal.weeklyEngagementTarget);
      setNote(res.goal.note || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load goal tracker.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadGoal();
  }, [loadGoal, refreshKey]);

  const handleSaveTargets = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.saveMyAcademicGoal(token, {
        weeklyAttendanceTarget: Math.min(100, Math.max(1, Number(attendanceTarget) || 85)),
        weeklyEngagementTarget: Math.min(100, Math.max(1, Number(engagementTarget) || 80)),
        note,
      });
      setGoal(res.goal);
      setFeedback('Weekly targets saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save weekly targets.');
    } finally {
      setSaving(false);
    }
  };

  const handleDailyCheckIn = async () => {
    setCheckingIn(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.checkInAcademicGoal(token, note);
      setGoal(res.goal);
      setFeedback('Daily activity check-in recorded for today.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record check-in.');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleSendDailyNudges = async () => {
    setNudging(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.triggerGoalDailyNudgeCheck(token);
      setFeedback(
        res.nudgedCount > 0
          ? `Sent daily goal check-in nudges to ${res.nudgedCount} student${res.nudgedCount === 1 ? '' : 's'} with no update today (${res.isoDate}).`
          : `All tracked students have already updated their goal activity for ${res.isoDate}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to trigger daily nudges.');
    } finally {
      setNudging(false);
    }
  };

  const canBroadcastNudges = user.role === 'hod' || user.role === 'class_advisor';
  const attendanceProgress = goal
    ? Math.min(100, Math.round((goal.currentAttendancePct / Math.max(1, goal.weeklyAttendanceTarget)) * 100))
    : 0;
  const engagementProgress = goal
    ? Math.min(100, Math.round((goal.currentEngagementPct / Math.max(1, goal.weeklyEngagementTarget)) * 100))
    : 0;

  return (
    <>
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Target className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Academic Goal Tracker</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Weekly targets for attendance and academic engagement with daily activity check-ins
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              disabled={!goal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <History className="w-3.5 h-3.5" />
              View History
            </button>

            <button
              type="button"
              onClick={handleDailyCheckIn}
              disabled={checkingIn || !goal}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                goal?.checkedInToday
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                  : 'bg-indigo-700 hover:bg-indigo-800 text-white'
              } disabled:opacity-60`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {checkingIn
                ? 'Logging...'
                : goal?.checkedInToday
                ? 'Checked In Today'
                : 'Log Daily Check-in'}
            </button>

            {canBroadcastNudges && (
              <button
                type="button"
                onClick={handleSendDailyNudges}
                disabled={nudging}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                <BellRing className="w-3.5 h-3.5" />
                {nudging ? 'Nudging...' : 'Send Daily Nudges'}
              </button>
            )}
          </div>
        </div>

        {loading && !goal ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500">
            Loading weekly goal targets and semester history...
          </div>
        ) : goal ? (
          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Progress Bars */}
            <div className="lg:col-span-7 space-y-5">
              <div>
                <div className="flex items-baseline justify-between gap-2 text-xs mb-1.5">
                  <span className="font-medium text-slate-800">Weekly Attendance Status</span>
                  <span className="font-mono tabular-nums text-slate-700">
                    {goal.currentAttendancePct.toFixed(1)}% / {goal.weeklyAttendanceTarget}% target
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      goal.currentAttendancePct >= goal.weeklyAttendanceTarget
                        ? 'bg-emerald-600'
                        : 'bg-indigo-600'
                    }`}
                    style={{ width: `${attendanceProgress}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
                  Goal completion: {attendanceProgress}%
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2 text-xs mb-1.5">
                  <span className="font-medium text-slate-800">Weekly Engagement Status</span>
                  <span className="font-mono tabular-nums text-slate-700">
                    {goal.currentEngagementPct.toFixed(1)} / {goal.weeklyEngagementTarget} target
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      goal.currentEngagementPct >= goal.weeklyEngagementTarget
                        ? 'bg-emerald-600'
                        : 'bg-amber-600'
                    }`}
                    style={{ width: `${engagementProgress}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
                  Goal completion: {engagementProgress}% · Last check-in:{' '}
                  {goal.lastCheckedInDate || 'Not logged yet'}
                </div>
              </div>

              {feedback && (
                <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {feedback}
                </div>
              )}
              {error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Target Editor Form */}
            <form
              onSubmit={handleSaveTargets}
              className="lg:col-span-5 border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/50"
            >
              <div className="text-xs font-semibold text-slate-900">Set Weekly Targets</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="goal-att-target"
                    className="block text-[11px] text-slate-600 mb-1"
                  >
                    Attendance (%)
                  </label>
                  <input
                    id="goal-att-target"
                    type="number"
                    min={1}
                    max={100}
                    value={attendanceTarget}
                    onChange={(e) => setAttendanceTarget(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="goal-eng-target"
                    className="block text-[11px] text-slate-600 mb-1"
                  >
                    Engagement (pts)
                  </label>
                  <input
                    id="goal-eng-target"
                    type="number"
                    min={1}
                    max={100}
                    value={engagementTarget}
                    onChange={(e) => setEngagementTarget(Number(e.target.value))}
                    className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="goal-note" className="block text-[11px] text-slate-600 mb-1">
                  Weekly Focus Note
                </label>
                <input
                  id="goal-note"
                  type="text"
                  maxLength={160}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Zero missed morning labs this week"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving Targets...' : 'Save Targets'}
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {/* Semester Target Completion History Modal */}
      {historyOpen && goal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-label="Academic Goal Semester History"
        >
          <div className="bg-white border border-slate-200 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">
                  Semester Weekly Target Completion History
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Weekly attendance &amp; engagement performance versus your configured semester targets
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Close goal history modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={goal.semesterHistory}
                    margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine
                      y={goal.weeklyAttendanceTarget}
                      stroke="#4338ca"
                      strokeDasharray="4 4"
                      label={{ value: `Target ${goal.weeklyAttendanceTarget}%`, position: 'insideTopRight', fontSize: 10, fill: '#4338ca' }}
                    />
                    <Bar
                      dataKey="attendancePct"
                      name="Attendance (%)"
                      fill="#4f46e5"
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="engagementPct"
                      name="Engagement Score"
                      stroke="#059669"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Week</th>
                      <th className="px-4 py-2.5 font-medium">Attendance</th>
                      <th className="px-4 py-2.5 font-medium">Engagement</th>
                      <th className="px-4 py-2.5 font-medium">Check-ins</th>
                      <th className="px-4 py-2.5 font-medium">Target Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono tabular-nums">
                    {goal.semesterHistory.map((row) => (
                      <tr key={row.weekStart}>
                        <td className="px-4 py-2.5 font-sans text-slate-800">{row.weekLabel}</td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {row.attendancePct.toFixed(1)}% / {row.attendanceTarget}%
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {row.engagementPct.toFixed(1)} / {row.engagementTarget}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{row.checkInsCount}</td>
                        <td
                          className={`px-4 py-2.5 font-sans font-medium ${
                            row.completedTargets ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {row.completedTargets ? 'Target Met' : 'In Progress'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
