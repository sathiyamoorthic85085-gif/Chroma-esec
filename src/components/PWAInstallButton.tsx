import { useState } from 'react';
import { Download, Monitor, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'default' | 'inverted' | 'sidebar';
  compact?: boolean;
}

export function PWAInstallButton({
  variant = 'default',
  compact = false,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, platform, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<'android' | 'ios' | 'desktop'>(platform);

  // Suppress button when already running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setActiveTab(platform);
    setShowGuide(true);
  };

  const buttonClasses =
    variant === 'inverted'
      ? 'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-colors whitespace-nowrap shrink-0'
      : variant === 'sidebar'
      ? 'w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-medium text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap shrink-0'
      : 'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0';

  const label = compact
    ? 'Install'
    : isInstallable
    ? 'Install App'
    : platform === 'ios'
    ? 'Install on iOS'
    : platform === 'android'
    ? 'Install on Android'
    : 'Install App';

  return (
    <>
      <button type="button" onClick={handleClick} className={buttonClasses}>
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/55 p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl overflow-hidden pb-safe">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="pwa-install-guide-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  Install ChromaGrade App
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Run full-screen with home screen icon on Android, iOS, or Desktop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'android', label: 'Android', icon: Smartphone },
                    { id: 'ios', label: 'iPhone / iPad', icon: Share },
                    { id: 'desktop', label: 'Desktop', icon: Monitor },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        activeTab === item.id
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>

              {activeTab === 'android' && (
                <ol className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                  <li>
                    Open this app URL in <strong>Chrome</strong> or <strong>Edge</strong> on Android.
                  </li>
                  <li>
                    Tap the browser menu (<strong>⋮</strong>) in the top-right corner.
                  </li>
                  <li>
                    Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.
                  </li>
                </ol>
              )}

              {activeTab === 'ios' && (
                <ol className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                  <li>
                    Open this app URL in <strong>Safari</strong> on iPhone or iPad.
                  </li>
                  <li>
                    Tap the <strong>Share</strong> icon in the Safari toolbar.
                  </li>
                  <li>
                    Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
                  </li>
                </ol>
              )}

              {activeTab === 'desktop' && (
                <ol className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                  <li>
                    Open this app URL directly in <strong>Chrome</strong>, <strong>Edge</strong>, or <strong>Safari</strong> (macOS Sonoma+).
                  </li>
                  <li>
                    Click the <strong>Install</strong> icon on the right side of the address bar (or in Safari choose <strong>File → Add to Dock</strong>).
                  </li>
                  <li>
                    Launch ChromaGrade anytime from your Desktop, Dock, or Start Menu in a standalone window.
                  </li>
                </ol>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full py-2.5 min-h-[44px] text-xs font-medium text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
