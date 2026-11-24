// Optional card recognition with Claude vision. Used only when the parent has
// entered their own Claude API key in Settings; the key stays on the device.

import Anthropic from '@anthropic-ai/sdk';

export interface AiResult {
  kind: 'pokemon' | 'trainer' | 'energy' | 'unknown';
  dex_number: number | null;
  english_name: string | null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['pokemon', 'trainer', 'energy', 'unknown'] },
    dex_number: { type: ['integer', 'null'], description: 'National Pokédex number of the Pokémon on the card' },
    english_name: { type: ['string', 'null'], description: 'English species name, without card suffixes like V, ex, VMAX' },
  },
  required: ['kind', 'dex_number', 'english_name'],
  additionalProperties: false,
};

const PROMPT =
  'This is a photo of a Pokémon Trading Card Game card held up to a camera. ' +
  'The card may be in English, Japanese or Chinese. Identify which Pokémon species the card shows. ' +
  'Use the printed card name first, then the artwork. Regional forms and card suffixes (V, VMAX, VSTAR, ex, GX, Radiant, Alolan…) ' +
  'should map to the base species. If it is a Trainer or Energy card, say so. ' +
  'If you cannot tell, answer kind "unknown".';

export async function identifyWithClaude(apiKey: string, card: HTMLCanvasElement): Promise<AiResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const data = card.toDataURL('image/jpeg', 0.85).split(',')[1];
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') return { kind: 'unknown', dex_number: null, english_name: null };
  for (const block of response.content) {
    if (block.type === 'text') return JSON.parse(block.text) as AiResult;
  }
  return { kind: 'unknown', dex_number: null, english_name: null };
}
