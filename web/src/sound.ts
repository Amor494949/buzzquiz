// Tiny synthesized sounds (no audio files). Browsers only allow sound after a
// tap or click, so call unlock() from a user gesture first.

let ctx: AudioContext | null = null;

export async function unlockAudio() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new Ctor();
    await ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, endFreq: number, ms: number, gain = 0.25, type: OscillatorType = "sine") {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(endFreq, t + ms / 1000);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000 + 0.02);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.03);
}

/** Short click when a player buzzes. */
export const buzzClick = () => tone(1400, 600, 60);
/** Display: someone buzzed. */
export const buzzIn = () => tone(880, 660, 140, 0.3, "triangle");
/** Display: time is up (soft two-note). */
export function timeUp() {
  tone(523, 520, 220, 0.18);
  setTimeout(() => tone(392, 390, 320, 0.18), 230);
}

export function vibrate(ms = 30) {
  try {
    navigator.vibrate?.(ms);
  } catch {}
}

export async function keepScreenOn() {
  try {
    await (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } }).wakeLock?.request("screen");
  } catch {}
}
