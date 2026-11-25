import { useEffect, useRef, useState } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  twinklePhase: number;
  twinkleSpeed: number;
  hue: 'gold' | 'white' | 'blue';
}

interface SmokePuff {
  angle: number;
  radiusOffset: number;
  speed: number;
  size: number;
  alpha: number;
  drift: number;
}

const TOTAL_DURATION_MS = 3550;

export function SplashScreen({ onComplete }: SplashScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<'ribbons' | 'emerge' | 'aura' | 'zoomOut'>('ribbons');
  const [exiting, setExiting] = useState(false);
  const completedRef = useRef(false);

  const finishSplash = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    setExiting(true);
    window.setTimeout(() => {
      onComplete();
    }, 460);
  };

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setPhase('aura');
      const quickTimer = window.setTimeout(finishSplash, 900);
      return () => window.clearTimeout(quickTimer);
    }

    const t1 = window.setTimeout(() => setPhase('emerge'), 850);
    const t2 = window.setTimeout(() => setPhase('aura'), 1850);
    const t3 = window.setTimeout(() => setPhase('zoomOut'), 2850);
    const t4 = window.setTimeout(finishSplash, TOTAL_DURATION_MS);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, []);

  // 60fps Volumetric Silk Ribbons + Golden Stardust + Luminous Aurora Ring Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Seed ambient golden stardust & bokeh particles
    const particles: Particle[] = Array.from({ length: 115 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.45,
      vy: -0.15 - Math.random() * 0.45,
      size: 0.9 + Math.random() * 2.5,
      alpha: 0.25 + Math.random() * 0.75,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.04 + Math.random() * 0.08,
      hue: Math.random() > 0.22 ? 'gold' : Math.random() > 0.5 ? 'white' : 'blue',
    }));

    // Seed golden plasma/smoke wisps for the 2.0s aura burst (matching frame 0:02)
    const smokeRing: SmokePuff[] = Array.from({ length: 58 }, (_, i) => ({
      angle: (i / 58) * Math.PI * 2 + (Math.random() - 0.5) * 0.14,
      radiusOffset: (Math.random() - 0.5) * 28,
      speed: 0.4 + Math.random() * 0.8,
      size: 16 + Math.random() * 34,
      alpha: 0.22 + Math.random() * 0.35,
      drift: (Math.random() - 0.5) * 0.012,
    }));

    const startMs = performance.now();

    const drawRibbon = (
      progress: number,
      fromX: number,
      fromY: number,
      ctrl1X: number,
      ctrl1Y: number,
      ctrl2X: number,
      ctrl2Y: number,
      toX: number,
      toY: number,
      colorPrimary: string,
      colorGlow: string,
      thickness: number,
      fade: number
    ) => {
      if (fade <= 0.01 || progress <= 0.01) return;
      const steps = 42;
      const maxIdx = Math.max(2, Math.floor(steps * Math.min(1, progress)));

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Multi-strand silk ribbon effect (3 layered luminous strands)
      for (let strand = -1; strand <= 1; strand++) {
        ctx.beginPath();
        for (let i = 0; i <= maxIdx; i++) {
          const t = i / steps;
          const inv = 1 - t;
          const x =
            inv * inv * inv * fromX +
            3 * inv * inv * t * ctrl1X +
            3 * inv * t * t * ctrl2X +
            t * t * t * toX;
          const y =
            inv * inv * inv * fromY +
            3 * inv * inv * t * ctrl1Y +
            3 * inv * t * t * ctrl2Y +
            t * t * t * toY;

          const wave = Math.sin(t * Math.PI * 3.5 - progress * 4) * (10 + strand * 7);
          const px = x + wave * 0.45;
          const py = y + strand * 11 * Math.sin(t * Math.PI);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }

        const strandAlpha = (strand === 0 ? 0.72 : 0.34) * fade;
        ctx.strokeStyle = strand === 0 ? colorPrimary : colorGlow;
        ctx.globalAlpha = strandAlpha;
        ctx.lineWidth = strand === 0 ? thickness : thickness * 2.1;
        ctx.shadowColor = colorGlow;
        ctx.shadowBlur = strand === 0 ? 22 : 36;
        ctx.stroke();
      }
      ctx.restore();
    };

    const render = (now: number) => {
      const elapsed = now - startMs;
      const tSec = elapsed / 1000;
      const cx = width / 2;
      const cy = height / 2 - 10;
      const minDim = Math.min(width, height);

      // Deep obsidian space gradient backdrop
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(width, height) * 0.72);
      bg.addColorStop(0, '#0E1528');
      bg.addColorStop(0.45, '#070B16');
      bg.addColorStop(1, '#03050A');
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      // 1) Volumetric Silk Ribbons (0.0s -> 2.4s, matching video frames 0:00 and 0:01)
      const ribbonGrow = Math.min(1, tSec / 1.18);
      const ribbonFade = tSec < 1.75 ? 1 : Math.max(0, 1 - (tSec - 1.75) / 0.95);
      const swirl = Math.sin(tSec * 2.1) * 45;

      // Top-left molten gold + navy silk pair
      drawRibbon(
        ribbonGrow,
        -40,
        height * 0.14,
        width * 0.18,
        height * 0.34 + swirl,
        width * 0.34,
        height * 0.42 - swirl * 0.5,
        cx,
        cy,
        '#F7D36C',
        '#C98E14',
        5.5,
        ribbonFade
      );
      drawRibbon(
        ribbonGrow * 0.96,
        -30,
        height * 0.78,
        width * 0.22,
        height * 0.58 - swirl,
        width * 0.36,
        height * 0.54 + swirl * 0.5,
        cx - 12,
        cy + 16,
        '#4C67C8',
        '#1F307A',
        5,
        ribbonFade * 0.9
      );
      // Top-right royal navy + molten gold silk pair
      drawRibbon(
        ribbonGrow,
        width + 40,
        height * 0.16,
        width * 0.82,
        height * 0.36 - swirl,
        width * 0.66,
        height * 0.42 + swirl * 0.5,
        cx,
        cy,
        '#F8D978',
        '#B8820E',
        5.5,
        ribbonFade
      );
      drawRibbon(
        ribbonGrow * 0.94,
        width + 30,
        height * 0.84,
        width * 0.78,
        height * 0.62 + swirl,
        width * 0.64,
        height * 0.52 - swirl * 0.4,
        cx + 12,
        cy + 16,
        '#5B74D4',
        '#203482',
        4.8,
        ribbonFade * 0.85
      );

      // 2) Anamorphic Horizontal Golden Optical Flare (peaks at 1.2s -> 2.7s)
      if (tSec > 0.85) {
        const flareIn = Math.min(1, (tSec - 0.85) / 0.6);
        const flareOut = tSec > 2.65 ? Math.max(0, 1 - (tSec - 2.65) / 0.7) : 1;
        const flareAlpha = flareIn * flareOut * 0.65;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const flareW = Math.min(width * 0.92, 860) * (0.65 + 0.35 * flareIn);
        const flareGrad = ctx.createLinearGradient(cx - flareW / 2, cy, cx + flareW / 2, cy);
        flareGrad.addColorStop(0, 'rgba(245, 198, 72, 0)');
        flareGrad.addColorStop(0.28, `rgba(245, 198, 72, ${flareAlpha * 0.35})`);
        flareGrad.addColorStop(0.5, `rgba(255, 241, 184, ${flareAlpha})`);
        flareGrad.addColorStop(0.72, `rgba(245, 198, 72, ${flareAlpha * 0.35})`);
        flareGrad.addColorStop(1, 'rgba(245, 198, 72, 0)');
        ctx.fillStyle = flareGrad;
        ctx.fillRect(cx - flareW / 2, cy + 16, flareW, 3.2);

        // Soft central golden core glow
        const coreGlow = ctx.createRadialGradient(cx, cy, 4, cx, cy, minDim * 0.36);
        coreGlow.addColorStop(0, `rgba(253, 224, 118, ${flareAlpha * 0.42})`);
        coreGlow.addColorStop(0.45, `rgba(202, 146, 17, ${flareAlpha * 0.16})`);
        coreGlow.addColorStop(1, 'rgba(202, 146, 17, 0)');
        ctx.fillStyle = coreGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, minDim * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 3) Luminous Golden Flame / Smoky Energy Halo Burst (1.65s -> 3.1s, matching frame 0:02)
      if (tSec > 1.55) {
        const burstT = Math.min(1.4, (tSec - 1.55) / 1.15);
        const auraFade =
          burstT < 0.25
            ? burstT / 0.25
            : Math.max(0, 1 - (burstT - 0.55) / 0.85);
        const baseRadius = Math.min(minDim * 0.26, 175) * (0.72 + burstT * 0.42);

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const puff of smokeRing) {
          const ang = puff.angle + tSec * puff.drift * 18;
          const wobble = Math.sin(ang * 5 + tSec * 3.4) * 14;
          const r = baseRadius + puff.radiusOffset + wobble;
          const px = cx + Math.cos(ang) * r;
          const py = cy + Math.sin(ang) * r * 0.94;
          const sz = puff.size * (0.85 + burstT * 0.5);

          const pGrad = ctx.createRadialGradient(px, py, 1, px, py, sz);
          pGrad.addColorStop(0, `rgba(255, 232, 148, ${puff.alpha * auraFade * 0.85})`);
          pGrad.addColorStop(0.42, `rgba(218, 160, 32, ${puff.alpha * auraFade * 0.45})`);
          pGrad.addColorStop(1, 'rgba(180, 118, 10, 0)');
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 4) Shimmering Floating Stardust Embers
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.x += p.vx + Math.sin(tSec * 1.4 + p.twinklePhase) * 0.18;
        p.y += p.vy;
        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        p.twinklePhase += p.twinkleSpeed;
        const twinkle = 0.45 + 0.55 * Math.sin(p.twinklePhase);
        const alpha = p.alpha * twinkle * (tSec > 2.9 ? Math.max(0.15, 1 - (tSec - 2.9) / 0.8) : 1);

        ctx.fillStyle =
          p.hue === 'gold'
            ? `rgba(252, 211, 77, ${alpha})`
            : p.hue === 'white'
            ? `rgba(255, 250, 230, ${alpha})`
            : `rgba(129, 156, 248, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (!completedRef.current) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const logoTransformClass =
    phase === 'ribbons'
      ? 'opacity-0 scale-75 blur-[6px]'
      : phase === 'emerge'
      ? 'opacity-100 scale-100 blur-0'
      : phase === 'aura'
      ? 'opacity-100 scale-[1.05] blur-0'
      : 'opacity-100 scale-[1.18] blur-0';

  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#04070E] transition-opacity duration-500 ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="status"
      aria-label="Academia-ESEC launching"
    >
      {/* 60fps Volumetric Canvas Layer */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Center 3D-Sheen Metallic Academia-ESEC Crest Reveal */}
      <div
        className={`relative z-10 flex flex-col items-center justify-center px-6 text-center transition-all duration-1000 ease-out ${logoTransformClass}`}
      >
        <div className="relative w-52 h-44 sm:w-64 sm:h-52 flex items-center justify-center">
          <svg
            viewBox="0 0 380 300"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full drop-shadow-[0_0_28px_rgba(245,197,66,0.45)]"
            aria-label="Academia-ESEC emblem"
          >
            <defs>
              <linearGradient id="splashGold" x1="60" y1="15" x2="320" y2="230" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FFF3B0" />
                <stop offset="28%" stopColor="#F5C84C" />
                <stop offset="62%" stopColor="#C98E12" />
                <stop offset="100%" stopColor="#8F5E04" />
              </linearGradient>
              <linearGradient id="splashGoldHighlight" x1="120" y1="20" x2="260" y2="210" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.7" />
                <stop offset="50%" stopColor="#FDE68A" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#C98E12" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="splashNavy" x1="55" y1="160" x2="335" y2="285" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#262A72" />
                <stop offset="48%" stopColor="#16144A" />
                <stop offset="100%" stopColor="#0D0A2E" />
              </linearGradient>
              <linearGradient id="splashBookRim" x1="65" y1="170" x2="330" y2="265" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#93A8F8" />
                <stop offset="50%" stopColor="#FDE68A" />
                <stop offset="100%" stopColor="#6378D4" />
              </linearGradient>
            </defs>

            {/* Three soaring metallic golden figures */}
            <g fill="url(#splashGold)">
              {/* Left figure */}
              <circle cx="106" cy="112" r="14.5" />
              <path d="M50 142 C91 127 127 132 157 161 C169 173 179 194 184 216 C174 186 157 166 132 151 C107 138 79 140 50 142 Z" />
              <path d="M93 64 C121 82 142 110 159 144 C166 159 174 181 180 208 C168 176 146 139 129 118 C115 99 104 81 93 64 Z" />
              {/* Center figure */}
              <circle cx="179" cy="65" r="16" />
              <path d="M106 50 C145 52 170 75 186 110 C200 78 228 39 268 16 C239 55 215 99 202 159 C198 180 196 201 194 219 C188 180 179 140 162 105 C149 77 130 60 106 50 Z" />
              {/* Right figure */}
              <circle cx="278" cy="95" r="15" />
              <path d="M292 31 C260 57 233 95 217 146 C211 165 207 187 204 212 C216 180 232 155 258 139 C288 120 320 112 350 112 C314 104 278 108 250 127 C261 89 275 57 292 31 Z" />
            </g>

            {/* Specular highlight overlay on crest */}
            <path
              d="M179 49 C194 65 208 82 224 104 C211 132 201 166 196 206 C191 164 179 126 164 94 Z"
              fill="url(#splashGoldHighlight)"
            />

            {/* Open Royal-Navy Book with metallic bevel stroke */}
            <path
              d="M64 268 C100 234 126 198 154 196 C169 195 180 207 186 220 C176 211 163 203 150 207 C126 215 103 241 86 256 C118 251 150 256 171 270 L188 224 L184 275 C188 281 192 285 196 286 C212 266 263 245 336 253 L310 164 C278 160 231 177 206 202 C233 185 274 173 298 177 L319 241 C265 236 218 253 192 273 L192 222 L175 262 C147 247 107 249 64 268 Z"
              fill="url(#splashNavy)"
              stroke="url(#splashBookRim)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Metallic Gold Title + Since 2026 Rule */}
        <div
          className={`mt-1 transition-all duration-700 delay-150 ${
            phase === 'ribbons' ? 'opacity-0 translate-y-3' : 'opacity-100 translate-y-0'
          }`}
        >
          <h1
            className="text-2xl sm:text-4xl font-extrabold tracking-[0.22em] text-transparent bg-clip-text bg-gradient-to-b from-[#FFF4B8] via-[#EAB72E] to-[#9E6B06] drop-shadow-[0_2px_18px_rgba(234,179,8,0.45)]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            ACADEMIA-ESEC
          </h1>
          <div className="mt-2.5 flex items-center justify-center gap-3">
            <span className="h-[1.5px] w-12 sm:w-16 bg-gradient-to-r from-transparent via-amber-300/80 to-indigo-300/80" />
            <span className="text-[11px] sm:text-xs font-semibold tracking-[0.36em] text-amber-100/90 uppercase">
              SINCE 2026
            </span>
            <span className="h-[1.5px] w-12 sm:w-16 bg-gradient-to-l from-transparent via-amber-300/80 to-indigo-300/80" />
          </div>
          <p className="mt-3 text-[11px] tracking-[0.18em] uppercase text-slate-400">
            Smart Academic Department Operations Suite
          </p>
        </div>
      </div>

      {/* Subtle Skip Button */}
      <button
        type="button"
        onClick={finishSplash}
        className="fixed bottom-6 right-6 z-20 px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-amber-200/80 hover:text-amber-100 bg-white/5 hover:bg-white/10 border border-amber-300/20 rounded-full backdrop-blur-sm transition-colors"
      >
        Skip Intro
      </button>
    </div>
  );
}
