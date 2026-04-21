import { useEffect, useMemo, useRef, useState } from "react";

export function useLocalStorageState<T>(key: string, fallback: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    const fallbackValue = typeof fallback === "function" ? (fallback as () => T)() : fallback;
    if (!stored) return fallbackValue;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return fallbackValue;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
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

export function playLeaderAlert() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
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
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "triangle";
  oscillator.frequency.setValueAtTime(660, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.08);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.24);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
