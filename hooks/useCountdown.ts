import { useEffect, useState } from 'react';

export interface CountdownState {
  expired: boolean;
  h: number;
  m: number;
  s: number;
  totalMs: number;
}

export function useCountdown(expiresAt: string | null | undefined): CountdownState {
  const [msLeft, setMsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!expiresAt) { setMsLeft(null); return; }
    const tick = () => setMsLeft(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (msLeft === null || msLeft <= 0) {
    return { expired: msLeft !== null && msLeft <= 0, h: 0, m: 0, s: 0, totalMs: msLeft ?? 0 };
  }
  return {
    expired: false,
    h: Math.floor(msLeft / 3_600_000),
    m: Math.floor((msLeft % 3_600_000) / 60_000),
    s: Math.floor((msLeft % 60_000) / 1_000),
    totalMs: msLeft,
  };
}
