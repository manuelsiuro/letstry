import { getState, setState, tick, freshState, type GameState } from "./state";
import { UPGRADES } from "./upgrades";
import { getItem, setItem, removeItem } from "../platform/storage";

const KEY_V2 = "cosmic-pizza:v2";
const KEY_V1 = "cosmic-pizza:v1";
const OFFLINE_CAP_SEC = 4 * 60 * 60;
const OFFLINE_STEP_SEC = 1;

export const SAVE_KEYS = [KEY_V1, KEY_V2];

export function saveNow(): void {
  const s = getState();
  s.lastSavedAt = Date.now();
  setItem(KEY_V2, JSON.stringify(s));
}

export function loadSaved(): boolean {
  let raw: string | null = getItem(KEY_V2);
  let fromV1 = false;
  if (!raw) {
    raw = getItem(KEY_V1);
    if (raw) fromV1 = true;
  }
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as Partial<GameState> & { saveVersion?: number };
    const base = freshState(parsed.prestigeBonus ?? 1);
    const merged: GameState = { ...base, ...parsed } as GameState;
    if (fromV1 || !merged.saveVersion || merged.saveVersion < 2) migrateV1ToV2(merged);
    setState(merged);
    catchUpOffline();
    // Persist back as v2 so we don't keep reading the old key.
    saveNow();
    if (fromV1) removeItem(KEY_V1);
    return true;
  } catch {
    return false;
  }
}

function migrateV1ToV2(s: GameState): void {
  // v1 stored only `upgradesOwned` (boolean map). v2 uses `upgradeLevel` (number).
  // Every previously-owned upgrade becomes level 1; tiered ones keep room to grow.
  if (!s.upgradeLevel) s.upgradeLevel = {};
  for (const def of UPGRADES) {
    if (s.upgradesOwned?.[def.id] && !s.upgradeLevel[def.id]) {
      s.upgradeLevel[def.id] = 1;
    }
  }
  if (typeof s.multiverseShards !== "number") s.multiverseShards = 0;
  if (typeof s.timeCrystals !== "number") s.timeCrystals = 0;
  if (typeof s.empireCredits !== "number") s.empireCredits = 0;
  s.saveVersion = 2;
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
  removeItem(KEY_V2);
  removeItem(KEY_V1);
}

export function startAutosave(): void {
  setInterval(saveNow, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });
  window.addEventListener("beforeunload", saveNow);
}
