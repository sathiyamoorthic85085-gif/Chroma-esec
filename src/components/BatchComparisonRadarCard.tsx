import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Download,
  GitCompareArrows,
  TrendingUp,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { BatchComparisonPayload } from '../types';

interface BatchComparisonRadarCardProps {
  token: string;
  refreshKey?: number;
}

function formatSignedDelta(valueA: number, valueB: number, suffix = ''): string {
  const diff = Math.round((valueA - valueB) * 10) / 10;
  if (diff === 0) return `0${suffix}`;
  return `${diff > 0 ? '+' : ''}${diff}${suffix}`;
}

export function BatchComparisonRadarCard({
  token,
  refreshKey = 0,
}: BatchComparisonRadarCardProps) {
  const [batchA, setBatchA] = useState<string>('');
  const [batchB, setBatchB] = useState<string>('');
  const [data, setData] = useState<BatchComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showPredictiveRisk, setShowPredictiveRisk] = useState(true);
  const [showTrendsProjection, setShowTrendsProjection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComparison = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBatchComparison(
        token,
        batchA || undefined,
        batchB || undefined
      );
      setData(res);
      if (!batchA && res.batchA?.batchKey) setBatchA(res.batchA.batchKey);
      if (!batchB && res.batchB?.batchKey) setBatchB(res.batchB.batchKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compare batches.');
    } finally {
      setLoading(false);
    }
  }, [token, batchA, batchB]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison, refreshKey]);

  const handleBulkExport = async () => {
    setExportingPdf(true);
    setError(null);
    try {
      await api.exportBatchComparisonPdf(
        token,
        data?.batchA.batchKey || batchA || undefined,
        data?.batchB.batchKey || batchB || undefined
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export PDF report.');
    } finally {
      setExportingPdf(false);
    }
  };

  const handleSwapBatches = () => {
    const currentA = batchA || data?.batchA.batchKey || '';
    const currentB = batchB || data?.batchB.batchKey || '';
    if (!currentA || !currentB || currentA === currentB) return;
    setBatchA(currentB);
    setBatchB(currentA);
  };

  const riskA = data?.predictiveRisk.batchA;
  const riskB = data?.predictiveRisk.batchB;
  const anyRiskDetected = Boolean(riskA?.atPredictiveRisk || riskB?.atPredictiveRisk);

  const radarData = (data?.radarMetrics ?? []).map((item) => ({
    ...item,
    riskThreshold: 75,
  }));

  const badgeDensityA =
    radarData.find((m) => m.metric === 'Badge Density')?.batchAValue ?? 0;
  const badgeDensityB =
    radarData.find((m) => m.metric === 'Badge Density')?.batchBValue ?? 0;

  const comparisonRows = data
    ? [
        {
          label: 'Average Attendance',
          aDisplay: `${data.batchA.averageAttendanceRate.toFixed(1)}%`,
          bDisplay: `${data.batchB.averageAttendanceRate.toFixed(1)}%`,
          delta: formatSignedDelta(
            data.batchA.averageAttendanceRate,
            data.batchB.averageAttendanceRate,
            '%'
          ),
          positiveBetter: true,
          diff: data.batchA.averageAttendanceRate - data.batchB.averageAttendanceRate,
        },
        {
          label: 'Achievement Badges',
          aDisplay: `${data.batchA.badgesCount} badges`,
          bDisplay: `${data.batchB.badgesCount} badges`,
          delta: formatSignedDelta(data.batchA.badgesCount, data.batchB.badgesCount),
          positiveBetter: true,
          diff: data.batchA.badgesCount - data.batchB.badgesCount,
        },
        {
          label: 'Badge Density Index',
          aDisplay: `${badgeDensityA}%`,
          bDisplay: `${badgeDensityB}%`,
          delta: formatSignedDelta(badgeDensityA, badgeDensityB, '%'),
          positiveBetter: true,
          diff: badgeDensityA - badgeDensityB,
        },
        {
          label: 'Avg Streak Length',
          aDisplay: `${data.batchA.streakAvg.toFixed(1)}d`,
          bDisplay: `${data.batchB.streakAvg.toFixed(1)}d`,
          delta: formatSignedDelta(data.batchA.streakAvg, data.batchB.streakAvg, 'd'),
          positiveBetter: true,
          diff: data.batchA.streakAvg - data.batchB.streakAvg,
        },
        {
          label: 'Academic Engagement',
          aDisplay: `${data.batchA.academicEngagementScore.toFixed(1)}`,
          bDisplay: `${data.batchB.academicEngagementScore.toFixed(1)}`,
          delta: formatSignedDelta(
            data.batchA.academicEngagementScore,
            data.batchB.academicEngagementScore
          ),
          positiveBetter: true,
          diff: data.batchA.academicEngagementScore - data.batchB.academicEngagementScore,
        },
        {
          label: 'Average CGPA',
          aDisplay: data.batchA.averageCgpa !== null ? data.batchA.averageCgpa.toFixed(2) : '—',
          bDisplay: data.batchB.averageCgpa !== null ? data.batchB.averageCgpa.toFixed(2) : '—',
          delta:
            data.batchA.averageCgpa !== null && data.batchB.averageCgpa !== null
              ? formatSignedDelta(data.batchA.averageCgpa, data.batchB.averageCgpa)
              : '—',
          positiveBetter: true,
          diff:
            data.batchA.averageCgpa !== null && data.batchB.averageCgpa !== null
              ? data.batchA.averageCgpa - data.batchB.averageCgpa
              : 0,
        },
      ]
    : [];

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      {/* Card Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
            <GitCompareArrows className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Side-by-Side Batch Comparison &amp; Radar Analytics
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select two batches to compare average attendance, achievement badge metrics, predictive risk, and 2-week projections
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowPredictiveRisk((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              showPredictiveRisk
                ? 'bg-rose-50 text-rose-800 border-rose-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Predictive Risk {showPredictiveRisk ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            onClick={() => setShowTrendsProjection((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              showTrendsProjection
                ? 'bg-indigo-50 text-indigo-800 border-indigo-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Trends Projection
          </button>

          <button
            type="button"
            onClick={handleBulkExport}
            disabled={exportingPdf || !data}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {exportingPdf ? 'Exporting PDF...' : 'Bulk Export'}
          </button>
        </div>
      </div>

      {/* Dual Batch Selector Toolbar */}
      {data && (
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <label
              htmlFor="compare-batch-a"
              className="text-xs font-semibold text-indigo-800 whitespace-nowrap shrink-0"
            >
              Batch A
            </label>
            <select
              id="compare-batch-a"
              value={batchA || data.batchA.batchKey}
              onChange={(e) => setBatchA(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
            >
              {data.availableBatches.map((b) => (
                <option key={`a-${b.batchKey}`} value={b.batchKey}>
                  {b.batchLabel}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleSwapBatches}
            disabled={data.availableBatches.length < 2}
            title="Swap selected batches"
            aria-label="Swap Batch A and Batch B"
            className="self-center px-2.5 py-2 text-xs text-slate-600 hover:text-slate-900 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex-1 flex items-center gap-3 min-w-0">
            <label
              htmlFor="compare-batch-b"
              className="text-xs font-semibold text-emerald-800 whitespace-nowrap shrink-0"
            >
              Batch B
            </label>
            <select
              id="compare-batch-b"
              value={batchB || data.batchB.batchKey}
              onChange={(e) => setBatchB(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-emerald-700"
            >
              {data.availableBatches.map((b) => (
                <option key={`b-${b.batchKey}`} value={b.batchKey}>
                  {b.batchLabel}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && <div className="px-6 py-3 text-xs text-rose-700">{error}</div>}

      {loading && !data ? (
        <div className="px-6 py-12 text-center text-xs text-slate-500">
          Computing side-by-side batch radar metrics and achievement totals...
        </div>
      ) : data ? (
        <div className="p-6 space-y-6">
          {/* Predictive Risk Overlay Banner */}
          {showPredictiveRisk && (
            <div
              className={`border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4 ${
                anyRiskDetected
                  ? 'border-rose-200 bg-rose-50/50'
                  : 'border-emerald-200 bg-emerald-50/40'
              }`}
            >
              {[riskA, riskB].map(
                (risk) =>
                  risk && (
                    <div key={risk.batchKey} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">
                          {risk.batchLabel}
                        </span>
                        <span
                          className={`text-[11px] font-mono font-semibold ${
                            risk.atPredictiveRisk ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                        >
                          {risk.atPredictiveRisk ? 'Predictive Risk Flag' : 'Stable Trajectory'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{risk.reason}</p>
                      <div className="font-mono text-[11px] tabular-nums text-slate-600">
                        4-Wk Attendance Slope: {risk.attendanceSlope4Wk >= 0 ? '+' : ''}
                        {risk.attendanceSlope4Wk}%/wk · Engagement Slope:{' '}
                        {risk.engagementSlope4Wk >= 0 ? '+' : ''}
                        {risk.engagementSlope4Wk} pts/wk
                      </div>
                    </div>
                  )
              )}
            </div>
          )}

          {/* Side-by-Side Comparison Matrix + Radar Chart */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Left: Side-by-Side Batch A vs Batch B Summary & Metric Table */}
            <div className="xl:col-span-5 space-y-4">
              <div className="grid grid-cols-2 divide-x divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
                <div className="p-4 bg-indigo-50/30">
                  <div className="text-[11px] font-medium text-indigo-700">Batch A</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                    {data.batchA.batchLabel}
                  </div>
                  <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-indigo-800">
                    {data.batchA.averageAttendanceRate.toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                    {data.batchA.badgesCount} badges · {data.batchA.studentCount} students
                  </div>
                </div>

                <div className="p-4 bg-emerald-50/30">
                  <div className="text-[11px] font-medium text-emerald-700">Batch B</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
                    {data.batchB.batchLabel}
                  </div>
                  <div className="mt-2 font-mono text-xl font-semibold tabular-nums text-emerald-800">
                    {data.batchB.averageAttendanceRate.toFixed(1)}%
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 font-mono tabular-nums">
                    {data.batchB.badgesCount} badges · {data.batchB.studentCount} students
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="px-3.5 py-2.5 font-medium">Metric</th>
                      <th className="px-3 py-2.5 font-medium text-right text-indigo-800">
                        {data.batchA.batchLabel}
                      </th>
                      <th className="px-3 py-2.5 font-medium text-right text-emerald-800">
                        {data.batchB.batchLabel}
                      </th>
                      <th className="px-3.5 py-2.5 font-medium text-right">Diff (A−B)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 tabular-nums">
                    {comparisonRows.map((row) => (
                      <tr key={row.label} className="hover:bg-slate-50/70">
                        <td className="px-3.5 py-2.5 font-medium text-slate-800">
                          {row.label}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-right text-slate-900">
                          {row.aDisplay}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-right text-slate-900">
                          {row.bDisplay}
                        </td>
                        <td
                          className={`px-3.5 py-2.5 font-mono text-right font-medium ${
                            row.diff > 0
                              ? 'text-indigo-700'
                              : row.diff < 0
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {row.delta}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Multi-Axis Batch Radar Chart */}
            <div className="xl:col-span-7 border border-slate-200 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    Multi-Axis Performance &amp; Achievement Radar
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Normalized 0–100 scale comparing {data.batchA.batchLabel} vs {data.batchB.batchLabel}
                  </div>
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  Attendance · Engagement · CGPA · Portal · Badges
                </div>
              </div>

              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="74%" data={radarData}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fontSize: 11, fill: '#334155' }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                    />
                    <Radar
                      name={data.batchA.batchLabel}
                      dataKey="batchAValue"
                      stroke={riskA?.atPredictiveRisk && showPredictiveRisk ? '#be123c' : '#4338ca'}
                      fill={riskA?.atPredictiveRisk && showPredictiveRisk ? '#fb7185' : '#6366f1'}
                      fillOpacity={0.28}
                    />
                    <Radar
                      name={data.batchB.batchLabel}
                      dataKey="batchBValue"
                      stroke={riskB?.atPredictiveRisk && showPredictiveRisk ? '#e11d48' : '#047857'}
                      fill={riskB?.atPredictiveRisk && showPredictiveRisk ? '#fda4af' : '#10b981'}
                      fillOpacity={0.24}
                    />
                    {showPredictiveRisk && (
                      <Radar
                        name="75% Risk Baseline"
                        dataKey="riskThreshold"
                        stroke="#d97706"
                        strokeDasharray="4 4"
                        fill="none"
                      />
                    )}
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* 4-Week History + 2-Week Linear Regression Trends Projection */}
          {showTrendsProjection && (
            <div className="pt-6 border-t border-slate-200">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs font-semibold text-slate-900">
                  4-Week History + 2-Week Linear Regression Projection
                </span>
                <span className="font-mono text-[11px] text-slate-500">Dashed = 2-Week Forecast</span>
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={data.weeklySeries}
                    margin={{ top: 10, right: 12, left: -12, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="batchAAttendance"
                      name={`${data.batchA.batchLabel} (Actual)`}
                      stroke="#4338ca"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="batchAProjected"
                      name={`${data.batchA.batchLabel} (2-Wk Proj)`}
                      stroke="#4338ca"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="batchBAttendance"
                      name={`${data.batchB.batchLabel} (Actual)`}
                      stroke="#047857"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="batchBProjected"
                      name={`${data.batchB.batchLabel} (2-Wk Proj)`}
                      stroke="#047857"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
