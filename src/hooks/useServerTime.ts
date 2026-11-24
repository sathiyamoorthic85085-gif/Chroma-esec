import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ServerTimePayload } from '../types';

export function useServerTime() {
  const [serverTime, setServerTime] = useState<ServerTimePayload | null>(null);
  const [displayTime, setDisplayTime] = useState<string>('--:--:--');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const syncAnchorRef = useRef<{ serverEpochMs: number; perfNowMs: number; tz: string } | null>(
    null
  );

  const refreshServerTime = useCallback(async () => {
    try {
      const data = await api.getServerTime();
      setServerTime(data);
      setDisplayTime(data.formattedTime);
      setError(null);
      syncAnchorRef.current = {
        serverEpochMs: data.serverEpochMs,
        perfNowMs: performance.now(),
        tz: data.academicTimezone,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach server clock.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshServerTime();
    const resyncTimer = window.setInterval(refreshServerTime, 60_000);
    return () => window.clearInterval(resyncTimer);
  }, [refreshServerTime]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      const anchor = syncAnchorRef.current;
      if (!anchor) return;
      const elapsedMs = performance.now() - anchor.perfNowMs;
      const estimatedServerDate = new Date(anchor.serverEpochMs + elapsedMs);
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: anchor.tz,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }).formatToParts(estimatedServerDate);
        const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
        const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
        const ss = parts.find((p) => p.type === 'second')?.value ?? '00';
        setDisplayTime(`${hh === '24' ? '00' : hh}:${mm}:${ss}`);
      } catch {
        // Fallback to last server formatted string
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  return { serverTime, displayTime, loading, error, refreshServerTime };
}
