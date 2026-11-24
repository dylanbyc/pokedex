// Live rear-camera preview and frame capture.

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get running(): boolean {
    return !!this.stream && this.video.readyState >= 2;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        // As many pixels as the camera offers (up to 4K): cards far away stay readable.
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    // Ask for continuous autofocus where the browser supports it.
    const track = this.stream.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[] };
    if (caps.focusMode?.includes('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** How the video (object-fit: cover) is laid out inside `el`: scale and offset in CSS px. */
  private layout(el: HTMLElement) {
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    return {
      vw, vh, scale, vr,
      offX: (vr.width - vw * scale) / 2,
      offY: (vr.height - vh * scale) / 2,
      er: el.getBoundingClientRect(),
    };
  }

  /** The part of the frame under `el` (or a sub-box of it, in fractions), in video pixels. */
  sourceRect(el: HTMLElement, region = { x: 0, y: 0, w: 1, h: 1 }): Rect | null {
    const L = this.layout(el);
    if (!L) return null;
    const x0 = L.er.left - L.vr.left + region.x * L.er.width;
    const y0 = L.er.top - L.vr.top + region.y * L.er.height;
    let sx = (x0 - L.offX) / L.scale;
    let sy = (y0 - L.offY) / L.scale;
    let sw = (region.w * L.er.width) / L.scale;
    let sh = (region.h * L.er.height) / L.scale;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(L.vw - sx, sw); sh = Math.min(L.vh - sy, sh);
    if (sw < 10 || sh < 10) return null;
    return { sx, sy, sw, sh };
  }

  /** Video pixel → CSS pixel position inside `el`. */
  toElement(el: HTMLElement, x: number, y: number): [number, number] {
    const L = this.layout(el);
    if (!L) return [0, 0];
    return [x * L.scale + L.offX + L.vr.left - L.er.left, y * L.scale + L.offY + L.vr.top - L.er.top];
  }

  /** Copies a rectangle of the current frame into a canvas `outWidth` pixels wide. */
  grab(r: Rect, outWidth: number, grayscale = false): HTMLCanvasElement {
    const k = outWidth / r.sw;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.sw * k));
    c.height = Math.max(1, Math.round(r.sh * k));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    if (grayscale) ctx.filter = 'grayscale(1) contrast(1.2)';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.video, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    return c;
  }

  /**
   * Copies the part of the current frame under `el` into a canvas.
   * `region` selects a sub-box of the element in fractions (0..1).
   */
  capture(
    el: HTMLElement,
    region = { x: 0, y: 0, w: 1, h: 1 },
    targetWidth = 1200,
    grayscale = false,
  ): HTMLCanvasElement | null {
    const r = this.sourceRect(el, region);
    return r ? this.grab(r, targetWidth, grayscale) : null;
  }
}

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Returns a copy of `src` rotated by `deg` degrees around its centre (same size). */
export function rotated(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  if (!deg) return src;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -c.width / 2, -c.height / 2);
  return c;
}
