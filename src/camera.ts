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
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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

  /**
   * Copies the part of the current frame under `el` (an element laid over the
   * video) into a canvas. The video uses object-fit: cover, so the element's
   * on-screen box is mapped back into video pixels.
   * `region` selects a sub-box of the element in fractions (0..1).
   */
  capture(
    el: HTMLElement,
    region = { x: 0, y: 0, w: 1, h: 1 },
    targetWidth = 1200,
    grayscale = false,
  ): HTMLCanvasElement | null {
    const v = this.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return null;
    const vr = v.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh);
    const offX = (vr.width - vw * scale) / 2;
    const offY = (vr.height - vh * scale) / 2;

    const x0 = er.left - vr.left + region.x * er.width;
    const y0 = er.top - vr.top + region.y * er.height;
    let sx = (x0 - offX) / scale;
    let sy = (y0 - offY) / scale;
    let sw = (region.w * er.width) / scale;
    let sh = (region.h * er.height) / scale;
    // Clamp to the frame.
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    if (sw < 10 || sh < 10) return null;

    const k = targetWidth / sw;
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k);
    c.height = Math.round(sh * k);
    const ctx = c.getContext('2d', { willReadFrequently: grayscale })!;
    if (grayscale) ctx.filter = 'grayscale(1) contrast(1.2)';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
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
