#!/usr/bin/env node
// Builds public/data/pokedex.json from the open PokeAPI CSV data
// (https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv).
//
// Usage: node scripts/build-data.mjs [csvCacheDir]
// CSV files are downloaded into the cache dir when they are not there yet.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cacheDir = path.resolve(process.argv[2] || path.join(root, '.csv-cache'));
const outFile = path.join(root, 'public', 'data', 'pokedex.json');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';

// PokeAPI language ids
const L = { jaKana: 1, zhHant: 4, en: 9, ja: 11, zhHans: 12 };

const FILES = [
  'pokemon_species', 'pokemon_species_names', 'pokemon_species_flavor_text',
  'pokemon', 'pokemon_types', 'pokemon_stats', 'pokemon_abilities',
  'ability_names', 'ability_flavor_text', 'type_names',
];

async function load(name) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${name}.csv`);
  if (!fs.existsSync(file)) {
    console.log(`downloading ${name}.csv`);
    const res = await fetch(`${BASE}/${name}.csv`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

// Minimal RFC 4180 CSV parser (handles quoted fields with commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function cleanText(s, lang) {
  if (!s) return '';
  s = s.replace(/\u00ad\n/g, '').replace(/\u00ad/g, '').replace(/\f/g, '\n');
  if (lang === L.jaKana || lang === L.ja) {
    // Japanese game text uses (full-width) spaces as word breaks.
    s = s.replace(/[ \u3000]*\n[ \u3000]*/g, '\u3000');
  } else if (lang === L.zhHans || lang === L.zhHant) {
    s = s.replace(/\s*\n\s*/g, '').replace(/([，。！？、；：])\s+/g, '$1');
  } else {
    s = s.replace(/\s*\n\s*/g, ' ');
  }
  return s.replace(/ {2,}/g, ' ').trim();
}

// Keep the entry with the highest version for each (key, language).
function latestBy(rows, keyCol, verCol, langCol, textCol) {
  const out = new Map();
  for (const r of rows) {
    const k = `${r[keyCol]}|${r[langCol]}`;
    const v = Number(r[verCol]);
    const prev = out.get(k);
    if (!prev || v > prev.v) out.set(k, { v, text: cleanText(r[textCol], Number(r[langCol])) });
  }
  return (key, lang) => out.get(`${key}|${lang}`)?.text || '';
}

const [species, names, flavor, pokemon, ptypes, pstats, pabil, abNames, abFlavor, typeNames] =
  await Promise.all(FILES.map(load));

const nameOf = new Map();
for (const r of names) nameOf.set(`${r.pokemon_species_id}|${r.local_language_id}`, r);
const n = (id, lang) => nameOf.get(`${id}|${lang}`)?.name || '';
const g = (id, lang) => nameOf.get(`${id}|${lang}`)?.genus || '';

const flav = latestBy(flavor, 'species_id', 'version_id', 'language_id', 'flavor_text');
const abFlav = latestBy(abFlavor, 'ability_id', 'version_group_id', 'language_id', 'flavor_text');

const defaultPokemon = new Map(); // species_id -> pokemon row
for (const p of pokemon) if (p.is_default === '1') defaultPokemon.set(p.species_id, p);

const typesOf = new Map();
for (const r of ptypes) {
  if (!typesOf.has(r.pokemon_id)) typesOf.set(r.pokemon_id, []);
  typesOf.get(r.pokemon_id)[Number(r.slot) - 1] = Number(r.type_id);
}
const statsOf = new Map();
for (const r of pstats) {
  if (!statsOf.has(r.pokemon_id)) statsOf.set(r.pokemon_id, []);
  statsOf.get(r.pokemon_id)[Number(r.stat_id) - 1] = Number(r.base_stat);
}
const abilOf = new Map();
for (const r of pabil) {
  if (!abilOf.has(r.pokemon_id)) abilOf.set(r.pokemon_id, []);
  abilOf.get(r.pokemon_id).push({ id: Number(r.ability_id), hidden: r.is_hidden === '1', slot: Number(r.slot) });
}

const chainMembers = new Map();
for (const s of species) {
  if (!chainMembers.has(s.evolution_chain_id)) chainMembers.set(s.evolution_chain_id, []);
  chainMembers.get(s.evolution_chain_id).push(s);
}

const usedAbilities = new Set();
const usedTypes = new Set();
const out = [];
for (const s of species.sort((a, b) => a.id - b.id)) {
  const id = Number(s.id);
  const p = defaultPokemon.get(s.id);
  const t = typesOf.get(p.id).filter(Boolean);
  t.forEach((x) => usedTypes.add(x));
  const a = (abilOf.get(p.id) || []).sort((x, y) => x.slot - y.slot);
  a.forEach((x) => usedAbilities.add(x.id));

  // Evolution family, ordered so that each species follows the one it evolves from.
  const fam = chainMembers.get(s.evolution_chain_id) || [s];
  const depth = (sp) => {
    let d = 0, cur = sp;
    while (cur.evolves_from_species_id) {
      cur = fam.find((x) => x.id === cur.evolves_from_species_id) || {};
      d++;
    }
    return d;
  };
  const evo = fam
    .map((x) => ({ id: Number(x.id), d: depth(x), from: Number(x.evolves_from_species_id) || 0 }))
    .sort((x, y) => x.d - y.d || x.id - y.id);

  out.push({
    id,
    n: {
      en: n(id, L.en),
      ja: n(id, L.jaKana) || n(id, L.ja),
      zh: n(id, L.zhHans) || n(id, L.zhHant),
      zht: n(id, L.zhHant) || n(id, L.zhHans),
    },
    g: {
      en: g(id, L.en),
      ja: g(id, L.jaKana) || g(id, L.ja),
      zh: g(id, L.zhHans) || g(id, L.zhHant),
    },
    f: {
      en: flav(id, L.en),
      ja: flav(id, L.jaKana) || flav(id, L.ja),
      zh: flav(id, L.zhHans) || flav(id, L.zhHant),
    },
    t,
    a: a.map((x) => (x.hidden ? -x.id : x.id)), // negative id = hidden ability
    h: Number(p.height), // decimetres
    w: Number(p.weight), // hectograms
    s: statsOf.get(p.id),
    gen: Number(s.generation_id),
    leg: s.is_legendary === '1' ? 1 : s.is_mythical === '1' ? 2 : 0,
    evo: evo.length > 1 ? evo.map((x) => [x.id, x.from]) : [],
  });
}

const tname = (id, lang) => typeNames.find((r) => r.type_id === String(id) && r.local_language_id === String(lang))?.name || '';
const types = {};
for (const id of [...usedTypes].sort((x, y) => x - y)) {
  types[id] = { en: tname(id, L.en), ja: tname(id, L.jaKana) || tname(id, L.ja), zh: tname(id, L.zhHans) || tname(id, L.zhHant) };
}

const abName = new Map();
for (const r of abNames) abName.set(`${r.ability_id}|${r.local_language_id}`, r.name);
const an = (id, lang) => abName.get(`${id}|${lang}`) || '';
const abilities = {};
for (const id of [...usedAbilities].sort((x, y) => x - y)) {
  abilities[id] = {
    n: { en: an(id, L.en), ja: an(id, L.jaKana) || an(id, L.ja), zh: an(id, L.zhHans) || an(id, L.zhHant) },
    d: { en: abFlav(id, L.en), ja: abFlav(id, L.jaKana) || abFlav(id, L.ja), zh: abFlav(id, L.zhHans) || abFlav(id, L.zhHant) },
  };
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ types, abilities, species: out }));
const missing = (k, l) => out.filter((s) => !s[k][l]).length;
console.log(`wrote ${out.length} species to ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
console.log('missing flavor:', { en: missing('f', 'en'), ja: missing('f', 'ja'), zh: missing('f', 'zh') });
console.log('missing names:', { en: missing('n', 'en'), ja: missing('n', 'ja'), zh: missing('n', 'zh') });
