import { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Monitor,
  Package,
  Share,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'default' | 'inverted' | 'sidebar';
  compact?: boolean;
}

export function PWAInstallButton({
  variant = 'default',
  compact = false,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, platform, osLabel, isInIframe, swActive, install } =
    usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [activeTab, setActiveTab] = useState<'android' | 'ios' | 'desktop' | 'apk'>(platform);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCapCmd, setCopiedCapCmd] = useState(false);

  // Suppress button when already running as an installed standalone app
  if (isInstalled) {
    return null;
  }

  const appUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/` : '';

  const capBuildCommand =
    'npm run build && npx @capacitor/cli add android && npx @capacitor/cli add ios && npx @capacitor/cli sync';

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setActiveTab(platform);
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    if (!appUrl) return;
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2200);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handleCopyCapCmd = async () => {
    try {
      await navigator.clipboard.writeText(capBuildCommand);
      setCopiedCapCmd(true);
      window.setTimeout(() => setCopiedCapCmd(false), 2200);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handleShareUrl = async () => {
    if (!appUrl || typeof navigator === 'undefined' || !navigator.share) return;
    try {
      await navigator.share({
        title: 'ChromaGrade — Academic Department App',
        text: 'Install ChromaGrade on Android, iOS, or Desktop',
        url: appUrl,
      });
    } catch {
      // User dismissed share sheet
    }
  };

  const buttonClasses =
    variant === 'inverted'
      ? 'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-colors whitespace-nowrap shrink-0'
      : variant === 'sidebar'
      ? 'w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-medium text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors whitespace-nowrap shrink-0'
      : 'inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0';

  const label = compact
    ? 'Install App'
    : isInstallable
    ? 'Install App'
    : platform === 'ios'
    ? 'Install on iOS'
    : platform === 'android'
    ? 'Install Android App'
    : 'Install Mobile & Desktop App';

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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
          <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl overflow-hidden pb-safe max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/pwa-192x192.png"
                  alt="ChromaGrade app icon"
                  className="w-10 h-10 rounded-lg border border-slate-200 shrink-0"
                />
                <div className="min-w-0">
                  <h3
                    id="pwa-install-guide-title"
                    className="text-sm font-semibold text-slate-900 truncate"
                  >
                    Install ChromaGrade App
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    Detected: {osLabel} · Android WebAPK / APK, iOS & Desktop
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              {isInstallable && (
                <button
                  type="button"
                  onClick={async () => {
                    const accepted = await install();
                    if (accepted) setShowGuide(false);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Install Now (One-Tap App)
                </button>
              )}

              {isInIframe && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 leading-relaxed">
                  Browsers require opening the app link directly in its own tab (outside an embedded preview) to display the native install prompt. Copy or share the link below to install directly on Android, iPhone, or Desktop.
                </div>
              )}

              {/* Platform Switcher */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'android', label: 'Android', icon: Smartphone },
                    { id: 'ios', label: 'iPhone / iPad', icon: Share },
                    { id: 'desktop', label: 'Desktop', icon: Monitor },
                    { id: 'apk', label: 'APK / Native', icon: Package },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                      className={`inline-flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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
                    Open this app URL directly in <strong>Chrome</strong> or <strong>Edge</strong> on your Android phone or tablet.
                  </li>
                  <li>
                    Tap the browser menu (<strong>⋮</strong>) and choose <strong>Install app</strong> — Android automatically compiles and installs a native <strong>WebAPK</strong> into your App Drawer & Settings.
                  </li>
                  <li>
                    Includes full-screen standalone launch, long-press app shortcuts (Chat, Attendance, Timetable, Engagement), offline shell, and Android Share Target for sharing Reels and links directly into chats.
                  </li>
                </ol>
              )}

              {activeTab === 'ios' && (
                <ol className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                  <li>
                    Open this app URL directly in <strong>Safari</strong> on iPhone or iPad.
                  </li>
                  <li>
                    Tap the <strong>Share</strong> icon in the bottom Safari toolbar.
                  </li>
                  <li>
                    Scroll down, tap <strong>Add to Home Screen</strong>, and tap <strong>Add</strong>. Launches full-screen with iOS safe-area notch support, home icon badges, and offline caching.
                  </li>
                </ol>
              )}

              {activeTab === 'desktop' && (
                <ol className="space-y-2.5 text-xs text-slate-700 leading-relaxed list-decimal list-inside">
                  <li>
                    Open this app URL in <strong>Chrome</strong>, <strong>Edge</strong> (Windows / macOS / ChromeOS / Linux), or <strong>Safari</strong> (macOS Sonoma+).
                  </li>
                  <li>
                    Click the <strong>Install</strong> icon on the right side of the address bar — or in macOS Safari choose <strong>File → Add to Dock</strong>.
                  </li>
                  <li>
                    Launches as a standalone desktop app from your Start Menu, Desktop, or Dock with taskbar jump-list shortcuts and keyboard navigation (<strong>Alt+1–4</strong>).
                  </li>
                </ol>
              )}

              {activeTab === 'apk' && (
                <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
                  <p>
                    This project includes a complete <strong>Web App Manifest</strong>, <strong>Android Digital Asset Links</strong> (<code className="font-mono text-[11px]">/.well-known/assetlinks.json</code>), <strong>Capacitor</strong> (<code className="font-mono text-[11px]">capacitor.config.json</code>), and <strong>Electron Desktop</strong> (<code className="font-mono text-[11px]">electron-builder.json</code>) for building store-ready binaries:
                  </p>
                  <ol className="space-y-2 list-decimal list-inside">
                    <li>
                      <strong>Fastest Android APK (Trusted Web Activity):</strong> Copy the app link below, paste it into <strong>pwabuilder.com</strong>, and package a signed Android <strong>.apk</strong> / Google Play <strong>.aab</strong> or Windows Store MSIX in one click.
                    </li>
                    <li>
                      <strong>Capacitor Native Android APK &amp; iOS IPA:</strong> Export this project locally (or in Antigravity IDE) and run:
                    </li>
                  </ol>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 px-3 py-2 text-[11px] font-mono bg-slate-900 text-slate-100 rounded-lg overflow-x-auto whitespace-nowrap">
                      {capBuildCommand}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyCapCmd}
                      className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[36px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                    >
                      {copiedCapCmd ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <div className="font-medium text-slate-800">
                      Desktop Native Installers (Windows .exe, macOS .dmg, Linux .AppImage / .deb):
                    </div>
                    <code className="block px-3 py-2 text-[11px] font-mono bg-slate-900 text-slate-100 rounded-lg overflow-x-auto whitespace-nowrap">
                      npm run build &amp;&amp; npx electron-builder --win --mac --linux
                    </code>
                  </div>
                </div>
              )}

              {/* Direct App Link Copy & Native Share */}
              <div className="pt-3 border-t border-slate-200 space-y-2">
                <div className="text-[11px] font-medium text-slate-600">
                  Direct App Link (open on Android, iPhone, Desktop, or PWABuilder)
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={appUrl}
                    aria-label="ChromaGrade app URL"
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg truncate"
                  />
                  <button
                    type="button"
                    onClick={handleCopyUrl}
                    className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                  {canNativeShare && (
                    <button
                      type="button"
                      onClick={handleShareUrl}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg whitespace-nowrap shrink-0"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      Share
                    </button>
                  )}
                </div>
              </div>

              {/* Real Capability Readiness Strip */}
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {swActive ? 'Offline Service Worker Ready' : 'Manifest Ready'}
                </span>
                <span aria-hidden="true">·</span>
                <span>Android WebAPK / TWA Ready</span>
                <span aria-hidden="true">·</span>
                <span>iOS & Desktop Standalone</span>
              </div>

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
