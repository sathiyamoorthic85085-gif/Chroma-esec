import { useState } from 'react';
import { Check, Mail, X } from 'lucide-react';
import { api } from '../lib/api';
import { ROLE_LABELS, type EmailIntimation, type UserProfile } from '../types';

interface ApprovalsViewProps {
  token: string;
  registrations: UserProfile[];
  intimations: EmailIntimation[];
  onRefresh: () => Promise<void>;
}

export function ApprovalsView({
  token,
  registrations,
  intimations,
  onRefresh,
}: ApprovalsViewProps) {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected' | 'intimations'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [latestSent, setLatestSent] = useState<EmailIntimation | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pendingList = registrations.filter((r) => r.status === 'pending');
  const approvedList = registrations.filter((r) => r.status === 'approved');
  const rejectedList = registrations.filter((r) => r.status === 'rejected');

  const handleApprove = async (id: number) => {
    setBusyId(id);
    setErrorMsg(null);
    try {
      const res = await api.approveRegistration(token, id);
      setLatestSent(res.intimation);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: number) => {
    setBusyId(id);
    setErrorMsg(null);
    try {
      await api.rejectRegistration(token, id);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Decline action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const activeRows =
    tab === 'pending' ? pendingList : tab === 'approved' ? approvedList : rejectedList;

  return (
    <div className="space-y-6">
      {/* Interactive filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'pending'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Pending Approval ({pendingList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('approved')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'approved'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Approved ({approvedList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('rejected')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'rejected'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Declined ({rejectedList.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('intimations')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'intimations'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Email Intimations ({intimations.length})
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {/* Newly dispatched email intimation confirmation */}
      {latestSent && (
        <div className="bg-white border border-emerald-200 rounded-lg p-5 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <Mail className="w-4 h-4 text-emerald-700" />
              <span>
                Approval Email Intimation Dispatched to {latestSent.recipientName} ({latestSent.recipientEmail})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLatestSent(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-slate-600">
            {latestSent.deliveryDetail}
          </p>
          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-200 rounded-md p-3.5 leading-relaxed">
            {latestSent.body}
          </pre>
        </div>
      )}

      {/* Registrations Table */}
      {tab !== 'intimations' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Applicant</th>
                  <th className="py-3 px-4">Requested Role</th>
                  <th className="py-3 px-4">ID / Roll No</th>
                  <th className="py-3 px-4">Department & Class</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">HOD Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {activeRows.map((reg) => (
                  <tr key={reg.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-slate-900">{reg.fullName}</div>
                      <div className="text-xs text-slate-500">{reg.email}</div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-800">
                      {ROLE_LABELS[reg.role]}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs tabular-nums text-slate-700">
                      {reg.staffOrRollId || '—'}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-700">
                      <div>{reg.department}</div>
                      {reg.yearOfStudy && (
                        <div className="text-slate-500">
                          {reg.yearOfStudy} {reg.section ? `· Section ${reg.section}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium">
                      {reg.status === 'pending' && (
                        <span className="text-amber-700">Awaiting Approval</span>
                      )}
                      {reg.status === 'approved' && (
                        <span className="text-emerald-700">
                          Approved · Email Sent
                        </span>
                      )}
                      {reg.status === 'rejected' && (
                        <span className="text-red-700">Declined</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {reg.status === 'pending' ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === reg.id}
                            onClick={() => handleApprove(reg.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {busyId === reg.id ? 'Approving...' : 'Approve & Email'}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === reg.id}
                            onClick={() => handleReject(reg.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-md whitespace-nowrap shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 font-mono tabular-nums">
                          {reg.approvedAt ?? '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {activeRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-xs text-slate-500">
                      No registration records in this category.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Email Intimation Ledger */
        <div className="space-y-4">
          {intimations.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
              No approval email intimations dispatched yet. Approve a pending registration to dispatch an intimation email.
            </div>
          ) : (
            intimations.map((em) => (
              <article
                key={em.id}
                className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">{em.subject}</h4>
                    <div className="text-xs text-slate-500 mt-0.5">
                      To: {em.recipientName} ({em.recipientEmail}) · {ROLE_LABELS[em.role]} · Approved by {em.triggeredByName}
                    </div>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-500">
                    {em.createdAt}
                  </div>
                </div>
                <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                  {em.body}
                </pre>
                <div className="text-xs text-emerald-700 font-medium">
                  {em.deliveryDetail}
                </div>
              </article>
            ))
          )}
        </div>
      )}
    </div>
  );
}
