import { getState, setState, tick, freshState, type GameState } from "./state";

const KEY = "cosmic-pizza:v1";
const OFFLINE_CAP_SEC = 4 * 60 * 60;
const OFFLINE_STEP_SEC = 1;

export function saveNow(): void {
  const s = getState();
  s.lastSavedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore quota / private mode
  }
}

export function loadSaved(): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<GameState>;
    const base = freshState(parsed.prestigeBonus ?? 1);
    const merged: GameState = { ...base, ...parsed } as GameState;
    setState(merged);
    catchUpOffline();
    return true;
  } catch {
    return false;
  }
}

function catchUpOffline(): void {
  const s = getState();
  const now = Date.now();
  const elapsed = Math.max(0, (now - s.lastSavedAt) / 1000);
  const capped = Math.min(elapsed, OFFLINE_CAP_SEC);
  let remaining = capped;
  while (remaining > 0) {
    const step = Math.min(remaining, OFFLINE_STEP_SEC);
    tick(step);
    remaining -= step;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function startAutosave(): void {
  setInterval(saveNow, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  window.addEventListener("beforeunload", saveNow);
}
