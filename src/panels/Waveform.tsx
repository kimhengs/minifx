import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import type { Layer, MediaItem } from "../engine/types";

const cache = new Map<string, Promise<number[]>>();

function peaksFor(m: MediaItem): Promise<number[]> {
  let p = cache.get(m.id);
  if (!p) {
    // ~20 peaks per second, generated in Rust off the UI thread
    p = backend.waveform(m.path, Math.max(64, Math.min(20000, Math.round(m.duration * 20)))).catch(() => []);
    cache.set(m.id, p);
  }
  return p;
}

/** Audio envelope drawn inside a timeline bar for the visible part of the clip. */
export function Waveform({ layer, media, width, height }: { layer: Layer; media: MediaItem; width: number; height: number }) {
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    void peaksFor(media).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [media]);
  if (!peaks.length || width < 4 || media.duration <= 0) return null;
  const a = Math.max(0, (layer.inPoint - layer.start) / media.duration);
  const b = Math.min(1, (layer.outPoint - layer.start) / media.duration);
  const n = Math.max(2, Math.min(Math.round(width / 2), 2000));
  const mid = height / 2;
  let d = "";
  for (let i = 0; i < n; i++) {
    const u = a + ((b - a) * i) / (n - 1);
    const v = peaks[Math.min(peaks.length - 1, Math.floor(u * peaks.length))] ?? 0;
    const x = (i / (n - 1)) * width;
    const h = Math.max(0.5, v * mid);
    d += `M${x.toFixed(1)},${(mid - h).toFixed(1)}V${(mid + h).toFixed(1)}`;
  }
  return (
    <svg className="absolute inset-0 pointer-events-none" width={width} height={height} aria-hidden="true">
      <path d={d} stroke="rgba(0,0,0,0.45)" strokeWidth={1} />
    </svg>
  );
}
