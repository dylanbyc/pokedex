// Finds Pokémon cards in a camera frame and straightens them, so cards can be
// scanned from far away and at a slant (a card lying on a table, photographed
// from above at an angle). Uses OpenCV.js, served from this site and loaded
// only when scanning starts.
//
// Pipeline (same as the prototype it was tuned with):
//   frame → small grey image → Canny edges at a few blur levels → contours →
//   convex hull → 4-corner polygon → keep card-shaped, central quads whose
//   sides really lie on edges → warp the top of the card (the name) flat.

/* eslint-disable @typescript-eslint/no-explicit-any */
type CV = any;

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // top-left, top-right, bottom-right, bottom-left

let cvPromise: Promise<{ cv: CV }> | null = null;

/** Loads OpenCV.js once. Resolves to null if it can't load (scanning then falls back). */
export async function loadCv(): Promise<CV | null> {
  // The OpenCV module has its own `then`; handing it straight to a Promise makes the
  // Promise unwrap it forever and hang the page. So it travels wrapped in { cv }.
  cvPromise ??= new Promise<{ cv: CV }>((resolve, reject) => {
    const w = window as any;
    const ready = (m: any) => {
      if (m && m.Mat) {
        delete m.then; // see above: a module that is "thenable" can never be returned from a Promise
        resolve({ cv: m });
      }
      else if (m && typeof m.then === 'function') m.then((x: any) => ready(x));
      else if (m) m.onRuntimeInitialized = () => ready(m);
    };
    const s = document.createElement('script');
    s.src = new URL(`${import.meta.env.BASE_URL}cv/opencv.js`, location.href).href;
    s.async = true;
    s.onload = () => ready(w.cv);
    s.onerror = () => reject(new Error('opencv.js failed to load'));
    document.head.append(s);
  });
  try {
    return (await cvPromise).cv;
  } catch (e) {
    console.warn(e);
    cvPromise = null;
    return null;
  }
}

const CARD_RATIO = 88 / 63;

function order(pts: Pt[]): Quad {
  const cx = pts.reduce((a, p) => a + p[0], 0) / 4;
  const cy = pts.reduce((a, p) => a + p[1], 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polyArea(q: Pt[]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % q.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Fraction of points along the quad's sides that sit on an edge pixel. */
function edgeSupport(edges: Uint8Array, w: number, h: number, q: Quad): number {
  let hits = 0, total = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    for (let k = 0; k < 24; k++) {
      const t = 0.08 + (0.84 * k) / 23;
      const x = Math.round(a[0] + (b[0] - a[0]) * t);
      const y = Math.round(a[1] + (b[1] - a[1]) * t);
      total++;
      if (x >= 0 && x < w && y >= 0 && y < h && edges[y * w + x]) hits++;
    }
  }
  return hits / total;
}

function median(data: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= data.length / 2) return v;
  }
  return 128;
}

/**
 * Card-shaped quadrilaterals in `img` (a small canvas, ~480 px), best first.
 * Coordinates are in `img` pixels.
 */
