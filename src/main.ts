import './style.css';
import { loadDex, artworkUrl, spriteUrl, TYPE_COLORS, type Dex, type Lang, type Species } from './data';
import { t, statLabels, type Key } from './i18n';
import { NameMatcher, Voter, detectSpecial, isSureThing, type CardLang, type SpecialCard } from './match';
import { Camera, rotated, type Rect } from './camera';
import { loadCv, findCards, warpNameStrip, padQuad, type Quad } from './cardfinder';
import { Ocr } from './ocr';
import { speak, stopSpeaking, unlockSpeech, speechSupported, listVoices, setVoiceChoice } from './speech';
import { beepFound, beepMiss, beepTap, unlockAudio } from './sound';
import { getItem, setItem } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Settings & state ----------

const defaultLang = (): Lang => {
  const l = (navigator.language || '').toLowerCase();
  return l.startsWith('ja') ? 'ja' : l.startsWith('en') ? 'en' : 'zh';
};

const settings = {
  lang: getItem<Lang>('dex.lang', defaultLang()),
  cardLang: getItem<CardLang>('dex.cardLang', 'en'),
  autoScan: getItem('dex.autoScan', true),
  voice: getItem('dex.voice', true),
  aiKey: getItem('dex.aiKey', ''),
  voices: getItem<Partial<Record<Lang, string>>>('dex.voices', {}),
};
const save = () => {
  setItem('dex.lang', settings.lang);
  setItem('dex.cardLang', settings.cardLang);
  setItem('dex.autoScan', settings.autoScan);
  setItem('dex.voice', settings.voice);
  setItem('dex.aiKey', settings.aiKey);
  setItem('dex.voices', settings.voices);
};

const seen = new Set<number>(getItem<number[]>('dex.seen', []));
const saveSeen = () => setItem('dex.seen', [...seen]);

let dex: Dex;
let matcher: NameMatcher;
const camera = new Camera($<HTMLVideoElement>('video'));
const ocr = new Ocr();
const voter = new Voter(12, 1.5);
// Cards are rarely held perfectly straight; successive frames try slightly different angles.
const ANGLES = [0, 5, -5];
let frameNo = 0;
let specialVotes: SpecialCard[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any = null; // OpenCV, once loaded: finds and straightens cards anywhere in view
let searchingSince = 0; // when the scanner started looking for the current card
let lastAiAt = 0;
// The card outline that last produced a name-like read: the scanner keeps working on it.
let focus: { quad: Quad; until: number } | null = null;
const AUTO_AI_AFTER_MS = 2000; // with an API key: ask the AI if the scanner hasn't found it by then
const AUTO_AI_EVERY_MS = 4000; // and at most this often

type Mode = 'off' | 'scanning';
let mode: Mode = 'off';
let busy = false;
let aiBusy = false;
let shownId: number | null = null; // entry on the info screen
let lockedId: number | null = null; // last card confirmed by the scanner
let missFrames = 0;

// ---------- UI text ----------

function applyTexts() {
  document.documentElement.lang = settings.lang === 'zh' ? 'zh-CN' : settings.lang;
  document.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t as Key, settings.lang);
  });
  document.querySelectorAll<HTMLElement>('.lang-key').forEach((el) => {
    el.classList.toggle('active', el.dataset.lang === settings.lang);
  });
  $<HTMLInputElement>('searchInput').placeholder = t('searchPh', settings.lang);
  $('seenCount').textContent = String(seen.size);
  $('aiTag').hidden = !settings.aiKey;
  if (mode === 'scanning') setStatus(t('aim', settings.lang));
  else setStatus(t('startHint', settings.lang));
}

function setStatus(msg: string, raw = '') {
  const el = $('status');
  el.replaceChildren();
  const box = document.createElement('div');
  box.textContent = msg;
  if (raw) {
    const r = document.createElement('span');
    r.className = 'raw';
    r.textContent = raw;
    box.append(r);
  }
  el.append(box);
}

// ---------- Entry rendering ----------

