// Fuzzy matching of OCR text against Pokémon names in several languages.

export type CardLang = 'en' | 'ja' | 'zhs' | 'zht';

export interface NameEntry {
  id: number;
  en: string;
  ja: string;
  zhs: string;
  zht: string;
}

export interface OcrLine {
  text: string;
  height: number; // pixel height of the line's bounding box
}

export interface MatchResult {
  id: number;
  score: number; // 0..1, higher is better
  text: string; // the OCR text that matched
}

export type SpecialCard = 'trainer' | 'energy';

/** Lower-case Latin letters and digits only, diacritics removed (é → e). */
export function normLatin(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** CJK text: NFKC, no spaces/punctuation, hiragana → katakana, common OCR confusions fixed. */
export function normCjk(s: string, lang: CardLang): string {
  let out = s.normalize('NFKC').replace(/[\s\p{P}\p{S}a-zA-Z0-9]/gu, '');
  if (lang === 'ja') {
    out = out
      .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      .replace(/[一―‐－]/g, 'ー') // the long vowel mark is often read as 一
      .replace(/[口]/g, 'ロ')
      .replace(/[力]/g, 'カ')
      .replace(/[工]/g, 'エ')
      .replace(/[夕]/g, 'タ')
      .replace(/[卜]/g, 'ト')
      .replace(/[二]/g, 'ニ')
      .replace(/[八]/g, 'ハ');
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

/** Minimum similarity a name of this length needs before we trust it. */
function threshold(len: number): number {
  if (len <= 3) return 1; // Mew, Muk, 皮卡丘…: exact only
  if (len <= 4) return 0.75;
  if (len <= 6) return 0.8;
  return 0.75;
}

// Words that appear near the name on English cards but are not the name.
const EN_NOISE = new Set(['basic', 'stage', 'stage1', 'stage2', 'hp', 'evolves', 'from', 'put', 'on', 'the', 'ex', 'v', 'vmax', 'vstar', 'gx', 'radiant', 'tera', 'ability', 'trainer', 'item', 'supporter', 'stadium', 'energy', 'pokemon', 'tool']);

export class NameMatcher {
  private keys: Map<CardLang, { id: number; key: string }[]> = new Map();

  constructor(entries: NameEntry[]) {
    const langs: CardLang[] = ['en', 'ja', 'zhs', 'zht'];
    for (const lang of langs) {
      const list: { id: number; key: string }[] = [];
      for (const e of entries) {
        const raw = e[lang];
        const key = lang === 'en' ? normLatin(raw) : normCjk(raw, lang);
        if (key) list.push({ id: e.id, key });
      }
      this.keys.set(lang, list);
    }
  }

  /** Best name match in a single piece of text, or null. */
  matchText(text: string, lang: CardLang): MatchResult | null {
    return lang === 'en' ? this.matchLatin(text) : this.matchCjk(text, lang);
  }

  private matchLatin(text: string): MatchResult | null {
    const words = text.split(/[\s]+/).map(normLatin).filter(Boolean);
    const list = this.keys.get('en')!;
    let best: MatchResult | null = null;
    const consider = (id: number, sim: number, need: number, text: string) => {
      if (sim >= need && (!best || sim > best.score)) best = { id, score: sim, text };
    };
    for (let i = 0; i < words.length; i++) {
      if (EN_NOISE.has(words[i])) continue;
      let cand = '';
      for (let w = 0; w < 3 && i + w < words.length; w++) {
        cand += words[i + w];
        if (cand.length < 3) continue;
        // "Mew V", "Mew ex": a card suffix right after a short name makes a 1-letter OCR slip acceptable.
        const suffixNext = /^(v|ex|gx|vmax|vstar|v\d)$/.test(words[i + w + 1] || '');
        for (const { id, key } of list) {
          const need = key.length <= 3 && suffixNext ? 0.66 : threshold(key.length);
          if (Math.abs(key.length - cand.length) <= 2) consider(id, similarity(cand, key), need, cand);
          // OCR often glues junk onto the end of the name ("Solrockiir").
          if (w === 0 && cand.length > key.length && key.length >= 5) {
            consider(id, similarity(cand.slice(0, key.length), key) * 0.95, need, cand);
          }
        }
      }
    }
    return best;
  }

  private matchCjk(text: string, lang: CardLang): MatchResult | null {
    const line = normCjk(text, lang);
    if (!line) return null;
    const list = this.keys.get(lang)!;
    let best: MatchResult | null = null;
    for (const { id, key } of list) {
      const L = key.length;
      if (line.includes(key)) {
        // Prefer longer exact matches (e.g. ピカチュウ over a shorter name inside it).
        const score = 1 + L * 0.001;
        if (!best || score > best.score) best = { id, score, text: key };
        continue;
      }
      if (L < 4) continue; // short names must match exactly
      for (let len = L - 1; len <= L + 1; len++) {
        for (let s = 0; s + len <= line.length; s++) {
          const sim = similarity(line.slice(s, s + len), key);
          if (sim >= threshold(L) && (!best || sim > best.score)) {
            best = { id, score: sim, text: line.slice(s, s + len) };
          }
        }
      }
    }
    if (best && best.score > 1) best.score = 1;
    return best;
  }

  /**
   * Picks the most likely card name among OCR lines. Larger text wins ties,
   * since the name is the biggest text at the top of a card; lines such as
   * "Evolves from Charmander" are down-weighted.
   */
  matchLines(lines: OcrLine[], lang: CardLang): MatchResult | null {
    const maxH = Math.max(1, ...lines.map((l) => l.height));
    let best: MatchResult | null = null;
    for (const line of lines) {
      const m = this.matchText(line.text, lang);
      if (!m) continue;
      let score = m.score * (0.6 + 0.4 * (line.height / maxH));
      if (/evolve|from|進化|进化|から/i.test(line.text)) score *= 0.6;
      if (!best || score > best.score) best = { ...m, score };
    }
    return best;
  }
}

/** Detects non-Pokémon cards from OCR text. */
export function detectSpecial(lines: OcrLine[]): SpecialCard | null {
  const all = lines.map((l) => l.text).join(' ');
  if (/\bTRAINER\b|SUPPORTER|トレーナーズ|サポート|训练家|訓練家|支援者/i.test(all)) return 'trainer';
  // Supporter cards are usually named after a person: "Rosa's Encouragement", "Boss's Orders".
  if (/\b[A-Z][a-z]+['’]s\s+[A-Z][a-z]{3,}/.test(all)) return 'trainer';
  if (/\b(Professor|Research|Potion|Poké ?Ball|Ultra Ball|Great Ball|Rare Candy|Switch|Nest Ball|Stadium|Tool)\b/.test(all)) return 'trainer';
  if (/\bENERGY\b|エネルギー|能量/i.test(all) && !/\bHP\s*\d/i.test(all)) return 'energy';
  return null;
}

/** Collects votes across frames so one noisy OCR frame cannot trigger a result. */
export class Voter {
  private history: (MatchResult | null)[] = [];
  private size: number;
  private need: number;
  constructor(size = 4, need = 1.5) {
    this.size = size;
    this.need = need;
  }

  push(m: MatchResult | null): number | null {
    this.history.push(m);
    if (this.history.length > this.size) this.history.shift();
    const totals = new Map<number, number>();
    for (const h of this.history) if (h) totals.set(h.id, (totals.get(h.id) || 0) + h.score);
    for (const [id, total] of totals) if (total >= this.need) return id;
    return null;
  }

  reset(): void {
    this.history = [];
  }
}
