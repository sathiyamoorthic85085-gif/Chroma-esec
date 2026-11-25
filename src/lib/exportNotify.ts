export interface ExportSavedEventDetail {
  fileName: string;
  formatLabel: string;
  savedAt: string;
}

export const EXPORT_SAVED_EVENT = 'chromagrade:export-saved';

export function notifyExportSaved(fileName: string, formatLabel: string): void {
  if (typeof window === 'undefined') return;
  const detail: ExportSavedEventDetail = {
    fileName,
    formatLabel,
    savedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
  window.dispatchEvent(new CustomEvent<ExportSavedEventDetail>(EXPORT_SAVED_EVENT, { detail }));
}
