import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface ChromaGradeMarkProps {
  size?: 'sm' | 'md' | 'lg';
  inverted?: boolean;
  showWordmark?: boolean;
  showSubline?: boolean;
}

export function ChromaGradeMark({
  size = 'md',
  inverted = false,
  showWordmark = true,
  showSubline = false,
}: ChromaGradeMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [imgFailed, setImgFailed] = useState(false);

  const iconDim = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-xs sm:text-sm' : size === 'lg' ? 'text-lg' : 'text-[15px]';
  const subSize = size === 'lg' ? 'text-[10px]' : 'text-[9px]';

  const goldPrimary = inverted ? '#FCD34D' : '#D99B16';
  const goldAccent = inverted ? '#F59E0B' : '#B47908';
  const navyPrimary = inverted ? '#E0E7FF' : '#1B134B';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <span
        className={`${iconDim} shrink-0 rounded-xl flex items-center justify-center overflow-hidden border shadow-xs ${
          inverted
            ? 'bg-white/10 border-amber-300/40'
            : 'bg-white border-slate-200'
        }`}
      >
        {!imgFailed ? (
          <img
            src="/icon.svg"
            alt="Academia-ESEC Logo"
            className="w-full h-full object-contain p-0.5 block"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <svg
            key={uid}
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full p-0.5 block"
            aria-label="Academia-ESEC Crest"
          >
            <circle cx="19" cy="24.5" r="2.8" fill={goldPrimary} />
            <path
              d="M9.5 29.8 C16.5 27.2 22.4 28.2 27.2 33 C29.1 35 30.8 38.4 31.6 42.2 C30 37.2 27.2 33.6 23.2 31.2 C19 28.8 14.3 29.2 9.5 29.8 Z"
              fill={goldAccent}
            />
            <path
              d="M16.8 16.2 C21.4 19.5 24.8 24.3 27.5 30.2 C28.8 32.8 30 36.6 31 41.2 C29.1 35.6 25.4 29.2 22.6 25.5 C20.4 22.4 18.6 19.2 16.8 16.2 Z"
              fill={goldPrimary}
            />
            <circle cx="30.8" cy="16.4" r="3" fill={goldPrimary} />
            <path
              d="M18.6 14 C25.2 14.4 29.2 18.2 32 24.2 C34.3 18.8 38.8 12.2 45.4 8.5 C40.8 15 36.8 22.4 34.6 32.6 C34 36 33.6 39.5 33.3 42.8 C32.4 36.2 30.8 29.5 28 23.4 C25.8 18.6 22.6 15.6 18.6 14 Z"
              fill={goldPrimary}
            />
            <circle cx="47.2" cy="21.6" r="2.8" fill={goldPrimary} />
            <path
              d="M49.4 11 C44.2 15.4 39.8 21.8 37.2 30.4 C36.2 33.6 35.6 37.4 35 41.6 C37 36.2 39.6 32 43.8 29.2 C48.8 26 54 24.8 59 24.8 C53.2 23.5 47.4 24.2 42.6 27.4 C44.5 20.8 46.8 15.4 49.4 11 Z"
              fill={goldAccent}
            />
            <path
              d="M11 51.2 C16.8 45.6 21.2 39.6 26 39.2 C28.5 39 30.4 41 31.4 43.2 C29.8 41.6 27.6 40.4 25.4 41 C21.3 42.4 17.5 46.8 14.7 49.3 C20 48.3 25.4 49.3 28.9 51.5 L31.7 43.8 L31.1 52.5 C31.7 53.5 32.3 54.1 33 54.4 C35.8 50.9 44.3 47.4 56.5 48.7 L52.1 33.8 C46.8 33.2 39 36 34.9 40.1 C39.3 37.2 46.2 35.3 50.3 36 L53.7 46.8 C44.6 45.8 36.8 48.7 32.4 52.2 L32.4 43.5 L29.5 50.2 C24.8 47.7 18.2 48 11 51.2 Z"
              fill={navyPrimary}
            />
          </svg>
        )}
      </span>
      {showWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={`font-bold tracking-wider ${textSize} ${
              inverted ? 'text-amber-300' : 'text-amber-700'
            }`}
            style={{ fontFamily: 'var(--font-display)' }}
          >
            ACADEMIA-ESEC
          </span>
          {showSubline && (
            <span
              className={`${subSize} font-semibold tracking-[0.22em] mt-0.5 ${
                inverted ? 'text-slate-300' : 'text-slate-700'
              }`}
            >
              SINCE 2026
            </span>
          )}
        </span>
      )}
    </span>
  );
}
