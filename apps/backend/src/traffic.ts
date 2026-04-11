import type { TrafficResponse } from "@kerala-election/shared";

const ACTIVE_WINDOW_MS = 60_000;
const activeViewers = new Map<string, number>();
const knownViewers = new Set<string>();
let totalViews = 0;

export function recordViewer(viewerId: string): TrafficResponse {
  const id = viewerId.trim() || "anonymous";
  const now = Date.now();
  activeViewers.set(id, now);

  if (!knownViewers.has(id)) {
    knownViewers.add(id);
    totalViews += 1;
  }

  for (const [activeId, lastSeen] of activeViewers) {
    if (now - lastSeen > ACTIVE_WINDOW_MS) activeViewers.delete(activeId);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    watchingNow: activeViewers.size,
    totalViews
  };
}
