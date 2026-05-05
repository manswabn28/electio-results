import { useEffect, useMemo, useRef, useState } from "react";

let sharedAudioContext: AudioContext | undefined;

export function useLocalStorageState<T>(key: string, fallback: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    const fallbackValue = typeof fallback === "function" ? (fallback as () => T)() : fallback;
    if (typeof window === "undefined") return fallbackValue;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(key);
    } catch {
      return fallbackValue;
    }
    if (!stored) return fallbackValue;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallbackValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage write failures so the app keeps rendering.
    }
  }, [key, value]);

  return [value, setValue] as const;
}

export function useCountdown(intervalMs: number, tickKey: unknown) {
  const [remaining, setRemaining] = useState(intervalMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
    setRemaining(intervalMs);
  }, [intervalMs, tickKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      setRemaining(Math.max(0, intervalMs - elapsed));
    }, 250);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return Math.ceil(remaining / 1000);
}

export function usePreviousMap<T extends { constituencyId: string }>(items: T[]) {
  const previous = useRef(new Map<string, T>());
  const snapshot = useMemo(() => new Map(previous.current), [items]);

  useEffect(() => {
    previous.current = new Map(items.map((item) => [item.constituencyId, item]));
  }, [items]);

  return snapshot;
}

export async function primeAudioAlerts() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  sharedAudioContext ??= new AudioContextCtor();
  if (sharedAudioContext.state === "suspended") {
    await sharedAudioContext.resume().catch(() => undefined);
  }
}

function getAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return undefined;
  sharedAudioContext ??= new AudioContextCtor();
  if (sharedAudioContext.state === "suspended") {
    void sharedAudioContext.resume().catch(() => undefined);
  }
  return sharedAudioContext;
}

export function playLeaderAlert() {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 740;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
}

export function playChatMessageAlert() {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(720, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.1);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.3);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
