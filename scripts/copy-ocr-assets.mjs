#!/usr/bin/env node
// Copies the Tesseract.js worker, WebAssembly core and language data from
// node_modules into public/ocr so the app serves them itself (no CDN).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'ocr');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};

copy(path.join(nm, 'tesseract.js/dist/worker.min.js'), path.join(out, 'worker.min.js'));

// Tesseract.js picks the fastest build the device supports from this folder.
for (const f of fs.readdirSync(path.join(nm, 'tesseract.js-core'))) {
  if (/^tesseract-core.*\.wasm\.js$/.test(f)) copy(path.join(nm, 'tesseract.js-core', f), path.join(out, 'core', f));
}

// "best_int" models: small (2–3 MB each) and accurate enough for card names.
for (const lang of ['eng', 'jpn', 'chi_sim', 'chi_tra']) {
  copy(
    path.join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
    path.join(out, 'lang', `${lang}.traineddata.gz`),
  );
}
// OpenCV.js finds and straightens cards in the camera image (loaded on demand).
copy(path.join(nm, '@techstark/opencv-js/dist/opencv.js'), path.join(root, 'public', 'cv', 'opencv.js'));

console.log('OCR and OpenCV assets copied to public/');
