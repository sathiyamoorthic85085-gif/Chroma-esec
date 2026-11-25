import { useEffect, useState } from 'react';
import { CheckCircle2, FileDown, X } from 'lucide-react';
import { EXPORT_SAVED_EVENT, type ExportSavedEventDetail } from '../lib/exportNotify';

interface ToastItem extends ExportSavedEventDetail {
  id: string;
}

export function ExportConfirmationToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ExportSavedEventDetail>;
      if (!custom.detail) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry: ToastItem = { ...custom.detail, id };
      setItems((prev) => [entry, ...prev].slice(0, 3));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }, 6500);
    };
    window.addEventListener(EXPORT_SAVED_EVENT, handler);
    return () => window.removeEventListener(EXPORT_SAVED_EVENT, handler);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-96 space-y-2.5 pointer-events-none"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto bg-white border border-emerald-300 rounded-lg shadow-lg p-4 flex items-start gap-3"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <span>{item.formatLabel} Report Saved to Device</span>
            </div>
            <p className="mt-1 text-xs text-slate-600 flex items-center gap-1.5 truncate">
              <FileDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-mono text-[11px] truncate">{item.fileName}</span>
            </p>
            <div className="mt-1 text-[11px] text-slate-500 font-mono tabular-nums">
              Downloaded at {item.savedAt}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
            aria-label="Dismiss download confirmation"
            className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-md shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
