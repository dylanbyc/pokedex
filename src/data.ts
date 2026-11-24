// Loads the bundled Pokédex data (built by scripts/build-data.mjs).

export type Lang = 'zh' | 'en' | 'ja';
export type Text3 = { en: string; ja: string; zh: string };

export interface Species {
  id: number;
  n: Text3 & { zht: string };
  g: Text3; // genus, e.g. "Mouse Pokémon"
  f: Text3; // Pokédex entry text
  t: number[]; // type ids
  a: number[]; // ability ids, negative = hidden ability
  h: number; // height in decimetres
  w: number; // weight in hectograms
  s: number[]; // base stats: hp, atk, def, spa, spd, spe
  gen: number;
  leg: 0 | 1 | 2; // 1 legendary, 2 mythical
  evo: [number, number][]; // [species id, evolves-from id]
}

export interface Dex {
  types: Record<string, Text3>;
  abilities: Record<string, { n: Text3; d: Text3 }>;
  species: Species[];
}

let cache: Promise<Dex> | null = null;

export function loadDex(): Promise<Dex> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/pokedex.json`).then((r) => {
    if (!r.ok) throw new Error(`pokedex.json: HTTP ${r.status}`);
    return r.json();
  });
  return cache;
}

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
export const artworkUrl = (id: number) => `${SPRITES}/other/official-artwork/${id}.png`;
export const spriteUrl = (id: number) => `${SPRITES}/${id}.png`;

// Type colours (PokeAPI type ids).
export const TYPE_COLORS: Record<number, string> = {
  1: '#9fa19f', 2: '#ff8000', 3: '#81b9ef', 4: '#9141cb', 5: '#915121', 6: '#afa981',
  7: '#91a119', 8: '#704170', 9: '#60a1b8', 10: '#e62829', 11: '#2980ef', 12: '#3fa129',
  13: '#fac000', 14: '#ef4179', 15: '#3dcef3', 16: '#5060e1', 17: '#624d4e', 18: '#ef70ef',
  19: '#68a090',
};
