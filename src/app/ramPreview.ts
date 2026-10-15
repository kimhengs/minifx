// Frame cache for RAM preview. Frames are stored as ImageBitmaps of the viewer
// canvas, keyed by frame index, and dropped whenever the project or view changes.
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { play } from "./playback";

const frames = new Map<number, ImageBitmap>();
let signature = "";
let bytes = 0;
let prerender: ((onProgress: (done: number, total: number) => void, shouldStop: () => boolean) => Promise<void>) | null = null;
let busy = false;

function publish(): void {
  useUi.getState().set({ cachedFrames: new Set(frames.keys()) });
}

export const frameCache = {
  validate(sig: string): void {
    if (sig === signature) return;
    signature = sig;
    this.clear();
  },
  get(frame: number): ImageBitmap | undefined {
    return frames.get(frame);
  },
  has(frame: number): boolean {
    return frames.has(frame);
  },
  canStore(w: number, h: number): boolean {
    return bytes + w * h * 4 <= useSettings.getState().cacheMB * 1024 * 1024;
  },
  put(frame: number, bmp: ImageBitmap): void {
    if (frames.has(frame)) {
      bmp.close();
      return;
    }
    frames.set(frame, bmp);
    bytes += bmp.width * bmp.height * 4;
    if (frames.size % 4 === 0) publish();
  },
  clear(): void {
    for (const b of frames.values()) b.close();
    frames.clear();
    bytes = 0;
    publish();
  },
  bytes(): number {
    return bytes;
  },
  count(): number {
    return frames.size;
  },
  flush(): void {
    publish();
  },
};

export function registerPrerender(fn: typeof prerender): void {
  prerender = fn;
}

export async function ramPreview(): Promise<void> {
  if (busy || !prerender) return;
  busy = true;
  const ui = useUi.getState();
  ui.set({ playing: false });
  try {
    await prerender(
      (done, total) => {
        if (done === total || done % 10 === 0) useUi.getState().set({ cachedFrames: new Set(frames.keys()) });
      },
      () => useUi.getState().playing,
    );
  } finally {
    busy = false;
  }
  play(1);
}
