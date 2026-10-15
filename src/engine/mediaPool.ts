import { ImageSource, Texture, VideoSource } from "pixi.js";
import { backend } from "../lib/backend";
import type { Layer, MediaItem } from "./types";

interface VideoEntry {
  kind: "video";
  el: HTMLVideoElement;
  texture: Texture;
  url: string;
  ready: boolean;
}
interface AudioEntry {
  kind: "audio";
  el: HTMLAudioElement;
  url: string;
}
interface ImageEntry {
  kind: "image";
  texture: Texture | null;
  url: string;
}

/**
 * Owns HTML media elements and GPU textures. One element per layer, so two
 * layers using the same clip at different times never fight over seeking.
 */
export class MediaPool {
  private videos = new Map<string, VideoEntry>();
  private audios = new Map<string, AudioEntry>();
  private images = new Map<string, ImageEntry>();
  /** called when a texture finished loading/seeking and the view should redraw */
  onChange: () => void = () => undefined;

  constructor(private useProxies: boolean) {}

  private urlFor(m: MediaItem): string {
    const path = this.useProxies && m.proxyPath ? m.proxyPath : m.path;
    return backend.mediaUrl(path);
  }

  image(m: MediaItem): Texture | null {
    const url = this.urlFor(m);
    let e = this.images.get(m.id);
    if (e && e.url === url) return e.texture;
    e = { kind: "image", texture: null, url };
    this.images.set(m.id, e);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const entry = this.images.get(m.id);
      if (!entry || entry.url !== url) return;
      entry.texture = new Texture({ source: new ImageSource({ resource: img }) });
      this.onChange();
    };
    img.src = url;
    return null;
  }

  video(layer: Layer, m: MediaItem): VideoEntry {
    const url = this.urlFor(m);
    const existing = this.videos.get(layer.id);
    if (existing && existing.url === url) return existing;
    if (existing) this.disposeVideo(layer.id);
    const el = document.createElement("video");
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.playsInline = true;
    el.muted = true;
    el.src = url;
    const source = new VideoSource({ resource: el, autoPlay: false, updateFPS: 0, autoLoad: true });
    const entry: VideoEntry = { kind: "video", el, texture: new Texture({ source }), url, ready: false };
    el.addEventListener("loadeddata", () => {
      entry.ready = true;
      source.update();
      this.onChange();
    });
    el.addEventListener("seeked", () => {
      source.update();
      this.onChange();
    });
    this.videos.set(layer.id, entry);
    return entry;
  }

  audio(layer: Layer, m: MediaItem): AudioEntry {
    const url = backend.mediaUrl(m.path);
    const existing = this.audios.get(layer.id);
    if (existing && existing.url === url) return existing;
    const el = document.createElement("audio");
    el.preload = "auto";
    el.src = url;
    const entry: AudioEntry = { kind: "audio", el, url };
    this.audios.set(layer.id, entry);
    return entry;
  }

  /** Keep a media element in sync with the timeline during preview. */
  sync(el: HTMLMediaElement, srcTime: number, playing: boolean, fps: number, audible: boolean): void {
    const dur = Number.isFinite(el.duration) ? el.duration : Infinity;
    const t = Math.min(Math.max(0, srcTime), Math.max(0, dur - 0.01));
    el.muted = !audible;
    if (playing) {
      if (Math.abs(el.currentTime - t) > 0.25) el.currentTime = t;
      if (el.paused) void el.play().catch(() => undefined);
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - t) > 0.5 / fps) el.currentTime = t;
    }
  }

  /** Frame-accurate seek for export: resolves after the frame is decoded. */
  seekExact(el: HTMLVideoElement, t: number, texture: Texture): Promise<void> {
    return new Promise((resolve) => {
      const target = Math.max(0, Math.min(t, (el.duration || t + 1) - 0.001));
      if (el.readyState >= 2 && Math.abs(el.currentTime - target) < 1e-4) {
        texture.source.update();
        resolve();
        return;
      }
      const done = (): void => {
        el.removeEventListener("seeked", done);
        texture.source.update();
        resolve();
      };
      el.addEventListener("seeked", done);
      el.currentTime = target;
      window.setTimeout(done, 3000);
    });
  }

  waitReady(): Promise<void> {
    const pending = [...this.videos.values()].filter((v) => !v.ready).map(
      (v) =>
        new Promise<void>((resolve) => {
          v.el.addEventListener("loadeddata", () => resolve(), { once: true });
          window.setTimeout(resolve, 5000);
        }),
    );
    return Promise.all(pending).then(() => undefined);
  }

  /** While playing, push the latest decoded video frame to the GPU. */
  updatePlaying(): void {
    for (const v of this.videos.values()) if (!v.el.paused && v.ready) v.texture.source.update();
  }

  pauseAll(): void {
    for (const v of this.videos.values()) v.el.pause();
    for (const a of this.audios.values()) a.el.pause();
  }

  /** Remove elements for layers that no longer exist. */
  prune(liveLayerIds: Set<string>): void {
    for (const id of [...this.videos.keys()]) if (!liveLayerIds.has(id)) this.disposeVideo(id);
    for (const [id, a] of [...this.audios.entries()]) {
      if (!liveLayerIds.has(id)) {
        a.el.pause();
        a.el.removeAttribute("src");
        this.audios.delete(id);
      }
    }
  }

  allAudioElements(): Map<string, HTMLMediaElement> {
    const m = new Map<string, HTMLMediaElement>();
    for (const [id, v] of this.videos) m.set(id, v.el);
    for (const [id, a] of this.audios) m.set(id, a.el);
    return m;
  }

  private disposeVideo(id: string): void {
    const v = this.videos.get(id);
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute("src");
    v.el.load();
    v.texture.destroy(true);
    this.videos.delete(id);
  }

  destroy(): void {
    for (const id of [...this.videos.keys()]) this.disposeVideo(id);
    for (const a of this.audios.values()) a.el.pause();
    this.audios.clear();
    for (const i of this.images.values()) i.texture?.destroy(true);
    this.images.clear();
  }
}
