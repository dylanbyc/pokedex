// Reads Pokédex entries aloud, like the Pokédex in the anime.

import type { Lang } from './data';

const BCP47: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' };

function pickVoice(lang: Lang): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const want = BCP47[lang].toLowerCase();
  const base = want.slice(0, 2);
  return (
    voices.find((v) => v.lang.toLowerCase().replace('_', '-') === want) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base))
  );
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** iOS only lets pages speak after speech was started from a tap; call this from one. */
export function unlockSpeech(): void {
  if (!speechSupported) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

export function speak(text: string, lang: Lang): void {
  if (!speechSupported) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP47[lang];
  const v = pickVoice(lang);
  if (v) u.voice = v;
  u.rate = lang === 'en' ? 1.0 : 0.95;
  u.pitch = 1.05;
  speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (speechSupported) speechSynthesis.cancel();
}
