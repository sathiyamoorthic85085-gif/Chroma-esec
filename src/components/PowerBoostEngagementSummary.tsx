import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageSquare,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  ROLE_LABELS,
  type PowerBoostEngagementSummary as PowerBoostEngagementSummaryData,
  type PowerBoostMessageStatItem,
  type UserRole,
} from '../types';

interface PowerBoostEngagementSummaryProps {
  token: string;
  activeGroupId: number | null;
  activeGroupName?: string;
  refreshTrigger: number;
  onJumpToGroup: (groupId: number) => void;
  onSummaryLoaded?: (summary: PowerBoostEngagementSummaryData) => void;
}

type ScopeFilter = 'all' | 'current_group';
type TypeFilter = 'all' | 'forms' | 'active';

function getSafeExternalUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function truncateLabel(text: string, maxLen = 22): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

export function PowerBoostEngagementSummary({
  token,
  activeGroupId,
  activeGroupName,
  refreshTrigger,
  onJumpToGroup,
  onSummaryLoaded,
}: PowerBoostEngagementSummaryProps) {
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [summary, setSummary] = useState<PowerBoostEngagementSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedMsgId, setExpandedMsgId] = useState<number | null>(null);

  const loadStats = useCallback(async () => {
    setLoading((prev) => (summary === null ? true : prev));
    setErrorMsg(null);
    try {
      const targetGroupId =
        scope === 'current_group' && activeGroupId ? activeGroupId : undefined;
      const data = await api.getPowerBoostStats(token, targetGroupId);
      setSummary(data);
      if (scope === 'all') {
        onSummaryLoaded?.(data);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load Power Boost engagement summary.'
      );
    } finally {
      setLoading(false);
    }
  }, [token, scope, activeGroupId, onSummaryLoaded]);

  useEffect(() => {
    loadStats();
  }, [loadStats, refreshTrigger]);

  const filteredMessages = useMemo(() => {
    if (!summary) return [];
    const q = searchQuery.trim().toLowerCase();
    return summary.messages.filter((m) => {
      if (typeFilter === 'forms' && !m.isFormRequest) return false;
      if (typeFilter === 'active' && m.status !== 'active') return false;
      if (!q) return true;
      return (
        m.content.toLowerCase().includes(q) ||
        m.groupName.toLowerCase().includes(q) ||
        m.communityName.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q)
      );
    });
  }, [summary, typeFilter, searchQuery]);

  // Chart 1: Per-message student acknowledgement vs pending stacked bar data (latest 8 filtered)
  const barChartData = useMemo(() => {
    return filteredMessages
      .slice(0, 8)
      .reverse()
      .map((m) => ({
        id: m.messageId,
        shortLabel: truncateLabel(m.content, 18),
        fullContent: m.content,
        groupName: m.groupName,
        senderName: m.senderName,
        isFormRequest: m.isFormRequest,
        responded: m.studentAcknowledgements,
        pending: m.pendingStudents,
        rate: m.studentCompletionRate,
      }));
  }, [filteredMessages]);

  // Chart 2: Overall student response composition donut
  const donutData = useMemo(() => {
    if (!summary) return [];
    const items = [
      {
        name: 'Forms Completed',
        value: summary.formStudentCompletions,
        color: '#4338CA',
      },
      {
        name: 'Notices Acknowledged',
        value: summary.noticeStudentAcknowledgements,
        color: '#059669',
      },
      {
        name: 'Pending Student Responses',
        value: summary.totalPendingStudentResponses,
        color: '#CBD5E1',
      },
    ];
    return items.filter((item) => item.value > 0);
  }, [summary]);

  if (loading && !summary) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-72 rounded-lg bg-slate-100 animate-pulse" />
          <div className="lg:col-span-5 h-72 rounded-lg bg-slate-100 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar Header */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-slate-500">
            Power Boost Engagement Analytics · Student Form & Notice Compliance
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            Student Acknowledgements & Requested Form Completions
          </h2>
          <p className="text-xs text-slate-600">
            Tracks how many department students have acknowledged Power Boost notices or filled out linked Google Forms across community channels.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                scope === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Communities
            </button>
            {activeGroupId && (
              <button
                type="button"
                onClick={() => setScope('current_group')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap max-w-[180px] truncate ${
                  scope === 'current_group'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {activeGroupName || 'Selected Group'}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={loadStats}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </section>

      {errorMsg && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
          {errorMsg}
        </div>
      )}

      {summary && summary.totalBoostedMessages === 0 ? (
        <section className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <Zap className="w-8 h-8 text-amber-500 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-900">
            No Power Boost messages recorded yet
          </h3>
          <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
            When an HOD, Class Advisor, or Class Representative sends a Power Boost message or attaches a Google Form in any community channel, student acknowledgement and form completion charts will appear here in real time.
          </p>
          {activeGroupId && (
            <button
              type="button"
              onClick={() => onJumpToGroup(activeGroupId)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Open Community Chat
            </button>
          )}
        </section>
      ) : summary ? (
        <>
          {/* Full-Width 4-Column KPI Row */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                Power Boost Campaigns
              </div>
              <div className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                {summary.totalBoostedMessages}
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {summary.activeBoostedMessages} active · {summary.formRequestMessages} form
                {summary.formRequestMessages === 1 ? '' : 's'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                Student Acknowledgements
              </div>
              <div className="text-2xl font-semibold text-emerald-700 font-mono tabular-nums">
                {summary.totalStudentAcknowledgements}
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                {summary.uniqueStudentsEngaged} unique student
                {summary.uniqueStudentsEngaged === 1 ? '' : 's'} responded
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                Requested Forms Completed
              </div>
              <div className="text-2xl font-semibold text-indigo-700 font-mono tabular-nums">
                {summary.formStudentCompletions}
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                Across {summary.formRequestMessages} form request
                {summary.formRequestMessages === 1 ? '' : 's'}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-1.5">
              <div className="text-xs font-medium text-slate-500">
                Avg. Student Completion Rate
              </div>
              <div className="text-2xl font-semibold text-slate-900 font-mono tabular-nums">
                {summary.averageStudentCompletionRate}%
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums">
                Target roster: {summary.totalTargetStudents} student
                {summary.totalTargetStudents === 1 ? '' : 's'}
              </div>
            </div>
          </section>

          {/* 2-Column Visual Charts Row */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Stacked Bar Chart: Per-Message Student Responses vs Pending */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
              <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Student Engagement by Power Boost Message
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Students acknowledged / form submitted vs. pending responses per message
                  </p>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" />
                    Students Responded
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-200" />
                    Pending
                  </span>
                </div>
              </div>

              <div className="pt-4 flex-1 min-h-[260px]">
                {barChartData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-500">
                    No messages match the current filter.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={barChartData}
                      margin={{ top: 8, right: 12, left: -12, bottom: 24 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="shortLabel"
                        tick={{ fontSize: 11, fill: '#475569' }}
                        axisLine={{ stroke: '#CBD5E1' }}
                        tickLine={false}
                        interval={0}
                        angle={-15}
                        textAnchor="end"
                        height={48}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#F8FAFC' }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const d = payload[0].payload as (typeof barChartData)[number];
                          return (
                            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 text-xs space-y-1 max-w-xs">
                              <div className="font-semibold text-slate-900 line-clamp-2">
                                {d.fullContent}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {d.groupName} · {d.isFormRequest ? 'Form Request' : 'Notice'} ·{' '}
                                {d.senderName}
                              </div>
                              <div className="pt-1 border-t border-slate-100 font-mono tabular-nums space-y-0.5">
                                <div className="text-emerald-700">
                                  Responded: {d.responded} student{d.responded === 1 ? '' : 's'}
                                </div>
                                <div className="text-slate-600">
                                  Pending: {d.pending} student{d.pending === 1 ? '' : 's'}
                                </div>
                                <div className="text-slate-900 font-semibold">
                                  Completion Rate: {d.rate}%
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="responded"
                        stackId="students"
                        fill="#059669"
                        radius={[0, 0, 0, 0]}
                        maxBarSize={42}
                      />
                      <Bar
                        dataKey="pending"
                        stackId="students"
                        fill="#E2E8F0"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={42}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Donut Chart: Forms vs Notices vs Pending Composition */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
              <div className="pb-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  Response Breakdown
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Forms filled out, notices acknowledged, and awaiting response
                </p>
              </div>

              <div className="pt-4 flex-1 flex flex-col justify-between gap-4">
                <div className="h-[180px]">
                  {donutData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-xs text-slate-500">
                      Awaiting student responses
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={76}
                          paddingAngle={2}
                        >
                          {donutData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: unknown, name: unknown) => [
                            `${value} student response(s)`,
                            String(name),
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Explicit Text & Numeric Breakdown List */}
                <div className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-sm bg-indigo-700 shrink-0" />
                      Forms Filled Out (Students)
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {summary.formStudentCompletions}
                    </span>
                  </div>
                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 shrink-0" />
                      Notices Acknowledged (Students)
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {summary.noticeStudentAcknowledgements}
                    </span>
                  </div>
                  <div className="py-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-slate-700">
                      <span className="w-2.5 h-2.5 rounded-sm bg-slate-300 shrink-0" />
                      Pending Student Responses
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-700">
                      {summary.totalPendingStudentResponses}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Detailed Per-Message Engagement Ledger */}
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Power Boost Message Engagement Ledger
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Expand any message to inspect individual student acknowledgements and form submission notes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by message, group, sender..."
                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white w-56 focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
                  />
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All Boosts' },
                      { id: 'forms', label: 'Form Requests' },
                      { id: 'active', label: 'Active Only' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTypeFilter(tab.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        typeFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-200">
              {filteredMessages.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No Power Boost messages match the selected filter.
                </div>
              ) : (
                filteredMessages.map((msg: PowerBoostMessageStatItem) => {
                  const isExpanded = expandedMsgId === msg.messageId;
                  const safeUrl = getSafeExternalUrl(msg.powerBoostActionUrl);
                  const targetDenominator = Math.max(
                    summary.totalTargetStudents,
                    msg.studentAcknowledgements
                  );

                  return (
                    <div key={msg.messageId} className="bg-white">
                      <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                            <span
                              className={`font-semibold ${
                                msg.isFormRequest ? 'text-indigo-700' : 'text-slate-700'
                              }`}
                            >
                              {msg.isFormRequest ? 'Form Request' : 'Notice'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                msg.status === 'active'
                                  ? 'text-emerald-700 font-medium'
                                  : msg.status === 'expired'
                                  ? 'text-amber-700 font-medium'
                                  : 'text-slate-500'
                              }
                            >
                              {msg.status === 'active'
                                ? `Active (every ${msg.powerBoostIntervalMinutes}m)`
                                : msg.status === 'expired'
                                ? 'Expired'
                                : 'Completed / Stopped'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {msg.groupName} ({msg.communityName})
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{msg.senderName}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {msg.createdAt.slice(0, 16).replace('T', ' ')}
                            </span>
                          </div>

                          <p className="text-sm text-slate-900 leading-snug break-words">
                            {msg.content}
                          </p>

                          {safeUrl && (
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline break-all"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" />
                              {safeUrl}
                            </a>
                          )}
                        </div>

                        {/* Student Completion Progress Bar & Actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4 shrink-0">
                          <div className="w-full sm:w-52 space-y-1.5">
                            <div className="flex items-baseline justify-between text-xs font-mono tabular-nums">
                              <span className="text-slate-700 font-medium">
                                {msg.studentAcknowledgements} / {targetDenominator} students
                              </span>
                              <span className="font-semibold text-slate-900">
                                {msg.studentCompletionRate}%
                              </span>
                            </div>
                            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  msg.isFormRequest ? 'bg-indigo-600' : 'bg-emerald-600'
                                }`}
                                style={{ width: `${msg.studentCompletionRate}%` }}
                              />
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                              {msg.pendingStudents} pending
                              {msg.staffAcknowledgements > 0
                                ? ` · ${msg.staffAcknowledgements} staff ack`
                                : ''}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedMsgId((prev) =>
                                  prev === msg.messageId ? null : msg.messageId
                                )
                              }
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                            >
                              Responders ({msg.totalAcknowledgements})
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => onJumpToGroup(msg.groupId)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Chat
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Individual Responders List */}
                      {isExpanded && (
                        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200">
                          {msg.acknowledgements.length === 0 ? (
                            <div className="text-xs text-slate-500">
                              No students or faculty have acknowledged this Power Boost message yet.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="border-b border-slate-200 text-slate-500 font-medium">
                                    <th className="py-2 pr-4">Responder</th>
                                    <th className="py-2 pr-4">Role</th>
                                    <th className="py-2 pr-4">Response / Form Note</th>
                                    <th className="py-2 text-right">Time</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70">
                                  {msg.acknowledgements.map((ack) => (
                                    <tr key={ack.id}>
                                      <td className="py-2 pr-4 font-medium text-slate-900">
                                        {ack.userName}
                                      </td>
                                      <td className="py-2 pr-4 text-slate-600">
                                        {ROLE_LABELS[ack.userRole as UserRole] ?? ack.userRole}
                                      </td>
                                      <td className="py-2 pr-4 text-slate-700">
                                        {ack.responseNote || 'Acknowledged'}
                                      </td>
                                      <td className="py-2 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                                        {ack.acknowledgedAt.slice(0, 16).replace('T', ' ')}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
