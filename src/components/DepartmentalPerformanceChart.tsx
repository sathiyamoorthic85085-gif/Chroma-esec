import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Camera,
  Download,
  GraduationCap,
  ScatterChart as ScatterIcon,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { api } from '../lib/api';
import { notifyExportSaved } from '../lib/exportNotify';
import type { BatchPerformancePoint, DepartmentalPerformancePayload } from '../types';

interface DepartmentalPerformanceChartProps {
  token: string;
  refreshKey?: number;
  onOpenAttendance: () => void;
  onOpenStudents: () => void;
}

interface PerformanceTooltipProps {
  active?: boolean;
  payload?: { payload: BatchPerformancePoint }[];
}

function BatchPerformanceTooltip({ active, payload }: PerformanceTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  const gap = Math.round((pt.academicEngagementScore - pt.averageAttendanceRate) * 10) / 10;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-3 text-xs space-y-2 min-w-[230px]">
      <div className="border-b border-slate-100 pb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-semibold text-slate-900">{pt.batchLabel}</span>
        <span className="font-mono tabular-nums text-[11px] text-slate-500">
          {pt.studentCount} student{pt.studentCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-1 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Avg Attendance</span>
          <span className="font-semibold text-indigo-700">
            {pt.hasAttendanceData ? `${pt.averageAttendanceRate.toFixed(1)}%` : 'No logs yet'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-600 font-sans">Academic Engagement</span>
          <span className="font-semibold text-emerald-700">
            {pt.academicEngagementScore.toFixed(1)} / 100
          </span>
        </div>
        {pt.hasAttendanceData && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500 font-sans">Attendance Logs</span>
            <span className="text-slate-700">
              {pt.attendancePresentCount} present
              {pt.attendanceOdCount > 0 ? ` · ${pt.attendanceOdCount} OD` : ''} / {pt.attendanceTotalLogs}
            </span>
          </div>
        )}
      </div>

      <div className="pt-1.5 border-t border-slate-100 space-y-1 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 font-sans">Avg CGPA</span>
          <span className="text-slate-800">
            {pt.averageCgpa !== null ? pt.averageCgpa.toFixed(2) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 font-sans">Power Boost Ack Rate</span>
          <span className="text-slate-800">
            {pt.powerBoostResponseRate !== null ? `${pt.powerBoostResponseRate}%` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 font-sans">Portal &amp; Chat Activity</span>
          <span className="text-slate-800">{pt.portalParticipationRate}%</span>
        </div>
        {pt.hasAttendanceData && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100">
            <span className="text-slate-500 font-sans">Engagement vs. Attendance</span>
            <span className={gap >= 0 ? 'text-emerald-700' : 'text-amber-700'}>
              {gap > 0 ? `+${gap}` : gap} pts
            </span>
          </div>
        )}
      </div>

      <div className="pt-1 border-t border-slate-100 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">Standing</span>
        <span className="font-medium text-slate-900">{pt.standing}</span>
      </div>
    </div>
  );
}

function getStandingTextClass(standing: BatchPerformancePoint['standing']): string {
  switch (standing) {
    case 'High Performing':
      return 'text-emerald-700 font-medium';
    case 'On Track':
      return 'text-indigo-700 font-medium';
    case 'Attendance Watch':
      return 'text-amber-700 font-medium';
    case 'Engagement Watch':
      return 'text-rose-700 font-medium';
    default:
      return 'text-slate-500';
  }
}

export function DepartmentalPerformanceChart({
  token,
  refreshKey = 0,
  onOpenAttendance,
  onOpenStudents,
}: DepartmentalPerformanceChartProps) {
  const [groupBy, setGroupBy] = useState<'year' | 'section'>('year');
  const [chartMode, setChartMode] = useState<'comparison' | 'correlation'>('comparison');
  const [data, setData] = useState<DepartmentalPerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.getDepartmentalPerformance(token, groupBy);
      setData(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load departmental performance data.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, groupBy]);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance, refreshKey]);

  const hasBatches = Boolean(data && data.batches.length > 0);

  const handleDownloadCsv = () => {
    if (!data || data.batches.length === 0) return;
    const escapeCsv = (val: string | number | null): string => {
      let str = val === null || val === undefined ? '' : String(val);
      if (/^[=+\-@\t\r]/.test(str)) {
        str = `'${str}`;
      }
      if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Batch',
      'Students',
      'Avg CGPA',
      'Avg Attendance (%)',
      'Academic Engagement Score',
      'Power Boost Ack Rate (%)',
      'Portal & Chat Participation (%)',
      'Attendance Present Count',
      'Attendance OD Count',
      'Attendance Total Logs',
      'Standing',
    ];
    const rows = data.batches.map((b) =>
      [
        b.batchLabel,
        b.studentCount,
        b.averageCgpa !== null ? b.averageCgpa.toFixed(2) : '',
        b.hasAttendanceData ? b.averageAttendanceRate.toFixed(1) : 'No logs',
        b.academicEngagementScore.toFixed(1),
        b.powerBoostResponseRate !== null ? b.powerBoostResponseRate : '',
        b.portalParticipationRate,
        b.attendancePresentCount,
        b.attendanceOdCount,
        b.attendanceTotalLogs,
        b.standing,
      ]
        .map(escapeCsv)
        .join(',')
    );

    const csvContent = [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = `ChromaGrade_Departmental_Performance_${groupBy}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    notifyExportSaved(filename, 'CSV');
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Header & Interactive Controls */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Departmental Performance · Attendance vs. Academic Engagement
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Compares verified average attendance rate against composite academic engagement (CGPA, Power Boost responses, and community participation) across student batches.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setGroupBy('year')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                groupBy === 'year'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Year Batch
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('section')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                groupBy === 'section'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              By Section
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setChartMode('comparison')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'comparison'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Batch Bars
            </button>
            <button
              type="button"
              onClick={() => setChartMode('correlation')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'correlation'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ScatterIcon className="w-3.5 h-3.5" />
              Correlation
            </button>
          </div>

          <button
            type="button"
            disabled={!hasBatches || loading}
            onClick={handleDownloadCsv}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download Report
          </button>
        </div>
      </div>

      {/* Unboxed Tabular Summary Strip */}
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-5 font-mono tabular-nums text-slate-600">
          <span>
            Batches: <strong className="text-slate-900">{data?.totalBatches ?? 0}</strong>
          </span>
          <span>
            Dept Avg Attendance:{' '}
            <strong className="text-indigo-700">
              {data && data.batchesWithAttendanceData > 0
                ? `${data.departmentAverageAttendance.toFixed(1)}%`
                : '—'}
            </strong>
          </span>
          <span>
            Avg Engagement Score:{' '}
            <strong className="text-emerald-700">
              {hasBatches ? `${data!.departmentAverageEngagement.toFixed(1)} / 100` : '—'}
            </strong>
          </span>
          {data?.topPerformingBatch && (
            <span className="font-sans">
              Leading Batch:{' '}
              <strong className="text-slate-900">{data.topPerformingBatch}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-indigo-600 inline-block" />
            Avg Attendance (%)
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
            Engagement Score
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-3 border-t border-dashed border-amber-600 inline-block" />
            75% Benchmark
          </span>
        </div>
      </div>

      {/* Main Chart Body */}
      <div className="p-5 sm:p-6">
        {loading ? (
          <div className="h-[280px] flex flex-col justify-between animate-pulse">
            <div className="h-full bg-slate-100 rounded-lg" />
          </div>
        ) : errorMsg ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-center gap-3">
            <p className="text-xs text-rose-700">{errorMsg}</p>
            <button
              type="button"
              onClick={fetchPerformance}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              Retry Loading Metrics
            </button>
          </div>
        ) : !hasBatches ? (
          <div className="h-[240px] flex flex-col items-center justify-center text-center px-4 space-y-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center">
              <GraduationCap className="w-5 h-5" />
            </div>
            <div className="space-y-1 max-w-md">
              <p className="text-sm font-medium text-slate-900">
                No student batches enrolled yet
              </p>
              <p className="text-xs text-slate-500">
                Add or upload student batch records to compare average attendance rates and academic engagement scores across cohorts.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={onOpenStudents}
                className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <GraduationCap className="w-3.5 h-3.5" />
                Open Students Directory
              </button>
              <button
                type="button"
                onClick={onOpenAttendance}
                className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5" />
                Camera Attendance
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'comparison' ? (
                  <ComposedChart
                    data={data!.batches}
                    margin={{ top: 12, right: 16, left: -12, bottom: 4 }}
                    barGap={6}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis
                      dataKey="batchLabel"
                      tick={{ fontSize: 11, fill: '#475569' }}
                      tickLine={false}
                      axisLine={{ stroke: '#CBD5E1' }}
                      interval={0}
                      angle={data!.batches.length > 6 ? -20 : 0}
                      textAnchor={data!.batches.length > 6 ? 'end' : 'middle'}
                      height={data!.batches.length > 6 ? 48 : 30}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => `${value}%`}
                    />
                    <Tooltip
                      content={<BatchPerformanceTooltip />}
                      cursor={{ fill: 'rgba(241, 245, 249, 0.7)' }}
                    />
                    <ReferenceLine
                      y={75}
                      stroke="#D97706"
                      strokeDasharray="4 4"
                      strokeWidth={1.25}
                      label={{
                        value: '75% Target',
                        position: 'insideTopRight',
                        fill: '#B45309',
                        fontSize: 10,
                      }}
                    />
                    <Bar
                      dataKey="averageAttendanceRate"
                      name="Avg Attendance (%)"
                      fill="#4F46E5"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={32}
                    />
                    <Bar
                      dataKey="academicEngagementScore"
                      name="Academic Engagement"
                      fill="#059669"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={32}
                    />
                    <Line
                      type="monotone"
                      dataKey="academicEngagementScore"
                      name="Engagement Curve"
                      stroke="#047857"
                      strokeWidth={1.75}
                      dot={{ r: 3, fill: '#047857', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#047857', stroke: '#FFFFFF', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                ) : (
                  <ScatterChart margin={{ top: 14, right: 20, left: -8, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis
                      type="number"
                      dataKey="averageAttendanceRate"
                      name="Avg Attendance"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={{ stroke: '#CBD5E1' }}
                      tickFormatter={(value: number) => `${value}%`}
                      label={{
                        value: 'Average Attendance (%)',
                        position: 'insideBottom',
                        offset: -8,
                        fill: '#64748B',
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="academicEngagementScore"
                      name="Engagement Score"
                      domain={[0, 100]}
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value: number) => `${value}`}
                      label={{
                        value: 'Engagement Score',
                        angle: -90,
                        position: 'insideLeft',
                        offset: 18,
                        fill: '#64748B',
                        fontSize: 11,
                      }}
                    />
                    <ZAxis
                      type="number"
                      dataKey="studentCount"
                      range={[120, 420]}
                      name="Students"
                    />
                    <Tooltip
                      content={<BatchPerformanceTooltip />}
                      cursor={{ strokeDasharray: '3 3', stroke: '#94A3B8' }}
                    />
                    <ReferenceLine x={75} stroke="#D97706" strokeDasharray="4 4" />
                    <ReferenceLine y={75} stroke="#D97706" strokeDasharray="4 4" />
                    <Scatter
                      name="Student Batches"
                      data={data!.batches}
                      fill="#4F46E5"
                      fillOpacity={0.82}
                      stroke="#312E81"
                      strokeWidth={1.5}
                    />
                  </ScatterChart>
                )}
              </ResponsiveContainer>
            </div>

            {data!.batchesWithAttendanceData === 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200 text-xs text-slate-600">
                <span>
                  Academic engagement scores are live from student records and community activity. Attendance bars will populate automatically once dual-camera attendance or HOD OD/Leave logs are recorded for each batch.
                </span>
                <button
                  type="button"
                  onClick={onOpenAttendance}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Record Attendance
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compact Tabular Batch Breakdown (Hairline Divider, Single Elevation) */}
      {!loading && !errorMsg && hasBatches && (
        <div className="border-t border-slate-200 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-6">Student Batch</th>
                <th className="py-2.5 px-4 text-right">Students</th>
                <th className="py-2.5 px-4 text-right">Avg CGPA</th>
                <th className="py-2.5 px-4 text-right">Avg Attendance</th>
                <th className="py-2.5 px-4 text-right">Engagement Score</th>
                <th className="py-2.5 px-6 text-right">Standing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data!.batches.map((b) => (
                <tr key={b.batchKey} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-2.5 px-6 font-medium text-slate-900 whitespace-nowrap">
                    {b.batchLabel}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {b.studentCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {b.averageCgpa !== null ? b.averageCgpa.toFixed(2) : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-indigo-700">
                    {b.hasAttendanceData ? `${b.averageAttendanceRate.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                    {b.academicEngagementScore.toFixed(1)}
                  </td>
                  <td className={`py-2.5 px-6 text-right whitespace-nowrap ${getStandingTextClass(b.standing)}`}>
                    {b.standing}
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