const fmt = (n: number) => (Math.round(n) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

/**
 * The entry as the anime's Pokédex reads it: name, pause, category, pause,
 * then the entry text. Text missing in this language is skipped rather than
 * read in another language's voice.
 */
function entrySpeech(s: Species, lang: Lang): string[] {
  const name = s.n[lang];
  const genus = s.g[lang];
  const flavor = s.f[lang];
  const parts =
    lang === 'en'
      ? [`${name}.`, genus && `The ${genus}.`, flavor]
      : [`${name}。`, genus && `${genus}。`, flavor];
  return parts.filter((x): x is string => !!x);
}

let speakTimer = 0;
/** Speaks after a short pause so the scan chime finishes first. */
function speakSoon(parts: string | string[], lang: Lang, delay = 650) {
  clearTimeout(speakTimer);
  stopSpeaking();
  speakTimer = window.setTimeout(() => speak(parts, lang), delay);
}

function silence() {
  clearTimeout(speakTimer);
  stopSpeaking();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function showEntry(id: number, opts: { isNew?: boolean; announce?: boolean } = {}) {
  const s = dex.species[id - 1];
  if (!s) return;
  const L = settings.lang;
  shownId = id;
  $('idle').hidden = true;
  $('special').hidden = true;
  const entry = $('entry');
  entry.hidden = false;
  entry.replaceChildren();

  const head = el('div', 'entry-head');
  head.append(el('span', 'no', `No.${String(id).padStart(4, '0')}`));
  if (opts.isNew) head.append(el('span', 'badge new', t('newFind', L)));
  if (s.leg) head.append(el('span', 'badge leg', t(s.leg === 1 ? 'legendary' : 'mythical', L)));
  head.append(el('span', 'badge gen', t('gen', L, { n: s.gen })));
  entry.append(head);

  const hero = el('div', 'hero');
  const art = el('div', 'art-wrap');
  const img = el('img');
  img.src = artworkUrl(id);
  img.alt = s.n[L];
  img.decoding = 'async';
  img.onerror = () => { img.onerror = null; img.src = spriteUrl(id); };
  art.append(img);
  const titles = el('div');
  titles.append(el('h2', 'name', s.n[L]));
  const others = (['zh', 'en', 'ja'] as Lang[]).filter((x) => x !== L).map((x) => s.n[x]);
  titles.append(el('div', 'alt-names', others.join(' · ')));
  titles.append(el('div', 'genus', s.g[L] || s.g.en));
  const types = el('div', 'types');
  for (const ty of s.t) {
    const chip = el('span', 'type-chip', dex.types[ty]?.[L] ?? '');
    chip.style.background = TYPE_COLORS[ty] ?? '#888';
    types.append(chip);
  }
  titles.append(types);
  hero.append(art, titles);
  entry.append(hero);

  entry.append(el('p', 'flavor', s.f[L] || s.f.en));

  const facts = el('div', 'facts');
  const fact = (label: string, value: string) => {
    const f = el('div', 'fact');
    f.append(el('small', '', label), el('b', '', value));
    facts.append(f);
  };
  fact(t('height', L), `${fmt(s.h)} m`);
  fact(t('weight', L), `${fmt(s.w)} kg`);
  entry.append(facts);

  entry.append(el('h3', '', t('abilities', L)));
  const ul = el('ul', 'abilities');
  for (const a of s.a) {
    const ab = dex.abilities[Math.abs(a)];
    if (!ab) continue;
    const li = el('li');
    const b = el('b', '', ab.n[L] || ab.n.en);
    li.append(b);
    if (a < 0) li.append(el('span', 'hid', t('hidden', L)));
    const d = ab.d[L] || ab.d.en;
    if (d) li.append(el('p', '', d));
    ul.append(li);
  }
  entry.append(ul);

  entry.append(el('h3', '', t('stats', L)));
  const stats = el('div', 'stats');
  const labels = statLabels(L);
  const colors = ['#ff5959', '#f5ac78', '#fae078', '#9db7f5', '#a7db8d', '#fa92b2'];
  s.s.forEach((v, i) => {
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.min(100, (v / 200) * 100)}%`;
    fill.style.background = colors[i];
    bar.append(fill);
    stats.append(el('span', '', labels[i]), el('b', '', String(v)), bar);
  });
  entry.append(stats);

  if (s.evo.length > 1) {
    entry.append(el('h3', '', t('evolution', L)));
    const evo = el('div', 'evo');
    s.evo.forEach(([eid], i) => {
      if (i > 0) evo.append(el('span', 'arrow', '›'));
      const b = el('button', eid === id ? 'cur' : '');
      const im = el('img');
      im.src = spriteUrl(eid);
      im.alt = '';
      im.loading = 'lazy';
      b.append(im, el('span', '', dex.species[eid - 1].n[L]));
      b.onclick = () => { beepTap(); showEntry(eid, { announce: true }); };
      evo.append(b);
    });
    entry.append(evo);
  }

  $('info').scrollTop = 0;
  if (opts.announce && settings.voice) speakSoon(entrySpeech(s, L), L);
}

function showSpecial(kind: SpecialCard) {
  shownId = null;
  $('idle').hidden = true;
  $('entry').hidden = true;
  const box = $('special');
  box.hidden = false;
  box.replaceChildren();
  const inner = el('div');
  inner.append(el('span', 'big-emoji', kind === 'energy' ? '⚡' : '🎒'), document.createTextNode(t(kind, settings.lang)));
  box.append(inner);
  if (settings.voice) speakSoon(t(kind, settings.lang), settings.lang);
}

// Wide landscape screens show two halves side by side. Everywhere else the
// whole Pokédex fits one screen: the entry opens inside the main screen,
// on top of the camera, and the blue keys sit under the controls.
const splitMq = matchMedia('(min-width: 700px) and (min-aspect-ratio: 1/1)');

function placePanels() {
  const split = splitMq.matches;
  document.body.classList.toggle('stacked', !split);
  const info = $('info');
  const keys = document.querySelector<HTMLElement>('.keys')!;
  if (split) {
    $('rightHalf').insertBefore(info, $('rightFoot'));
    $('rightHalf').insertBefore(keys, $('rightFoot'));
  } else {
    $('screenStack').append(info);
    $('leftHalf').append(keys);
  }
}

function revealInfo() {
  $('screenStack').classList.add('show-info');
}

function hideInfo() {
  $('screenStack').classList.remove('show-info');
}

// ---------- Scanning ----------

function celebrate(id: number) {
  const isNew = !seen.has(id);
  seen.add(id);
  saveSeen();
  $('seenCount').textContent = String(seen.size);
  beepFound();
  navigator.vibrate?.(80);
  const flash = $('flash');
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.add('go');
  $('lens').classList.add('found');
  setTimeout(() => $('lens').classList.remove('found'), 1200);
  $('camScreen').classList.add('locked');
  $('againBtn').hidden = false;
  showEntry(id, { isNew, announce: true });
  setStatus(`✔ ${dex.species[id - 1].n[settings.lang]}`);
  revealInfo();
}

function resetLock() {
  lockedId = null;
  voter.reset();
  specialVotes = [];
  missFrames = 0;
  $('camScreen').classList.remove('locked');
  $('againBtn').hidden = true;
  searchingSince = Date.now();
  focus = null;
  drawQuad(null);
  if (mode === 'scanning') setStatus(t('aim', settings.lang));
}

async function startScanning() {
  unlockSpeech();
  unlockAudio();
  beepTap();
  const err = $('camError');
  err.hidden = true;
  if (!window.isSecureContext) {
    err.textContent = t('needHttps', settings.lang);
    err.hidden = false;
    return;
  }
  try {
    await camera.start();
  } catch {
    err.textContent = t('cameraError', settings.lang);
    err.hidden = false;
    return;
  }
  $('startOverlay').hidden = true;
  mode = 'scanning';
  $('camScreen').classList.add('scanning');
  setStatus(t('loadingOcr', settings.lang));
  $('device').querySelector('.leds')!.classList.add('blink');
  try {
    // OpenCV loads alongside the OCR engine; scanning starts without it and picks it up when ready.
    loadCv().then((m) => { cv = m; });
    await ocr.prepare(settings.cardLang);
  } finally {
    $('device').querySelector('.leds')!.classList.remove('blink');
  }
  setStatus(t('aim', settings.lang));
  searchingSince = Date.now();
  loop();
}

/** Draws the outline of the card the scanner is looking at (video pixel coords). */
function drawQuad(q: Quad | null, locked = false) {
  const c = $<HTMLCanvasElement>('quadCanvas');
  const screen = $('camScreen');
  const dpr = window.devicePixelRatio || 1;
  const w = screen.clientWidth, h = screen.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!q) return;
  ctx.beginPath();
  q.forEach(([x, y], i) => {
    const [ex, ey] = camera.toElement(screen, x, y);
    if (i) ctx.lineTo(ex, ey);
    else ctx.moveTo(ex, ey);
  });
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = locked ? '#57f28a' : '#ffe14d';
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 6;
  ctx.setLineDash(locked ? [] : [14, 8]);
  ctx.stroke();
}

/** Bounding box of a (padded) card outline, with a margin, clamped to the frame. */
function boxAround(q: Quad): Rect {
  const p = padQuad(q, 0.12);
  const xs = p.map((v) => v[0]), ys = p.map((v) => v[1]);
  const vw = camera.video.videoWidth, vh = camera.video.videoHeight;
  const sx = Math.max(0, Math.min(...xs)), sy = Math.max(0, Math.min(...ys));
  return { sx, sy, sw: Math.min(vw, Math.max(...xs)) - sx, sh: Math.min(vh, Math.max(...ys)) - sy };
}

/** Which outline to read this frame: the focused card if it's still there, else mostly the best one. */
function pickQuad(quads: Quad[], n: number): Quad {
  if (focus) {
    const centre = (q: Quad) => [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4];
    const [fx, fy] = centre(focus.quad);
    const near = quads
      .map((q) => ({ q, d: Math.hypot(centre(q)[0] - fx, centre(q)[1] - fy) }))
      .sort((a, b) => a.d - b.d)[0];
    const size = Math.hypot(focus.quad[0][0] - focus.quad[2][0], focus.quad[0][1] - focus.quad[2][1]);
    if (near.d < size * 0.25) return near.q;
  }
  // Every third frame, give the runners-up a turn.
  return n % 3 === 2 && quads.length > 1 ? quads[1 + (Math.floor(n / 3) % (quads.length - 1))] : quads[0];
}

/** Finds cards in view; returns their outlines in video pixels (best first). */
function locateCards(): Quad[] {
  const view = camera.sourceRect($('camScreen'));
  if (!cv || !view) return [];
  const k = 480 / Math.max(view.sw, view.sh);
  const small = camera.grab(view, Math.round(view.sw * k));
  return findCards(cv, small).map((q) => q.map(([x, y]) => [view.sx + x / k, view.sy + y / k]) as Quad);
}

/** The card's name strip, straightened. Alternates plain / locally-thresholded images. */
function straightenName(q: Quad, n: number): HTMLCanvasElement {
  const box = boxAround(q);
  const scale = Math.min(1, 1600 / Math.max(box.sw, box.sh));
  const crop = camera.grab(box, Math.round(box.sw * scale));
  const local = q.map(([x, y]) => [(x - box.sx) * scale, (y - box.sy) * scale]) as Quad;
  const strip = warpNameStrip(cv, crop, local, n % 2 === 1);
  // Every few frames also try a small tilt, for outlines that are slightly off.
  const tilt = [0, 0, 3, -3][Math.floor(n / 2) % 4];
  return rotated(strip, tilt);
}

async function scanOnce(): Promise<void> {
  if (busy || !camera.running) return;
  busy = true;
  $('lens').classList.add('busy');
  try {
    const n = frameNo++;
    let strip: HTMLCanvasElement | null = null;
    let quad: Quad | null = null;

    // 1. Look for a card anywhere on screen (far away, slanted, not lined up with the frame).
    //    While nothing promising has been read, every 4th frame reads the top of the frame
    //    instead: that path is best for close-ups where the card's edges are out of view.
    if (focus && n > focus.until) focus = null;
    if (cv && (focus || n % 4 !== 3)) {
      const quads = locateCards();
      if (quads.length) {
        quad = pickQuad(quads, n);
        strip = straightenName(quad, n);
      }
      if (lockedId === null) drawQuad(focus ? quad : quads[0] ?? null);
    }
    // 2. Fallback: the name strip at the top of the guide frame, with a little margin.
    if (!strip) {
      const captured = camera.capture($('guide'), { x: -0.03, y: -0.04, w: 1.06, h: 0.24 }, 800, true);
      if (!captured) return;
      strip = rotated(captured, ANGLES[n % ANGLES.length]);
    }
    if (location.hash === '#debug') (window as unknown as { __strip: string }).__strip = strip.toDataURL();
    const lines = await ocr.read(strip);
    const special = detectSpecial(lines);
    // A frame that looks like a Trainer/Energy card doesn't vote for a Pokémon.
    const match = special ? null : matcher.matchLines(lines, settings.cardLang);
    if ((match || special) && quad) focus = { quad, until: n + 8 }; // promising: stay on this card
    const confirmed = voter.push(match);
    const raw = lines.map((l) => l.text).join(' ').slice(0, 60);

    // Showing a Trainer/Energy card: only a near-certain name read may replace it.
    const allowed = lockedId !== -1 || (match !== null && match.id === confirmed && isSureThing(match));
    if (confirmed && allowed) {
      missFrames = 0;
      specialVotes = [];
      if (confirmed !== lockedId) {
        lockedId = confirmed;
        if (quad) drawQuad(quad, true);
        celebrate(confirmed);
      }
      return;
    }
    if (lockedId) return; // keep showing the current card until a new one is found

    specialVotes = [...specialVotes, special].slice(-3).filter(Boolean) as SpecialCard[];
    if (special && specialVotes.filter((x) => x === special).length >= 2) {
      specialVotes = [];
      lockedId = -1;
      $('againBtn').hidden = false;
      beepMiss();
      showSpecial(special);
      revealInfo();
      return;
    }

    // 3. With an API key: if the scanner hasn't got it after a moment, ask the AI automatically.
    const now = Date.now();
    if (settings.aiKey && now - searchingSince > AUTO_AI_AFTER_MS && now - lastAiAt > AUTO_AI_EVERY_MS && (quad || lines.length)) {
      lastAiAt = now;
      void scanWithAi(quad, true);
      return;
    }

    missFrames = match ? 0 : missFrames + 1;
    if (match) setStatus(t('scanning', settings.lang), raw);
    else if (quad) setStatus(t('cardFound', settings.lang), raw);
    else if (missFrames > 6 && lines.length) setStatus(t('hold', settings.lang), raw);
    else setStatus(t('aim', settings.lang), raw);
  } catch (e) {
    console.error(e);
  } finally {
    busy = false;
    $('lens').classList.remove('busy');
  }
}

function loop() {
  if (mode !== 'scanning') return;
  const run = settings.autoScan && !aiBusy && !document.hidden ? scanOnce() : Promise.resolve();
  run.finally(() => setTimeout(loop, 250));
}

async function scanWithAi(quad: Quad | null = null, auto = false) {
  if (aiBusy || !camera.running) return;
  // Send the card found on screen (with some surroundings), or else everything in view.
  if (!quad && !auto) quad = locateCards()[0] ?? null;
  const area = quad ? boxAround(quad) : camera.sourceRect($('camScreen'));
  if (!area) return;
  // Long side 768–1024 px: enough detail for the AI to read the name, small enough to send quickly.
  const long = Math.min(1024, Math.max(768, Math.max(area.sw, area.sh)));
  const card = camera.grab(area, Math.round(long * (area.sw / Math.max(area.sw, area.sh))));
  aiBusy = true;
  $('lens').classList.add('busy');
  setStatus(t('aiThinking', settings.lang));
  try {
    const { identifyWithClaude } = await import('./ai'); // loaded only when AI mode is used
    const r = await identifyWithClaude(settings.aiKey, card);
    if (lockedId !== null && auto) return; // the scanner got there first
    if (r.kind === 'pokemon') {
      let id = r.dex_number && r.dex_number >= 1 && r.dex_number <= dex.species.length ? r.dex_number : null;
      if (r.english_name) {
        const byName = matcher.matchText(r.english_name, 'en');
        if (byName && byName.score >= 0.9) id = byName.id;
      }
      if (id) {
        lockedId = id;
        voter.reset();
        celebrate(id);
        return;
      }
    } else if (r.kind === 'trainer' || r.kind === 'energy') {
      lockedId = -1;
      $('againBtn').hidden = false;
      showSpecial(r.kind);
      revealInfo();
      setStatus(t(r.kind, settings.lang));
      return;
    }
    if (!auto) {
      beepMiss();
      setStatus(t('aiFailed', settings.lang));
    }
  } catch (e) {
    console.error(e);
    if (!auto) beepMiss();
    setStatus(t('aiFailed', settings.lang), e instanceof Error ? e.message : String(e));
  } finally {
    aiBusy = false;
    $('lens').classList.remove('busy');
  }
}

// ---------- Browse ----------

function renderGrid() {
  const q = $<HTMLInputElement>('searchInput').value.trim().toLowerCase();
  const only = $<HTMLInputElement>('onlySeen').checked;
  const L = settings.lang;
  const grid = $('grid');
  grid.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const s of dex.species) {
    if (only && !seen.has(s.id)) continue;
    if (q) {
      const hay = `${s.id} ${s.n.en} ${s.n.ja} ${s.n.zh} ${s.n.zht}`.toLowerCase();
      if (!hay.includes(q) && String(s.id) !== q.replace(/^0+/, '')) continue;
    }
    const b = el('button', seen.has(s.id) ? 'cell seen' : 'cell');
    const im = el('img');
    im.loading = 'lazy';
    im.src = spriteUrl(s.id);
    im.alt = '';
    b.append(im, el('span', '', s.n[L]), el('small', '', `No.${String(s.id).padStart(4, '0')}`));
    b.onclick = () => {
      beepTap();
      $<HTMLDialogElement>('browse').close();
      showEntry(s.id, { announce: true });
      revealInfo();
    };
    frag.append(b);
  }
  grid.append(frag);
}

// ---------- Wiring ----------

function step(delta: number) {
  beepTap();
  const cur = shownId ?? 0;
  let next = cur + delta;
  if (next < 1) next = dex.species.length;
  if (next > dex.species.length) next = 1;
  showEntry(next, { announce: false });
  revealInfo();
}

function wire() {
  $('startBtn').onclick = startScanning;
  $('againBtn').onclick = () => { beepTap(); silence(); resetLock(); };
  $('backCam').onclick = () => {
    beepTap();
    silence();
    hideInfo();
    if (lockedId !== null) resetLock();
  };
  $('scanBtn').onclick = () => {
    if (mode !== 'scanning') return void startScanning();
    beepTap();
    resetLock();
    if (settings.aiKey) scanWithAi();
    else scanOnce();
    lastAiAt = Date.now();
  };
  $('dLeft').onclick = () => step(-1);
  $('dUp').onclick = () => step(-1);
  $('dRight').onclick = () => step(1);
  $('dDown').onclick = () => step(1);

  document.querySelectorAll<HTMLElement>('.lang-key').forEach((k) => {
    k.onclick = () => {
      beepTap();
      settings.lang = k.dataset.lang as Lang;
      save();
      applyTexts();
      if (shownId) showEntry(shownId, { announce: false });
      if ($<HTMLDialogElement>('browse').open) renderGrid();
    };
  });
  $('speakBtn').hidden = !speechSupported;
  $('speakBtn').onclick = () => {
    unlockSpeech();
    if (shownId) speakSoon(entrySpeech(dex.species[shownId - 1], settings.lang), settings.lang, 0);
  };

  const browse = $<HTMLDialogElement>('browse');
  $('browseBtn').onclick = () => { beepTap(); renderGrid(); browse.showModal(); };
  let searchTimer = 0;
  $('searchInput').oninput = () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(renderGrid, 150); };
  $('onlySeen').onchange = renderGrid;

  const dlg = $<HTMLDialogElement>('settings');
  $('settingsBtn').onclick = () => {
    beepTap();
    dlg.querySelectorAll<HTMLInputElement>('input[name=cardLang]').forEach((r) => (r.checked = r.value === settings.cardLang));
    $<HTMLInputElement>('autoScan').checked = settings.autoScan;
    $<HTMLInputElement>('voiceOn').checked = settings.voice;
    fillVoices();
    $<HTMLInputElement>('aiKey').value = settings.aiKey;
    dlg.showModal();
  };
  dlg.querySelectorAll<HTMLInputElement>('input[name=cardLang]').forEach((r) => {
    r.onchange = async () => {
      settings.cardLang = r.value as CardLang;
      save();
      if (mode === 'scanning') {
        setStatus(t('loadingOcr', settings.lang));
        await ocr.prepare(settings.cardLang);
        resetLock();
      }
    };
  });
  $<HTMLInputElement>('autoScan').onchange = (e) => { settings.autoScan = (e.target as HTMLInputElement).checked; save(); };
  $<HTMLInputElement>('voiceOn').onchange = (e) => {
    settings.voice = (e.target as HTMLInputElement).checked;
    if (!settings.voice) silence();
    save();
  };
  $<HTMLSelectElement>('voiceSel').onchange = (e) => {
    settings.voices[settings.lang] = (e.target as HTMLSelectElement).value;
    setVoiceChoice(settings.lang, settings.voices[settings.lang]!);
    save();
  };
  $('voiceTry').onclick = () => {
    unlockSpeech();
    speakSoon(entrySpeech(dex.species[(shownId ?? 25) - 1], settings.lang), settings.lang, 0);
  };
  if (speechSupported) speechSynthesis.addEventListener?.('voiceschanged', fillVoices);
  $<HTMLInputElement>('aiKey').onchange = (e) => {
    settings.aiKey = (e.target as HTMLInputElement).value.trim();
    save();
    applyTexts();
  };
  $('resetSeen').onclick = () => {
    if (!confirm(t('resetConfirm', settings.lang))) return;
    seen.clear();
    saveSeen();
    applyTexts();
  };
  document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
    b.onclick = () => (b.closest('dialog') as HTMLDialogElement).close();
  });
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((d) => {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) silence();
  });
}

/** Fills the voice menu in Settings with the voices for the current language. */
function fillVoices() {
  const sel = $<HTMLSelectElement>('voiceSel');
  const list = listVoices(settings.lang);
  sel.replaceChildren();
  const auto = el('option', '', `${t('voiceAuto', settings.lang)}${list[0] ? ` (${list[0].name})` : ''}`);
  auto.value = '';
  sel.append(auto);
  for (const v of list) {
    const o = el('option', '', `${v.name} · ${v.lang}`);
    o.value = v.voiceURI;
    sel.append(o);
  }
  sel.value = list.some((v) => v.voiceURI === settings.voices[settings.lang]) ? settings.voices[settings.lang]! : '';
  $('voiceRow').hidden = !speechSupported;
}

async function init() {
  if (location.hash === '#debug') Object.assign(window, { __dex: { loadCv, findCards, warpNameStrip, state: () => ({ frameNo, busy, aiBusy, lockedId, focus: !!focus, specialVotes, mode }) } });
  for (const [l, uri] of Object.entries(settings.voices)) if (uri) setVoiceChoice(l as Lang, uri);
  placePanels();
  splitMq.addEventListener('change', placePanels);
  applyTexts();
  wire();
  dex = await loadDex();
  matcher = new NameMatcher(dex.species.map((s) => ({ id: s.id, en: s.n.en, ja: s.n.ja, zhs: s.n.zh, zht: s.n.zht })));
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

init();
