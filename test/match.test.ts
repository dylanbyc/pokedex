import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NameMatcher, Voter, detectSpecial } from '../src/match.ts';

const dex = JSON.parse(fs.readFileSync(new URL('../public/data/pokedex.json', import.meta.url), 'utf8'));
const m = new NameMatcher(dex.species.map((s: any) => ({ id: s.id, en: s.n.en, ja: s.n.ja, zhs: s.n.zh, zht: s.n.zht })));
const id = (text: string, lang: 'en' | 'ja' | 'zhs' | 'zht' = 'en') =>
  m.matchLines([{ text, height: 40 }], lang)?.id ?? null;

test('real OCR output from the card photo', () => {
  assert.equal(id('Pikach,,'), 25);
  assert.equal(id('Eevee'), 133);
  assert.equal(id('Solrockiir'), 338);
  assert.equal(id('} Phanturmp'), 708);
  assert.equal(id('v 4 Orifolim'), 426);
  assert.equal(id('De Iph Ox'), 655);
  assert.equal(id('Maw V4'), 151); // Mew V
  assert.equal(id('Pawmi'), 921);
  assert.equal(id('Lapras'), 131);
});

test('short names need an exact read', () => {
  assert.equal(id('Mew'), 151);
  assert.equal(id('Maw'), null);
});

test('card suffixes and special characters', () => {
  assert.equal(id('Charizard ex'), 6);
  assert.equal(id('Mr. Mime'), 122);
  assert.equal(id("Farfetch'd"), 83);
  assert.equal(id('Flabébé'), 669);
});

test('Japanese and Chinese names', () => {
  assert.equal(id('たね ピカチュウ HP60', 'ja'), 25);
  assert.equal(id('リザ一ドン', 'ja'), 6); // 一 misread for ー
  assert.equal(id('基础 皮卡丘 HP 60', 'zhs'), 25);
  assert.equal(id('噴火龍', 'zht'), 6);
  assert.equal(id('喷火龙ex', 'zhs'), 6);
});

test('the big name beats "Evolves from" text', () => {
  const r = m.matchLines([
    { text: 'Charmeleon', height: 40 },
    { text: 'Evolves from Charmander', height: 14 },
  ], 'en');
  assert.equal(r?.id, 5);
});

test('trainer and energy cards', () => {
  assert.equal(detectSpecial([{ text: "Rosa's Encouragement", height: 30 }]), 'trainer');
  assert.equal(detectSpecial([{ text: 'TRAINER', height: 30 }]), 'trainer');
  assert.equal(detectSpecial([{ text: 'ENERGY', height: 30 }]), 'energy');
  assert.equal(detectSpecial([{ text: 'Pikachu HP 60', height: 30 }]), null);
});

test('voter needs agreement across frames', () => {
  const v = new Voter(6, 1.5);
  assert.equal(v.push({ id: 25, score: 0.9, text: '' }), null);
  assert.equal(v.push(null), null);
  assert.equal(v.push({ id: 25, score: 0.9, text: '' }), 25);
});