export function findCards(cv: CV, img: HTMLCanvasElement, max = 3): Quad[] {
  const sw = img.width, sh = img.height;
  const frameArea = sw * sh;
  const src = cv.imread(img);
  const gray0 = new cv.Mat();
  cv.cvtColor(src, gray0, cv.COLOR_RGBA2GRAY);
  src.delete();
  const k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  const k5 = cv.Mat.ones(5, 5, cv.CV_8U);
  const cands: { score: number; q: Quad }[] = [];

  for (const blur of [5, 9, 13]) {
    const gray = new cv.Mat();
    cv.GaussianBlur(gray0, gray, new cv.Size(blur, blur), 0);
    const v = median(gray.data);
    for (const [lo, hi] of [[0.66, 1.33], [0.4, 1.0]]) {
      const edges = new cv.Mat();
      cv.Canny(gray, edges, Math.round(lo * v), Math.round(Math.min(255, hi * v)));
      const ed = new cv.Mat();
      cv.dilate(edges, ed, k3);
      const ed2 = new cv.Mat();
      cv.dilate(edges, ed2, k5);
      const edData: Uint8Array = ed2.data;
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(ed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const hull = new cv.Mat();
        cv.convexHull(c, hull, false, true);
        c.delete();
        const harea = cv.contourArea(hull);
        if (harea < 0.012 * frameArea || harea > 0.85 * frameArea) {
          hull.delete();
          continue;
        }
        const peri = cv.arcLength(hull, true);
        for (const eps of [0.02, 0.035, 0.05, 0.07]) {
          const ap = new cv.Mat();
          cv.approxPolyDP(hull, ap, eps * peri, true);
          const ok = ap.rows === 4 && cv.isContourConvex(ap);
          const d: Int32Array = ap.data32S;
          ap.delete();
          if (!ok) continue;
          const q = order([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]);
          const sides = [0, 1, 2, 3].map((j) => dist(q[j], q[(j + 1) % 4]));
          if (Math.min(...sides) < 0.25 * Math.max(...sides)) continue;
          const wq = (sides[0] + sides[2]) / 2, hq = (sides[1] + sides[3]) / 2;
          const ratio = Math.min(wq, hq) / Math.max(wq, hq);
          if (ratio < 0.35 || ratio > 0.95) continue;
          const cx = q.reduce((a, p) => a + p[0], 0) / 4 / sw;
          const cy = q.reduce((a, p) => a + p[1], 0) / 4 / sh;
          if (cx < 0.1 || cx > 0.9 || cy < 0.1 || cy > 0.9) continue;
          const sup = edgeSupport(edData, sw, sh, q);
          if (sup < 0.6) continue;
          const centre = Math.hypot(cx - 0.5, cy - 0.5);
          cands.push({ score: polyArea(q) * Math.max(0.15, 1 - 1.6 * centre) * sup ** 3, q });
          break;
        }
        hull.delete();
      }
      contours.delete();
      hierarchy.delete();
      edges.delete();
      ed.delete();
      ed2.delete();
    }
    gray.delete();
  }
  gray0.delete();
  k3.delete();
  k5.delete();

  cands.sort((a, b) => b.score - a.score);
  const keep: Quad[] = [];
  for (const { q } of cands) {
    if (keep.every((k) => k.some((p, j) => Math.abs(p[0] - q[j][0]) > 10 || Math.abs(p[1] - q[j][1]) > 10))) keep.push(q);
    if (keep.length >= max) break;
  }
  return keep;
}

/** Grows a quad around its centre so slightly-off corners don't cut off the name. */
export function padQuad(q: Quad, pad = 0.04): Quad {
  const cx = q.reduce((a, p) => a + p[0], 0) / 4;
  const cy = q.reduce((a, p) => a + p[1], 0) / 4;
  return q.map(([x, y]) => [cx + (x - cx) * (1 + pad), cy + (y - cy) * (1 + pad)]) as Quad;
}

/**
 * Straightens the top of the card (where its name is) into a flat grey image.
 * `src` holds the camera pixels, `q` the card corners in `src` pixels.
 * `adaptive` binarises with a local threshold, which reads names on gradient
 * backgrounds that the plain image misses (and vice versa), so scans alternate.
 */
export function warpNameStrip(cv: CV, src: HTMLCanvasElement, q: Quad, adaptive: boolean): HTMLCanvasElement {
  const outW = adaptive ? 1260 : 630;
  const cardH = outW * CARD_RATIO;
  const stripH = Math.round(cardH * 0.17);
  const p = padQuad(q);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, p.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, cardH, 0, cardH]);
  const M = cv.getPerspectiveTransform(from, to);
  const img = cv.imread(src);
  const warped = new cv.Mat();
  cv.warpPerspective(img, warped, M, new cv.Size(outW, stripH), cv.INTER_CUBIC, cv.BORDER_CONSTANT, new cv.Scalar(128, 128, 128, 255));
  const gray = new cv.Mat();
  cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
  if (adaptive) {
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);
    cv.adaptiveThreshold(blurred, gray, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 41, 12);
    blurred.delete();
  }
  const out = document.createElement('canvas');
  cv.imshow(out, gray);
  [from, to, M, img, warped, gray].forEach((m) => m.delete());
  return out;
}
