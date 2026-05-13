import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Synchronous-feeling key/value storage that works on web (localStorage) and
 * native (Capacitor Preferences). On native we keep an in-memory mirror so
 * existing synchronous callers (loadSaved, saveNow) don't need to be rewritten.
 *
 * Call `hydrate()` once at startup before reading keys on native.
 */

const NATIVE = Capacitor.isNativePlatform();
const mirror: Record<string, string | null> = {};

export async function hydrate(keys: string[]): Promise<void> {
  if (!NATIVE) return;
  for (const k of keys) {
    const { value } = await Preferences.get({ key: k });
    mirror[k] = value;
  }
}

export function getItem(key: string): string | null {
  if (NATIVE) {
    return mirror[key] ?? null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string): void {
  if (NATIVE) {
    mirror[key] = value;
    void Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / private mode
  }
}

export function removeItem(key: string): void {
  if (NATIVE) {
    mirror[key] = null;
    void Preferences.remove({ key });
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function isNative(): boolean {
  return NATIVE;
}
