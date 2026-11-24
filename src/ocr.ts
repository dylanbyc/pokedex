// On-device text recognition with Tesseract.js. All engine files are served
// from this site (copied to public/ocr by scripts/copy-ocr-assets.mjs), so
// scanning needs no third-party CDN.

import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { CardLang, OcrLine } from './match';

const TESS_LANG: Record<CardLang, string> = { en: 'eng', ja: 'jpn', zhs: 'chi_sim', zht: 'chi_tra' };

const abs = (p: string) => new URL(`${import.meta.env.BASE_URL}${p}`, location.href).href;

export class Ocr {
  private worker: Promise<Worker> | null = null;
  private lang: CardLang | null = null;

  /** Starts (or switches) the engine for the given card language. */
  async prepare(lang: CardLang): Promise<void> {
    if (this.worker && this.lang === lang) {
      await this.worker;
      return;
    }
    const old = this.worker;
    this.lang = lang;
    this.worker = (async () => {
      if (old) (await old).terminate();
      const w = await createWorker(TESS_LANG[lang], 1, {
        workerPath: abs('ocr/worker.min.js'),
        corePath: abs('ocr/core'),
        langPath: abs('ocr/lang'),
      });
      // Sparse text mode: card names sit among scattered labels (HP, stage, icons).
      await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return w;
    })();
    this.worker.catch(() => {
      this.worker = null;
      this.lang = null;
    });
    await this.worker;
  }

  async read(image: HTMLCanvasElement): Promise<OcrLine[]> {
    if (!this.worker) throw new Error('OCR not prepared');
    const w = await this.worker;
    const { data } = await w.recognize(image, {}, { blocks: true, text: false });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs) {
        for (const l of p.lines) {
          const text = l.text.trim();
          if (text) lines.push({ text, height: l.bbox.y1 - l.bbox.y0 });
        }
      }
    }
    return lines;
  }
}
