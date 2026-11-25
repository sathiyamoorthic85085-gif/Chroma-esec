import { useState } from 'react';
import {
  BellRing,
  Building2,
  CheckCircle2,
  IdCard,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  PhoneCall,
  Shield,
  X,
} from 'lucide-react';
import { api } from '../lib/api';

export interface RecordShowcasePerson {
  userId?: number | null;
  fullName: string;
  roleLabel: string;
  roleKey?: string;
  identifier: string;
  email?: string;
  phone?: string;
  department?: string;
  yearSectionOrSpec?: string;
  designationOrSubLabel?: string;
  photoData?: string;
  faceRegisteredLocked?: boolean;
  bio?: string;
}

interface RecordProfileModalProps {
  open: boolean;
  onClose: () => void;
  token: string;
  person: RecordShowcasePerson | null;
}

export function RecordProfileModal({
  open,
  onClose,
  token,
  person,
}: RecordProfileModalProps) {
  const [pageNote, setPageNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open || !person) return null;

  const initials = person.fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  const handleWakeUpPageCall = async () => {
    setSending(true);
    setError(null);
    setSentMessage(null);
    try {
      await api.triggerWakeUpPageCall(token, {
        targetUserId: person.userId ?? null,
        targetName: person.fullName,
        targetPhone: person.phone || '',
        targetRole: person.roleLabel,
        targetEmail: person.email || '',
        message: pageNote.trim() || undefined,
      });
      setSentMessage(`Wake-Up Page-Call sent live to ${person.fullName}.`);
      setPageNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send Wake-Up Page-Call.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Profile view for ${person.fullName}`}
    >
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header banner */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-300" />
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              Directory Profile & Wake-Up Page-Call
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close profile dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Identity row */}
          <div className="flex items-center gap-4">
            {person.photoData ? (
              <img
                src={person.photoData}
                alt={person.fullName}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-indigo-100 shadow-sm shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-indigo-100 text-indigo-800 font-bold text-xl flex items-center justify-center border border-indigo-200 shrink-0">
                {initials || 'AE'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900 truncate">{person.fullName}</h3>
                {person.faceRegisteredLocked && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold">
                    <Lock className="w-3 h-3" />
                    Face Verified
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-indigo-700 mt-0.5">{person.roleLabel}</p>
              {person.designationOrSubLabel && (
                <p className="text-xs text-slate-600 mt-0.5">{person.designationOrSubLabel}</p>
              )}
            </div>
          </div>

          {/* Read-only verified metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <IdCard className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-mono font-semibold truncate">
                {person.identifier || 'ID Not Set'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-700">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{person.department || 'Academic Department'}</span>
            </div>
            {person.email && (
              <div className="flex items-center gap-2 text-slate-700 sm:col-span-2">
                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{person.email}</span>
              </div>
            )}
            {person.phone && (
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-mono">{person.phone}</span>
              </div>
            )}
            {person.yearSectionOrSpec && (
              <div className="text-slate-600 truncate">
                <span className="font-medium text-slate-800">{person.yearSectionOrSpec}</span>
              </div>
            )}
          </div>

          {person.bio && (
            <p className="text-xs text-slate-600 bg-indigo-50/50 border border-indigo-100 rounded-lg px-3 py-2">
              {person.bio}
            </p>
          )}

          {/* Direct Mobile Wake-Up Call & Page-Call */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-rose-600" />
                Wake-Up Page-Call & Direct Contact
              </span>
              {person.phone ? (
                <div className="flex items-center gap-2">
                  <a
                    href={`tel:${person.phone.replace(/\s+/g, '')}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Call Mobile
                  </a>
                  <a
                    href={`sms:${person.phone.replace(/\s+/g, '')}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    SMS
                  </a>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400">No mobile number listed</span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={pageNote}
                onChange={(e) => setPageNote(e.target.value)}
                placeholder={`Optional urgent wake-up note for ${person.fullName}...`}
                className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
              <button
                type="button"
                onClick={handleWakeUpPageCall}
                disabled={sending}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-60 shrink-0"
              >
                <BellRing className="w-3.5 h-3.5" />
                {sending ? 'Paging...' : 'Wake-Up Page-Call'}
              </button>
            </div>

            {sentMessage && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{sentMessage}</span>
              </div>
            )}
            {error && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <p className="text-[11px] text-slate-400">
              Directory records are read-only here for Profile & Wake-Up Page-Call coordination (not record maintenance).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
