let ctx: AudioContext | null = null;
let muted = false;

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function beep(freq: number, durSec: number, vol = 0.08, type: OscillatorType = "sine"): void {
  const ac = ensureCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);
  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + durSec + 0.02);
}

export function sfxClick(): void {
  beep(520, 0.08, 0.06, "triangle");
}

export function sfxSell(): void {
  beep(880, 0.06, 0.05, "square");
}

export function sfxBuy(): void {
  beep(440, 0.12, 0.1, "sawtooth");
  setTimeout(() => beep(660, 0.14, 0.08, "sawtooth"), 60);
}

export function sfxPhase(): void {
  beep(330, 0.2, 0.12, "sine");
  setTimeout(() => beep(495, 0.25, 0.1, "sine"), 120);
  setTimeout(() => beep(660, 0.3, 0.1, "sine"), 240);
}

export function sfxTranscend(): void {
  beep(220, 1.5, 0.18, "sine");
  setTimeout(() => beep(440, 1.2, 0.12, "sine"), 300);
  setTimeout(() => beep(880, 1.0, 0.08, "sine"), 600);
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

export function isMuted(): boolean {
  return muted;
}
