import { useCallback, useEffect, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import type { AttendancePersonType, WeeklyAttendanceTrendsPayload } from '../types';

interface WeeklyAttendanceChartProps {
  token: string;
  refreshSignal?: number;
}

export function WeeklyAttendanceChart({
  token,
  refreshSignal = 0,
}: WeeklyAttendanceChartProps) {
  const [data, setData] = useState<WeeklyAttendanceTrendsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartScope, setChartScope] = useState<'weekly_6w' | 'current_week'>('weekly_6w');
  const [personFilter, setPersonFilter] = useState<'all' | AttendancePersonType>('all');

  const loadTrends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getWeeklyAttendanceTrends(token, {
        weeks: 6,
        personType: personFilter === 'all' ? undefined : personFilter,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load weekly attendance trends.');
    } finally {
      setLoading(false);
    }
  }, [token, personFilter]);

  useEffect(() => {
    loadTrends();
  }, [loadTrends, refreshSignal]);

  const chartData =
    chartScope === 'weekly_6w'
      ? (data?.weeklyHistory ?? []).map((w) => ({
          name: w.label,
          present: w.present,
          students: w.studentsPresent,
          faculty: w.facultyPresent,
          rejected: w.rejected,
          rate: w.verificationRate,
        }))
      : (data?.currentWeekDays ?? []).map((d) => ({
          name: d.shortDay,
          present: d.present,
          students: d.studentsPresent,
          faculty: d.facultyPresent,
          rejected: d.rejected,
          rate: d.verificationRate,
        }));

  const hasRecords = (data?.totalPresent ?? 0) + (data?.totalRejected ?? 0) > 0;

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span>Weekly Attendance Fluctuations</span>
            <span aria-hidden="true">·</span>
            <span>{data?.departmentName ?? 'Department'}</span>
            {data?.currentWeekRangeLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Current Week: {data.currentWeekRangeLabel}
                </span>
              </>
            )}
          </div>
          <h3 className="text-base font-semibold text-slate-900 mt-1">
            Department Weekly Attendance Trends
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Scope Switcher */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setChartScope('weekly_6w')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartScope === 'weekly_6w'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              6-Week Trend
            </button>
            <button
              type="button"
              onClick={() => setChartScope('current_week')}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartScope === 'current_week'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Week (Mon–Sat)
            </button>
          </div>

          {/* Audience Filter */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'student', label: 'Students' },
                { id: 'faculty', label: 'Faculty' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPersonFilter(opt.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  personFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadTrends}
            aria-label="Refresh weekly trends"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Strip (clean flat divider row, tabular numerals) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3.5 border-y border-slate-200">
        <div>
          <div className="text-xs text-slate-500">Verified Present (6 Wks)</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-slate-900 mt-0.5">
            {data?.totalPresent ?? 0}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Verification Rate</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-emerald-700 mt-0.5">
            {data?.overallRate ?? 0}%
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Students / Faculty</div>
          <div className="font-mono text-xl font-semibold tabular-nums text-indigo-800 mt-0.5">
            {data?.studentPresent ?? 0} / {data?.facultyPresent ?? 0}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Week-over-Week Change</div>
          <div className="flex items-center gap-1.5 font-mono text-xl font-semibold tabular-nums mt-0.5">
            {data?.weekOverWeekDeltaPct === null || data?.weekOverWeekDeltaPct === undefined ? (
              <span className="text-slate-400 text-base font-normal">Baseline</span>
            ) : data.weekOverWeekDeltaPct >= 0 ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <TrendingUp className="w-4 h-4" />
                +{data.weekOverWeekDeltaPct}%
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-rose-700">
                <TrendingDown className="w-4 h-4" />
                {data.weekOverWeekDeltaPct}%
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Recharts Visual Fluctuation Chart */}
      <div className="h-[270px] w-full">
        {loading && !data ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500">
            Loading weekly attendance fluctuations...
          </div>
        ) : !hasRecords ? (
          <div className="h-full flex flex-col items-center justify-center text-center border border-dashed border-slate-200 rounded-lg p-6">
            <p className="text-sm font-medium text-slate-800">
              No weekly camera attendance data recorded yet
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              Capture verified live dual-camera attendance below to populate department weekly fluctuations and verification rate trends automatically.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="weeklyPresentFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4338CA" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#4338CA" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: '#64748B' }}
                axisLine={{ stroke: '#E2E8F0' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#64748B' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                unit="%"
                tick={{ fontSize: 11, fill: '#64748B' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderColor: '#E2E8F0',
                  borderRadius: '8px',
                  fontSize: '12px',
                  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                }}
                formatter={(value: unknown, name: unknown) => {
                  const label = String(name ?? '');
                  if (label === 'rate') return [`${value}%`, 'Verification Rate'];
                  if (label === 'present') return [String(value), 'Verified Present'];
                  if (label === 'rejected') return [String(value), 'Rejected Captures'];
                  return [String(value), label];
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="present"
                name="present"
                stroke="#4338CA"
                strokeWidth={2.2}
                fill="url(#weeklyPresentFill)"
                activeDot={{ r: 5 }}
              />
              <Bar
                yAxisId="left"
                dataKey="rejected"
                name="rejected"
                fill="#E11D48"
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="rate"
                name="rate"
                stroke="#059669"
                strokeWidth={2}
                dot={{ r: 3.5, fill: '#059669' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Clean unboxed legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-indigo-700 inline-block" />
          Verified Present
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-rose-600 rounded-xs inline-block" />
          Rejected Captures
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-0.5 bg-emerald-600 inline-block" />
          Verification Rate (%)
        </span>
      </div>
    </section>
  );
}
