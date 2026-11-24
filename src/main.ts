import './style.css';
import { loadDex, artworkUrl, spriteUrl, TYPE_COLORS, type Dex, type Lang, type Species } from './data';
import { t, statLabels, type Key } from './i18n';
import { NameMatcher, Voter, detectSpecial, type CardLang, type SpecialCard } from './match';
import { Camera, rotated } from './camera';
import { Ocr } from './ocr';
import { speak, stopSpeaking, unlockSpeech, speechSupported } from './speech';
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
};
const save = () => {
  setItem('dex.lang', settings.lang);
  setItem('dex.cardLang', settings.cardLang);
  setItem('dex.autoScan', settings.autoScan);
  setItem('dex.voice', settings.voice);
  setItem('dex.aiKey', settings.aiKey);
};

const seen = new Set<number>(getItem<number[]>('dex.seen', []));
const saveSeen = () => setItem('dex.seen', [...seen]);

let dex: Dex;
let matcher: NameMatcher;
const camera = new Camera($<HTMLVideoElement>('video'));
const ocr = new Ocr();
const voter = new Voter(6, 1.5);
// Cards are rarely held perfectly straight; successive frames try slightly different angles.
const ANGLES = [0, 5, -5];
let frameNo = 0;
let specialVotes: SpecialCard[] = [];

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

function entrySpeech(s: Species, lang: Lang): string {
  const name = s.n[lang], genus = s.g[lang] || s.g.en;
  const flavor = s.f[lang] || s.f.en;
  if (lang === 'en') return `${name}. The ${genus}. ${flavor}`;
  if (lang === 'ja') return `${name}。${genus}。${flavor.replace(/　/g, ' ')}`;
  return `${name}，${genus}。${flavor}`;
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
  if (opts.announce && settings.voice) speak(entrySpeech(s, L), L);
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
  if (settings.voice) speak(t(kind, settings.lang), settings.lang);
}

function revealInfo() {
  // On stacked (phone / portrait) layouts, bring the entry into view.
  if (!matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)').matches) {
    $('rightHalf').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
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
    await ocr.prepare(settings.cardLang);
  } finally {
    $('device').querySelector('.leds')!.classList.remove('blink');
  }
  setStatus(t('aim', settings.lang));
  loop();
}

async function scanOnce(): Promise<void> {
  if (busy || !camera.running) return;
  busy = true;
  $('lens').classList.add('busy');
  try {
    // The name strip at the top of the card, with a little margin for wobbly hands.
    const captured = camera.capture($('guide'), { x: -0.03, y: -0.04, w: 1.06, h: 0.24 }, 800, true);
    if (!captured) return;
    const strip = rotated(captured, ANGLES[frameNo++ % ANGLES.length]);
    if (location.hash === '#debug') (window as unknown as { __strip: string }).__strip = strip.toDataURL();
    const lines = await ocr.read(strip);
    const match = matcher.matchLines(lines, settings.cardLang);
    const confirmed = voter.push(match);
    const raw = lines.map((l) => l.text).join(' ').slice(0, 60);

    if (confirmed) {
      missFrames = 0;
      specialVotes = [];
      if (confirmed !== lockedId) {
        lockedId = confirmed;
        celebrate(confirmed);
      }
      return;
    }
    if (lockedId) return; // keep showing the current card until a new one is found

    const special = detectSpecial(lines);
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
    missFrames = match ? 0 : missFrames + 1;
    if (match) setStatus(t('scanning', settings.lang), raw);
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

async function scanWithAi() {
  if (aiBusy || !camera.running) return;
  const card = camera.capture($('guide'), { x: -0.04, y: -0.03, w: 1.08, h: 1.06 }, 900);
  if (!card) return;
  aiBusy = true;
  $('lens').classList.add('busy');
  setStatus(t('aiThinking', settings.lang));
  try {
    const { identifyWithClaude } = await import('./ai'); // loaded only when AI mode is used
    const r = await identifyWithClaude(settings.aiKey, card);
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
    beepMiss();
    setStatus(t('aiFailed', settings.lang));
  } catch (e) {
    console.error(e);
    beepMiss();
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
}

function wire() {
  $('startBtn').onclick = startScanning;
  $('againBtn').onclick = () => { beepTap(); stopSpeaking(); resetLock(); };
  $('scanBtn').onclick = () => {
    if (mode !== 'scanning') return void startScanning();
    beepTap();
    resetLock();
    if (settings.aiKey) scanWithAi();
    else scanOnce();
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
    if (shownId) speak(entrySpeech(dex.species[shownId - 1], settings.lang), settings.lang);
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
    if (!settings.voice) stopSpeaking();
    save();
  };
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
    if (document.hidden) stopSpeaking();
  });
}

async function init() {
  applyTexts();
  wire();
  dex = await loadDex();
  matcher = new NameMatcher(dex.species.map((s) => ({ id: s.id, en: s.n.en, ja: s.n.ja, zhs: s.n.zh, zht: s.n.zht })));
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
}

init();
