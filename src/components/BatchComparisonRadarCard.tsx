import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
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

  const riskA = data?.predictiveRisk.batchA;
  const riskB = data?.predictiveRisk.batchB;
  const anyRiskDetected = Boolean(riskA?.atPredictiveRisk || riskB?.atPredictiveRisk);

  const radarData = (data?.radarMetrics ?? []).map((item) => ({
    ...item,
    riskThreshold: 75,
  }));

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
            <GitCompareArrows className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Batch Comparison &amp; Predictive Risk Radar
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare attendance, engagement, and digital badge metrics side by side with 2-week OLS linear regression forecast
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

      {/* Batch Selectors + Summary Bar */}
      {data && (
        <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="compare-batch-a" className="text-xs font-medium text-indigo-800 whitespace-nowrap">
              Batch A
            </label>
            <select
              id="compare-batch-a"
              value={batchA || data.batchA.batchKey}
              onChange={(e) => setBatchA(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
            >
              {data.availableBatches.map((b) => (
                <option key={`a-${b.batchKey}`} value={b.batchKey}>
                  {b.batchLabel}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
              {data.batchA.averageAttendanceRate.toFixed(1)}% Att · {data.batchA.badgesCount} Badges
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label htmlFor="compare-batch-b" className="text-xs font-medium text-emerald-800 whitespace-nowrap">
              Batch B
            </label>
            <select
              id="compare-batch-b"
              value={batchB || data.batchB.batchKey}
              onChange={(e) => setBatchB(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:border-indigo-700"
            >
              {data.availableBatches.map((b) => (
                <option key={`b-${b.batchKey}`} value={b.batchKey}>
                  {b.batchLabel}
                </option>
              ))}
            </select>
            <span className="font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
              {data.batchB.averageAttendanceRate.toFixed(1)}% Att · {data.batchB.badgesCount} Badges
            </span>
          </div>
        </div>
      )}

      {error && <div className="px-6 py-3 text-xs text-rose-700">{error}</div>}

      {loading && !data ? (
        <div className="px-6 py-12 text-center text-xs text-slate-500">
          Computing batch radar metrics and 4-week regression slopes...
        </div>
      ) : data ? (
        <div className="p-6 space-y-6">
          {/* Predictive Risk Overlay Summary */}
          {showPredictiveRisk && (
            <div
              className={`border rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-4 ${
                anyRiskDetected
                  ? 'border-rose-200 bg-rose-50/60'
                  : 'border-emerald-200 bg-emerald-50/50'
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
                          {risk.atPredictiveRisk ? 'PREDICTIVE RISK FLAG' : 'STABLE TRAJECTORY'}
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

          {/* Side-by-Side Radar & Optional 2-Week Linear Regression Trends */}
          <div
            className={`grid grid-cols-1 ${
              showTrendsProjection ? 'xl:grid-cols-2' : ''
            } gap-6 items-start`}
          >
            <div className="border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                Multi-Axis Batch Radar ({data.batchA.batchLabel} vs {data.batchB.batchLabel})
              </div>
              <div className="h-[320px] w-full">
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
                        stroke="#f59e0b"
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

            {showTrendsProjection && (
              <div className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-900">
                    4-Week History + 2-Week Linear Regression Projection
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">Dashed = Forecast</span>
                </div>
                <div className="h-[320px] w-full">
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
        </div>
      ) : null}
    </section>
  );
}
