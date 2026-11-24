import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceScore, sentences } from '../src/speech.ts';

const best = (list: { name: string; lang: string; localService?: boolean }[], lang: 'en' | 'zh' | 'ja') =>
  list.map((v) => ({ v, s: voiceScore(v, lang) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.v.name;

test('robotic novelty voices are never chosen', () => {
  const ios = [
    { name: 'Albert', lang: 'en-US' }, { name: 'Eddy (English (US))', lang: 'en-US' }, { name: 'Grandpa (English (US))', lang: 'en-US' },
    { name: 'Zarvox', lang: 'en-US' }, { name: 'Samantha', lang: 'en-US' },
  ];
  assert.equal(best(ios, 'en'), 'Samantha');
  assert.equal(voiceScore({ name: 'Eddy (中文（中国大陆）)', lang: 'zh-CN' }, 'zh'), -1);
});

test('premium / enhanced voices win', () => {
  const list = [
    { name: 'Samantha', lang: 'en-US' }, { name: 'Ava (Premium)', lang: 'en-US' }, { name: 'Zoe (Enhanced)', lang: 'en-US' },
  ];
  assert.equal(best(list, 'en'), 'Ava (Premium)');
  assert.equal(best([{ name: 'Kyoko', lang: 'ja-JP' }, { name: 'Kyoko (Enhanced)', lang: 'ja-JP' }, { name: 'Hattori', lang: 'ja-JP' }], 'ja'), 'Kyoko (Enhanced)');
});

test('Mandarin (zh-CN) is preferred over Cantonese for Chinese', () => {
  const list = [{ name: 'Sinji', lang: 'zh-HK' }, { name: 'Tingting', lang: 'zh-CN' }, { name: 'Meijia', lang: 'zh-TW' }];
  assert.equal(best(list, 'zh'), 'Tingting');
});

test('voices of other languages are ignored', () => {
  assert.equal(voiceScore({ name: 'Kyoko', lang: 'ja-JP' }, 'en'), -1);
});

test('entry text is split into natural sentences', () => {
  assert.deepEqual(sentences('Pikachu. The Mouse Pokémon. It can grow to 4,600 feet. Mr. Mime is a friend.'),
    ['Pikachu.', 'The Mouse Pokémon.', 'It can grow to 4,600 feet.', 'Mr. Mime is a friend.']);
  assert.deepEqual(sentences('脸颊两边有着小小的电力袋。遇到危险时就会放电。'), ['脸颊两边有着小小的电力袋。', '遇到危险时就会放电。']);
  assert.deepEqual(sentences('ほっぺたの　でんきぶくろを　もつ。'), ['ほっぺたの でんきぶくろを もつ。']);
});
