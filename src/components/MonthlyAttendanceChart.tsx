import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Camera, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type {
  MonthlyAttendanceDayPoint,
  MonthlyAttendanceTrendsPayload,
  ServerTimePayload,
} from '../types';

interface MonthlyAttendanceChartProps {
  token: string;
  serverTime: ServerTimePayload | null;
  onOpenAttendance: () => void;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: MonthlyAttendanceDayPoint }[];
}

function AttendanceTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[175px]">
      <div className="font-semibold text-slate-900 border-b border-slate-100 pb-1">
        {pt.label} · <span className="font-mono font-normal text-slate-500">{pt.date}</span>
      </div>
      <div className="space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Verified Present</span>
          <span className="font-semibold text-indigo-700">{pt.present}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Students</span>
          <span className="text-emerald-700">{pt.studentsPresent}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Faculty</span>
          <span className="text-slate-800">{pt.facultyPresent}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Rejected</span>
          <span className="text-red-700">{pt.rejected}</span>
        </div>
        {pt.verificationRate !== null && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100">
            <span className="text-slate-600 font-sans">Pass Rate</span>
            <span className="font-semibold text-slate-900">{pt.verificationRate}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function MonthlyAttendanceChart({
  token,
  serverTime,
  onOpenAttendance,
}: MonthlyAttendanceChartProps) {
  const defaultMonth = serverTime?.isoDate ? serverTime.isoDate.slice(0, 7) : '';
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [personFilter, setPersonFilter] = useState<'all' | 'student' | 'faculty'>('all');
  const [chartMode, setChartMode] = useState<'area' | 'bar'>('area');
  const [data, setData] = useState<MonthlyAttendanceTrendsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMonth && defaultMonth) {
      setSelectedMonth(defaultMonth);
    }
  }, [defaultMonth, selectedMonth]);

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getMonthlyAttendanceTrends(token, {
        month: selectedMonth || undefined,
        personType: personFilter === 'all' ? undefined : personFilter,
      });
      setData(res);
      if (!selectedMonth && res.month) {
        setSelectedMonth(res.month);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load monthly attendance trends.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, selectedMonth, personFilter]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header & Interactive Filters */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Monthly Attendance Trends · {data?.monthLabel ?? 'Current Month'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Daily dual-camera verified attendance counts across the department for the selected month.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="month"
            value={selectedMonth || data?.month || ''}
            onChange={(e) => setSelectedMonth(e.target.value)}
            aria-label="Select month for attendance trends"
            className="px-2.5 py-1.5 min-h-[36px] text-xs font-mono tabular-nums border border-slate-300 rounded-lg bg-white text-slate-800"
          />

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['all', 'student', 'faculty'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setPersonFilter(f)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  personFilter === f
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f === 'all' ? 'All' : f === 'student' ? 'Students' : 'Faculty'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setChartMode('area')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'area'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Trend
            </button>
            <button
              type="button"
              onClick={() => setChartMode('bar')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'bar'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Daily Bars
            </button>
          </div>
        </div>
      </div>

      {/* Unboxed Summary Strip */}
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums text-slate-600">
          <span>
            Verified Present:{' '}
            <strong className="text-indigo-700">{data?.totalPresent ?? 0}</strong>
          </span>
          <span>
            Students:{' '}
            <strong className="text-emerald-700">{data?.studentPresent ?? 0}</strong>
          </span>
          <span>
            Faculty: <strong className="text-slate-900">{data?.facultyPresent ?? 0}</strong>
          </span>
          <span>
            Rejected: <strong className="text-red-700">{data?.totalRejected ?? 0}</strong>
          </span>
          <span>
            Active Days: <strong className="text-slate-900">{data?.activeDays ?? 0}</strong>
          </span>
          <span>
            Verification Rate:{' '}
            <strong className="text-slate-900">
              {data && data.totalRecords > 0 ? `${data.overallRate}%` : '—'}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          {chartMode === 'area' ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600 inline-block" />
                Verified Present
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                Rejected
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                Students Present
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600 inline-block" />
                Faculty Present
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-red-600 inline-block" />
                Rejected
              </span>
            </>
          )}
        </div>
      </div>

      {/* Chart Canvas / Loading / Empty / Error */}
      <div className="p-5 sm:p-6">
        {loading ? (
          <div className="h-[260px] flex flex-col justify-between animate-pulse">
            <div className="h-full bg-slate-100 rounded-lg" />
          </div>
        ) : errorMsg ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-center gap-3">
            <p className="text-xs text-red-700">{errorMsg}</p>
            <button
              type="button"
              onClick={fetchTrends}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              Retry Loading Chart
            </button>
          </div>
        ) : !data || data.totalRecords === 0 ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-center px-4 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
              <Camera className="w-5 h-5" />
            </div>
            <div className="space-y-1 max-w-md">
              <p className="text-sm font-medium text-slate-900">
                No attendance logged yet for {data?.monthLabel ?? 'this month'}
              </p>
              <p className="text-xs text-slate-500">
                Daily attendance trends will plot automatically here as soon as students or department faculty mark attendance via the live dual-camera module.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenAttendance}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              Open Camera Attendance
            </button>
          </div>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {chartMode === 'area' ? (
                <AreaChart
                  data={data.days}
                  margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="cgPresentGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.22} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.01} />
                    </linearGradient>
                    <linearGradient id="cgRejectedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#DC2626" stopOpacity={0.16} />
                      <stop offset="95%" stopColor="#DC2626" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<AttendanceTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="present"
                    name="Verified Present"
                    stroke="#4F46E5"
                    strokeWidth={2}
                    fill="url(#cgPresentGrad)"
                    activeDot={{ r: 4, fill: '#4F46E5', strokeWidth: 0 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rejected"
                    name="Rejected"
                    stroke="#DC2626"
                    strokeWidth={1.75}
                    fill="url(#cgRejectedGrad)"
                    activeDot={{ r: 4, fill: '#DC2626', strokeWidth: 0 }}
                  />
                </AreaChart>
              ) : (
                <BarChart
                  data={data.days}
                  margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<AttendanceTooltip />} />
                  <Bar
                    dataKey="studentsPresent"
                    stackId="attendance"
                    name="Students Present"
                    fill="#059669"
                    radius={[0, 0, 0, 0]}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="facultyPresent"
                    stackId="attendance"
                    name="Faculty Present"
                    fill="#4F46E5"
                    radius={[0, 0, 0, 0]}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="rejected"
                    stackId="attendance"
                    name="Rejected"
                    fill="#DC2626"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
