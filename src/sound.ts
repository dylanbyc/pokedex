// Little electronic beeps made with Web Audio (no sound files needed).

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.06) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur);
}

export function beepFound(): void {
  tone(880, 0, 0.09);
  tone(1320, 0.1, 0.09);
  tone(1760, 0.2, 0.18);
}

export function beepTap(): void {
  tone(660, 0, 0.05, 'square', 0.04);
}

export function beepMiss(): void {
  tone(330, 0, 0.12, 'triangle', 0.08);
  tone(247, 0.13, 0.18, 'triangle', 0.08);
}
