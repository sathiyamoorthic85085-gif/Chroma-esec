interface ChromaGradeMarkProps {
  size?: 'sm' | 'md' | 'lg';
  inverted?: boolean;
  showWordmark?: boolean;
}

export function ChromaGradeMark({
  size = 'md',
  inverted = false,
  showWordmark = true,
}: ChromaGradeMarkProps) {
  const iconDim = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <span className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconDim} shrink-0`}
        aria-hidden="true"
      >
        <rect
          width="36"
          height="36"
          rx="9"
          fill={inverted ? '#EEF2FF' : '#1E1B4B'}
        />
        <path
          d="M9 25L18 9L27 25H22.2L18 17.2L13.8 25H9Z"
          fill={inverted ? '#3730A3' : '#818CF8'}
        />
        <path
          d="M15.1 25L18 19.6L20.9 25H15.1Z"
          fill={inverted ? '#0D9488' : '#34D399'}
        />
        <rect
          x="16.8"
          y="7"
          width="2.4"
          height="3.2"
          rx="1.2"
          fill={inverted ? '#D97706' : '#FBBF24'}
        />
      </svg>
      {showWordmark && (
        <span
          className={`font-semibold tracking-tight ${textSize} ${
            inverted ? 'text-white' : 'text-slate-900'
          }`}
          style={{ fontFamily: 'var(--font-display)' }}
        >
          ChromaGrade
        </span>
      )}
    </span>
  );
}
