// Reads Pokédex entries aloud in the style of the Pokédex in the anime:
// "Pikachu. The Mouse Pokémon. <entry>", in short pieces with natural pauses,
// using the most natural-sounding voice the device has.

import type { Lang } from './data';

const BCP47: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP' };

export interface VoiceInfo {
  name: string;
  lang: string;
  localService?: boolean;
}

// Apple's novelty and "Eloquence" voices sound like old robots: never pick them automatically.
const ROBOTIC = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news',
  'hysterical', 'jester', 'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble',
  'zarvox', 'fred', 'junior', 'ralph', 'kathy', 'princess', 'eddy', 'flo', 'grandma', 'grandpa',
  'reed', 'rocko', 'sandy', 'shelley',
]);

// Voices known to sound good, per language (Apple, Google, Microsoft).
const KNOWN_GOOD: Record<Lang, string[]> = {
  en: ['ava', 'zoe', 'evan', 'nathan', 'samantha', 'allison', 'tom', 'susan', 'noelle', 'joelle', 'daniel', 'karen', 'serena', 'aria', 'jenny', 'guy', 'google us english'],
  zh: ['lili', 'tingting', 'ting-ting', 'yu-shu', 'lilian', 'yaoyao', 'xiaoxiao', 'xiaoyi', 'yunxi', 'yunyang', 'google 普通话', 'google 國語'],
  ja: ['kyoko', 'otoya', 'o-ren', 'hattori', 'nanami', 'keita', 'ayumi', 'google 日本語'],
};

const baseName = (name: string) => name.toLowerCase().replace(/\s*\(.*\)\s*/g, '').trim();

/** Higher is more natural; -1 means "don't use for this language". Pure, so it can be unit-tested. */
export function voiceScore(v: VoiceInfo, lang: Lang): number {
  const vl = v.lang.toLowerCase().replace('_', '-');
  const want = BCP47[lang].toLowerCase();
  if (!vl.startsWith(want.slice(0, 2))) return -1;
  const name = v.name.toLowerCase();
  if (ROBOTIC.has(baseName(v.name))) return -1;
  let s = 0;
  if (vl === want) s += 8; // zh-CN for Simplified Chinese, not zh-HK Cantonese
  else if (lang === 'zh' && vl.startsWith('zh-tw')) s += 4;
  if (/premium/.test(name)) s += 60;
  if (/enhanced|neural|natural|wavenet|studio/.test(name)) s += 45;
  if (/online/.test(name) || v.localService === false) s += 25; // cloud voices (Edge, Chrome)
  if (/^google/.test(name)) s += 20;
  if (/siri/.test(name)) s += 30;
  if (KNOWN_GOOD[lang].some((k) => name.includes(k))) s += 15;
  if (/compact/.test(name)) s -= 10;
  return s;
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let voices: SpeechSynthesisVoice[] = [];
function refreshVoices() {
  voices = speechSynthesis.getVoices();
}
if (speechSupported) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}

/** Voices usable for a language, most natural first. */
export function listVoices(lang: Lang): SpeechSynthesisVoice[] {
  if (!speechSupported) return [];
  if (!voices.length) refreshVoices();
  return voices
    .map((v) => ({ v, s: voiceScore(v, lang) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.v.name.localeCompare(b.v.name))
    .map((x) => x.v);
}

// The voice chosen in Settings for each language ('' = automatic).
const chosen: Partial<Record<Lang, string>> = {};
export function setVoiceChoice(lang: Lang, voiceURI: string): void {
  chosen[lang] = voiceURI;
}

function voiceFor(lang: Lang): SpeechSynthesisVoice | undefined {
  const list = listVoices(lang);
  return list.find((v) => v.voiceURI === chosen[lang]) || list[0];
}

/** iOS only lets pages speak after speech was started from a tap; call this from one. */
export function unlockSpeech(): void {
  if (!speechSupported) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Splits long text into sentences so each piece gets its own natural pause. */
export function sentences(text: string): string[] {
  // A plain loop rather than a regex lookbehind, which older iPads can't parse.
  const t = text.replace(/　/g, ' ');
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    cur += c;
    const endsCjk = '。！？'.includes(c);
    const endsLatin = '.!?'.includes(c) && (i + 1 === t.length || t[i + 1] === ' ') && !/\b(Mr|Mrs|Ms|Dr|St)\.$/.test(cur);
    if (endsCjk || endsLatin) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Speaks the pieces one after another, like the Pokédex reading an entry. */
export function speak(parts: string | string[], lang: Lang): void {
  if (!speechSupported) return;
  speechSynthesis.cancel();
  const voice = voiceFor(lang);
  const pieces = (Array.isArray(parts) ? parts : [parts]).flatMap(sentences);
  for (const text of pieces) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || BCP47[lang];
    if (voice) u.voice = voice;
    // Natural voices sound best at their own pitch; a touch slower is clearer for kids.
    u.rate = lang === 'en' ? 0.95 : 0.92;
    u.pitch = 1;
    speechSynthesis.speak(u);
  }
}

export function stopSpeaking(): void {
  if (speechSupported) speechSynthesis.cancel();
}
