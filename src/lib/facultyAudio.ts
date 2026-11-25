export type FacultyAudioPreset = 'siren_pulse' | 'campus_bell' | 'urgent_chime' | 'custom';

export interface FacultyAudioSettings {
  preset: FacultyAudioPreset;
  customAudioName: string;
  customAudioDataUrl: string;
  volume: number; // 0.1 to 1.0
  vibrateEnabled: boolean;
}

const STORAGE_KEY = 'chromagrade_faculty_audio_v1';
const MAX_CUSTOM_AUDIO_BYTES = 1.5 * 1024 * 1024; // 1.5 MB raw file cap (~2 MB base64)

const DEFAULT_SETTINGS: FacultyAudioSettings = {
  preset: 'siren_pulse',
  customAudioName: '',
  customAudioDataUrl: '',
  volume: 0.85,
  vibrateEnabled: true,
};

let activeAudioEl: HTMLAudioElement | null = null;

export function getFacultyAudioSettings(): FacultyAudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FacultyAudioSettings>;
    const preset: FacultyAudioPreset =
      parsed.preset === 'campus_bell' ||
      parsed.preset === 'urgent_chime' ||
      parsed.preset === 'custom'
        ? parsed.preset
        : 'siren_pulse';
    const dataUrl =
      typeof parsed.customAudioDataUrl === 'string' &&
      parsed.customAudioDataUrl.startsWith('data:audio/')
        ? parsed.customAudioDataUrl
        : '';
    const volume =
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0.1, parsed.volume))
        : DEFAULT_SETTINGS.volume;
    return {
      preset: preset === 'custom' && !dataUrl ? 'siren_pulse' : preset,
      customAudioName: typeof parsed.customAudioName === 'string' ? parsed.customAudioName : '',
      customAudioDataUrl: dataUrl,
      volume,
      vibrateEnabled: parsed.vibrateEnabled !== false,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveFacultyAudioSettings(
  patch: Partial<FacultyAudioSettings>
): FacultyAudioSettings {
  const current = getFacultyAudioSettings();
  const next: FacultyAudioSettings = {
    ...current,
    ...patch,
    volume:
      patch.volume !== undefined && Number.isFinite(patch.volume)
        ? Math.min(1, Math.max(0.1, patch.volume))
        : current.volume,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage quota exceeded — keep preset without overflowing localStorage
    if (patch.customAudioDataUrl) {
      throw new Error(
        'Audio clip is too large for browser storage. Please choose a shorter audio file (under 1.2 MB).'
      );
    }
  }
  return next;
}

export function validateCustomAudioFile(file: File): string | null {
  if (!file) return 'Select an audio file first.';
  const validMime =
    file.type.startsWith('audio/') ||
    /\.(mp3|wav|ogg|m4a|webm|aac)$/i.test(file.name);
  if (!validMime) {
    return 'Unsupported file format. Upload MP3, WAV, OGG, M4A, AAC, or WebM audio.';
  }
  if (file.size > MAX_CUSTOM_AUDIO_BYTES) {
    return 'Audio file exceeds 1.5 MB limit. Please upload a shorter alert tone (3–15 seconds).';
  }
  return null;
}

export function stopActiveFacultyAudio(): void {
  if (activeAudioEl) {
    try {
      activeAudioEl.pause();
      activeAudioEl.currentTime = 0;
    } catch {
      // Ignore cleanup errors
    }
    activeAudioEl = null;
  }
}

function playSynthesizedTone(
  preset: FacultyAudioPreset | 'chat' | 'power_boost',
  volume: number
) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const v = Math.min(0.35, Math.max(0.05, volume * 0.25));

    const steps: { freq: number; delay: number; dur: number; type: OscillatorType; gain: number }[] =
      preset === 'chat'
        ? [{ freq: 659.25, delay: 0, dur: 0.14, type: 'sine', gain: v * 0.55 }]
        : preset === 'power_boost'
        ? [
            { freq: 880, delay: 0, dur: 0.18, type: 'sine', gain: v },
            { freq: 1174.66, delay: 0.16, dur: 0.24, type: 'sine', gain: v },
          ]
        : preset === 'campus_bell'
        ? [
            { freq: 523.25, delay: 0, dur: 0.28, type: 'sine', gain: v },
            { freq: 659.25, delay: 0.22, dur: 0.28, type: 'sine', gain: v },
            { freq: 783.99, delay: 0.44, dur: 0.42, type: 'sine', gain: v * 1.1 },
          ]
        : preset === 'urgent_chime'
        ? [
            { freq: 740, delay: 0, dur: 0.14, type: 'triangle', gain: v },
            { freq: 987.77, delay: 0.14, dur: 0.14, type: 'triangle', gain: v },
            { freq: 1318.5, delay: 0.28, dur: 0.26, type: 'triangle', gain: v * 1.1 },
          ]
        : [
            // 'siren_pulse' (default urgent faculty alert)
            { freq: 784, delay: 0, dur: 0.16, type: 'sawtooth', gain: v * 0.85 },
            { freq: 1046.5, delay: 0.17, dur: 0.16, type: 'sawtooth', gain: v * 0.9 },
            { freq: 784, delay: 0.34, dur: 0.16, type: 'sawtooth', gain: v * 0.85 },
            { freq: 1046.5, delay: 0.51, dur: 0.24, type: 'sawtooth', gain: v * 0.95 },
          ];

    steps.forEach((step) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type;
      osc.frequency.setValueAtTime(step.freq, now + step.delay);
      gain.gain.setValueAtTime(0.0001, now + step.delay);
      gain.gain.exponentialRampToValueAtTime(step.gain, now + step.delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + step.delay + step.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + step.delay);
      osc.stop(now + step.delay + step.dur + 0.03);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1200);
  } catch {
    // Ignore browser autoplay restrictions
  }
}

export function playFacultyAlertAudio(
  channel:
    | 'chat'
    | 'power_boost'
    | 'faculty_delay'
    | 'attendance_alert'
    | 'goal_nudge'
    | 'page_call',
  options?: { overrideSettings?: FacultyAudioSettings }
): void {
  const settings = options?.overrideSettings ?? getFacultyAudioSettings();
  const isFacultyUrgent =
    channel === 'faculty_delay' ||
    channel === 'page_call' ||
    channel === 'attendance_alert';

  if (isFacultyUrgent && settings.vibrateEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(
        channel === 'page_call'
          ? [320, 120, 320, 120, 480]
          : [220, 100, 220, 100, 340]
      );
    } catch {
      // Ignore vibration API blocks
    }
  }

  if (isFacultyUrgent && settings.preset === 'custom' && settings.customAudioDataUrl) {
    try {
      stopActiveFacultyAudio();
      const audio = new Audio(settings.customAudioDataUrl);
      audio.volume = settings.volume;
      activeAudioEl = audio;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          playSynthesizedTone('siren_pulse', settings.volume);
        });
      }
      return;
    } catch {
      playSynthesizedTone('siren_pulse', settings.volume);
      return;
    }
  }

  if (channel === 'chat' || channel === 'goal_nudge') {
    playSynthesizedTone('chat', settings.volume);
  } else if (channel === 'power_boost') {
    playSynthesizedTone('power_boost', settings.volume);
  } else {
    playSynthesizedTone(
      settings.preset === 'custom' ? 'siren_pulse' : settings.preset,
      settings.volume
    );
  }
}
