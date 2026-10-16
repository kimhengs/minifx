import "pixi.js/advanced-blend-modes";
import {
  Application,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  DisplacementFilter,
  Filter,
  Graphics,
  Matrix,
  Rectangle,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  type BLEND_MODES,
} from "pixi.js";
import { AdjustmentFilter, ColorGradientFilter, ColorOverlayFilter, DropShadowFilter, GlowFilter, HslAdjustmentFilter } from "pixi-filters";
import { localTime, renderOrder, worldMatrix, type Mat } from "./evaluate";
import { valueAt } from "./interpolation";
import { MediaPool } from "./mediaPool";
import type { Composition, Effect, Layer, Mask, MediaItem, Project, Vec2 } from "./types";

interface LayerNode {
  container: Container;
  content: Container | null;
  contentKey: string;
  maskObj: Container | null;
  maskKey: string;
  filters: Map<string, Filter>;
  noise?: Sprite;
  /** content size in layer space for footage layers (independent of proxy/texture load state) */
  logicalSize: [number, number] | null;
}

export interface RenderOptions {
  playing: boolean;
  /** export mode: use originals, never preview proxies, audio muted */
  exporting?: boolean;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function colorNum(hex: string): number {
  return parseInt(hex.replace("#", "").slice(0, 6).padEnd(6, "0"), 16);
}

let noiseTexture: Texture | null = null;
function getNoiseTexture(): Texture {
  if (noiseTexture) return noiseTexture;
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 128 + 60 * Math.sin(x * 0.07 + Math.sin(y * 0.05) * 2) + 40 * Math.sin(y * 0.09 + Math.cos(x * 0.04) * 3);
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = 255 - v;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  noiseTexture = Texture.from(c);
  noiseTexture.source.addressMode = "repeat";
  return noiseTexture;
}

/** Draws a composition with PixiJS. Used by the viewer and (offscreen) by export. */
export class CompRenderer {
  app = new Application();
  root = new Container();
  overlay = new Container();
  private bg = new Graphics();
  private layerRoot = new Container();
  private nodes = new Map<string, LayerNode>();
  private adjWrappers = new Map<string, Container>();
  media: MediaPool;
  private ready = false;
  private needsRender = true;
  onInvalidate: () => void = () => undefined;

  constructor(private exportMode = false) {
    this.media = new MediaPool(!exportMode);
    this.media.onChange = () => {
      this.needsRender = true;
      this.onInvalidate();
    };
  }

  async init(opts: { width: number; height: number; resolution?: number; canvas?: HTMLCanvasElement }): Promise<void> {
    await this.app.init({
      width: opts.width,
      height: opts.height,
      canvas: opts.canvas,
      antialias: true,
      backgroundAlpha: 0,
      autoStart: false,
      resolution: opts.resolution ?? 1,
      autoDensity: true,
      preference: "webgl",
      preserveDrawingBuffer: this.exportMode,
    });
    this.app.ticker.stop();
    this.root.addChild(this.bg, this.layerRoot);
    this.app.stage.addChild(this.root, this.overlay);
    this.ready = true;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  resize(w: number, h: number, resolution: number): void {
    if (!this.ready) return;
    this.app.renderer.resize(Math.max(1, w), Math.max(1, h), resolution);
    this.needsRender = true;
  }

  setView(scale: number, x: number, y: number): void {
    this.root.scale.set(scale);
    this.root.position.set(x, y);
    this.needsRender = true;
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /** Update the scene graph for this comp at this time. Cheap when nothing changed. */
  update(project: Project, comp: Composition, time: number, opts: RenderOptions, transparent = false): void {
    if (!this.ready) return;
    const mediaById = new Map<string, MediaItem>(project.media.map((m) => [m.id, m]));
    this.bg.clear();
    if (transparent) {
      const s = 32;
      for (let y = 0; y < comp.height; y += s) {
        for (let x = 0; x < comp.width; x += s) {
          const dark = ((x / s) ^ (y / s)) & 1;
          this.bg.rect(x, y, Math.min(s, comp.width - x), Math.min(s, comp.height - y)).fill({ color: dark ? 0x3a3a3a : 0x2a2a2a });
        }
      }
    } else {
      this.bg.rect(0, 0, comp.width, comp.height).fill({ color: colorNum(comp.bg) });
    }

    const live = new Set(comp.layers.map((l) => l.id));
    for (const [id, node] of this.nodes) {
      if (!live.has(id)) {
        node.container.destroy({ children: true });
        this.nodes.delete(id);
      }
    }
    this.media.prune(live);
    this.syncAudio(comp, mediaById, time, opts);

    const order = renderOrder(comp, time);
    let items: Container[] = [];
    for (const layer of order) {
      if (layer.kind === "adjustment") {
        const wrapper = this.adjWrappers.get(layer.id) ?? new Container();
        this.adjWrappers.set(layer.id, wrapper);
        wrapper.removeChildren();
        for (const it of items) wrapper.addChild(it);
        const node = this.ensureNode(layer.id);
        wrapper.filters = layer.effects.some((e) => e.enabled) ? this.buildFilters(node, layer, time) : null;
        wrapper.alpha = 1;
        items = [wrapper];
        continue;
      }
      const node = this.ensureNode(layer.id);
      this.updateNode(node, layer, comp, mediaById, time, opts);
      items.push(node.container);
    }
    this.layerRoot.removeChildren();
    for (const it of items) this.layerRoot.addChild(it);
    this.needsRender = true;
  }

  render(force = false): boolean {
    if (!this.ready || (!this.needsRender && !force)) return false;
    this.app.renderer.render(this.app.stage);
    this.needsRender = false;
    return true;
  }

  /** Local bounds of a layer's drawn content (layer space), for selection handles. */
  layerBounds(layerId: string): Bounds | null {
    const n = this.nodes.get(layerId);
    if (!n?.content) return null;
    if (n.logicalSize) return { x: n.content.position.x, y: n.content.position.y, w: n.logicalSize[0], h: n.logicalSize[1] };
    const b = n.content.getLocalBounds();
    const p = n.content.position;
    const sx = Number.isFinite(n.content.scale.x) ? n.content.scale.x : 1;
    const sy = Number.isFinite(n.content.scale.y) ? n.content.scale.y : 1;
    return { x: b.x * sx + p.x, y: b.y * sy + p.y, w: b.width * sx, h: b.height * sy };
  }

  private ensureNode(id: string): LayerNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = { container: new Container(), content: null, contentKey: "", maskObj: null, maskKey: "", filters: new Map(), logicalSize: null };
      this.nodes.set(id, n);
    }
    return n;
  }

  private syncAudio(comp: Composition, media: Map<string, MediaItem>, time: number, opts: RenderOptions): void {
    if (opts.exporting) return;
    const anySolo = comp.layers.some((l) => l.solo);
    for (const layer of comp.layers) {
      if (layer.kind !== "audio") continue;
      const m = layer.sourceId ? media.get(layer.sourceId) : undefined;
      if (!m) continue;
      const a = this.media.audio(layer, m);
      const active = time >= layer.inPoint && time < layer.outPoint && layer.audioEnabled && (!anySolo || layer.solo);
      if (!active) {
        if (!a.el.paused) a.el.pause();
        continue;
      }
      a.el.volume = Math.min(1, Math.pow(10, (layer.volume ?? 0) / 20));
      this.media.sync(a.el, time - layer.start, opts.playing, comp.fps, true);
    }
  }

  private updateNode(node: LayerNode, layer: Layer, comp: Composition, media: Map<string, MediaItem>, time: number, opts: RenderOptions): void {
    const lt = localTime(layer, time);
    const m: Mat = worldMatrix(comp, layer, time);
    node.container.setFromMatrix(new Matrix(m[0], m[1], m[2], m[3], m[4], m[5]));
    node.container.alpha = Math.max(0, Math.min(1, valueAt(layer.transform.opacity, lt) / 100));
    node.container.blendMode = layer.blend as BLEND_MODES;

    const src = layer.sourceId ? media.get(layer.sourceId) : undefined;
    let key = layer.kind;
    if (layer.kind === "video" || layer.kind === "image") key += `:${src?.id ?? "none"}:${src?.proxyPath ?? ""}`;
    if (layer.kind === "solid" && layer.solid) key += `:${layer.solid.width}x${layer.solid.height}`;

    if (node.contentKey !== key) {
      node.content?.destroy();
      node.content = null;
      node.contentKey = key;
    }

    switch (layer.kind) {
      case "video": {
        if (!src) break;
        const v = this.media.video(layer, src);
        if (!node.content) {
          const sp = new Sprite(v.texture);
          node.content = sp;
          node.container.addChildAt(sp, 0);
        }
        const sp = node.content as Sprite;
        if (sp.texture !== v.texture) sp.texture = v.texture;
        // proxies are smaller than the original: scale them up so layout stays identical.
        // (Never divide by a not-yet-loaded 0x0 texture: that leaves the sprite NaN-sized forever.)
        node.logicalSize = [src.width, src.height];
        const tw = v.texture.width;
        const th = v.texture.height;
        if (tw > 1 && th > 1 && src.width > 0 && src.height > 0) {
          sp.visible = true;
          sp.scale.set(src.width / tw, src.height / th);
        } else {
          sp.visible = false;
        }
        const anySolo = comp.layers.some((l) => l.solo);
        if (!opts.exporting) this.media.sync(v.el, lt, opts.playing, comp.fps, layer.audioEnabled && src.hasAudio && (!anySolo || layer.solo));
        break;
      }
      case "image": {
        if (!src) break;
        const tex = this.media.image(src);
        if (!node.content) {
          const sp = new Sprite(tex ?? Texture.EMPTY);
          node.content = sp;
          node.container.addChildAt(sp, 0);
        }
        const sp = node.content as Sprite;
        if (tex && sp.texture !== tex) sp.texture = tex;
        node.logicalSize = [src.width, src.height];
        if (tex && tex.width > 0 && tex.height > 0 && src.width > 0 && src.height > 0) {
          sp.visible = true;
          sp.scale.set(src.width / tex.width, src.height / tex.height);
        } else {
          sp.visible = false;
        }
        break;
      }
      case "solid":
      case "adjustment": {
        if (!layer.solid) break;
        if (!node.content) {
          node.content = new Graphics();
          node.container.addChildAt(node.content, 0);
        }
        const g = node.content as Graphics;
        g.clear().rect(0, 0, layer.solid.width, layer.solid.height).fill({ color: colorNum(layer.solid.color) });
        break;
      }
      case "text": {
        const td = layer.text;
        if (!td) break;
        if (!node.content) {
          node.content = new Text({ text: td.text });
          node.container.addChildAt(node.content, 0);
        }
        const tx = node.content as Text;
        tx.text = td.text;
        tx.style = {
          fontFamily: [td.font, "Kantumruy Pro", "Inter", "sans-serif"],
          fontSize: td.size,
          fontWeight: String(td.weight) as "600",
          fill: td.fill,
          stroke: td.strokeWidth > 0 ? { color: td.stroke, width: td.strokeWidth } : undefined,
          letterSpacing: td.tracking,
          lineHeight: (td.size * td.leading) / 100,
          align: td.align,
          padding: 8,
        };
        tx.anchor.set(td.align === "left" ? 0 : td.align === "right" ? 1 : 0.5, 0.5);
        break;
      }
      case "shape": {
        const sh = layer.shape;
        if (!sh) break;
        if (!node.content) {
          node.content = new Graphics();
          node.container.addChildAt(node.content, 0);
        }
        const g = node.content as Graphics;
        const size = valueAt(sh.size, lt);
        g.clear();
        drawShape(g, sh.kind, size, sh.points, sh.roundness, sh.path, sh.closed);
        if (sh.fillEnabled && (sh.kind !== "path" || sh.closed)) g.fill({ color: colorNum(sh.fill) });
        if (sh.strokeWidth > 0) g.stroke({ color: colorNum(sh.stroke), width: sh.strokeWidth, join: "round", cap: "round" });
        break;
      }
      default:
        break;
    }

    this.updateMasks(node, layer);
    const active = layer.effects.some((e) => e.enabled);
    node.container.filters = active ? this.buildFilters(node, layer, time) : null;
  }

  private updateMasks(node: LayerNode, layer: Layer): void {
    const masks = layer.masks.filter((mk) => mk.enabled);
    const key = JSON.stringify(masks);
    if (key === node.maskKey) return;
    node.maskKey = key;
    if (node.maskObj) {
      node.container.mask = null;
      node.maskObj.destroy({ children: true });
      node.maskObj = null;
    }
    if (!masks.length) return;
    const adds = masks.filter((mk) => mk.mode === "add");
    const subs = masks.filter((mk) => mk.mode === "subtract");
    const g = new Graphics();
    if (adds.length) {
      for (const mk of adds) maskPath(g, mk).fill({ color: 0xffffff, alpha: mk.opacity / 100 });
    } else {
      const cb = node.content ? node.content.getLocalBounds() : null;
      const px = node.content?.position.x ?? 0;
      const py = node.content?.position.y ?? 0;
      if (cb && cb.width > 0) g.rect(cb.x + px - 50, cb.y + py - 50, cb.width + 100, cb.height + 100).fill({ color: 0xffffff });
      else g.rect(-5000, -5000, 10000, 10000).fill({ color: 0xffffff });
    }
    for (const mk of subs) maskPath(g, mk).cut();
    const feather = Math.max(...masks.map((mk) => mk.feather));
    if (feather > 0 && this.ready) {
      const b = g.getLocalBounds();
      const pad = feather * 3;
      g.filters = [new BlurFilter({ strength: feather, quality: 4 })];
      const tex = this.app.renderer.generateTexture({ target: g, frame: new Rectangle(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2), resolution: 1 });
      const sp = new Sprite(tex);
      sp.position.set(b.x - pad, b.y - pad);
      g.destroy();
      node.maskObj = sp;
    } else {
      node.maskObj = g;
    }
    node.container.addChild(node.maskObj);
    node.container.mask = node.maskObj;
  }

  private buildFilters(node: LayerNode, layer: Layer, time: number): Filter[] {
    const lt = localTime(layer, time);
    const out: Filter[] = [];
    const used = new Set<string>();
    for (const fx of layer.effects) {
      if (!fx.enabled) continue;
      used.add(fx.id);
      const f = this.filterFor(node, fx, lt);
      if (f) out.push(f);
    }
    for (const id of [...node.filters.keys()]) {
      if (!used.has(id)) {
        node.filters.get(id)?.destroy();
        node.filters.delete(id);
      }
    }
    return out;
  }

  private filterFor(node: LayerNode, fx: Effect, lt: number): Filter | null {
    const num = (k: string): number => {
      const v = fx.params[k] ? valueAt(fx.params[k], lt) : 0;
      return typeof v === "number" ? v : 0;
    };
    const str = (k: string): string => {
      const v = fx.params[k] ? valueAt(fx.params[k], lt) : "#000000";
      return typeof v === "string" ? v : "#000000";
    };
    const cached = node.filters.get(fx.id);
    const remember = <T extends Filter>(f: T): T => {
      node.filters.set(fx.id, f);
      return f;
    };
    switch (fx.type) {
      case "gaussianBlur": {
        const f = (cached as BlurFilter) ?? remember(new BlurFilter());
        f.strength = num("blurriness");
        f.quality = Math.max(1, Math.round(num("quality")));
        return f;
      }
      case "fastBoxBlur": {
        const f = (cached as BlurFilter) ?? remember(new BlurFilter({ quality: 1 }));
        f.strength = num("radius");
        return f;
      }
      case "glow": {
        const f = (cached as GlowFilter) ?? remember(new GlowFilter({ distance: 20, quality: 0.25 }));
        f.outerStrength = num("intensity");
        f.color = colorNum(str("color"));
        return f;
      }
      case "dropShadow": {
        const f = (cached as DropShadowFilter) ?? remember(new DropShadowFilter());
        const a = (num("direction") * Math.PI) / 180;
        const d = num("distance");
        f.offset = { x: Math.sin(a) * d, y: -Math.cos(a) * d };
        f.alpha = num("opacity") / 100;
        f.blur = num("softness") / 2;
        f.color = colorNum(str("color"));
        return f;
      }
      case "brightnessContrast": {
        const f = (cached as AdjustmentFilter) ?? remember(new AdjustmentFilter());
        f.brightness = 1 + num("brightness") / 100;
        f.contrast = 1 + num("contrast") / 100;
        return f;
      }
      case "hueSaturation": {
        const f = (cached as HslAdjustmentFilter) ?? remember(new HslAdjustmentFilter());
        f.hue = num("hue");
        f.saturation = num("saturation") / 100;
        f.lightness = num("lightness") / 100;
        return f;
      }
      case "curves": {
        const f = (cached as AdjustmentFilter) ?? remember(new AdjustmentFilter());
        f.gamma = num("gamma");
        f.red = num("red");
        f.green = num("green");
        f.blue = num("blue");
        return f;
      }
      case "fill": {
        const f = (cached as ColorOverlayFilter) ?? remember(new ColorOverlayFilter());
        f.color = colorNum(str("color"));
        f.alpha = num("opacity") / 100;
        return f;
      }
      case "tint": {
        const f = (cached as ColorMatrixFilter) ?? remember(new ColorMatrixFilter());
        f.reset();
        f.greyscale(1, false);
        f.tint(colorNum(str("mapWhite")), true);
        f.alpha = num("amount") / 100;
        return f;
      }
      case "invert": {
        const f = (cached as ColorMatrixFilter) ?? remember(new ColorMatrixFilter());
        f.reset();
        const on = fx.params.enabled ? valueAt(fx.params.enabled, lt) : true;
        if (on) f.negative(false);
        return f;
      }
      case "displacement": {
        if (!node.noise) {
          node.noise = new Sprite(getNoiseTexture());
          node.noise.renderable = false;
          node.container.addChild(node.noise);
        }
        const f = (cached as DisplacementFilter) ?? remember(new DisplacementFilter({ sprite: node.noise, scale: 20 }));
        f.scale.x = f.scale.y = num("amount");
        node.noise.position.set(num("evolve"), num("evolve") * 0.7);
        return f;
      }
      case "gradientRamp": {
        const start = str("startColor");
        const end = str("endColor");
        const angle = num("angle");
        const blend = num("blend");
        const key = `${start}|${end}|${angle}`;
        let f = cached as (ColorGradientFilter & { __key?: string }) | undefined;
        if (!f || f.__key !== key) {
          f?.destroy();
          f = new ColorGradientFilter({ type: 0, angle, replace: true, stops: [{ offset: 0, color: colorNum(start), alpha: 1 }, { offset: 1, color: colorNum(end), alpha: 1 }] });
          f.__key = key;
          node.filters.set(fx.id, f);
        }
        f.alpha = 1 - blend / 100;
        return f;
      }
      default:
        return null;
    }
  }

  /** Render the comp into raw RGBA pixels at full size (export). */
  async extractFrame(width: number, height: number, scaleX = 1, scaleY = 1): Promise<Uint8Array> {
    const rt = RenderTexture.create({ width, height, resolution: 1 });
    this.overlay.visible = false;
    this.root.scale.set(scaleX, scaleY);
    this.root.position.set(0, 0);
    this.app.renderer.render({ container: this.root, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    const out = this.app.renderer.extract.pixels({ target: rt, frame: undefined, resolution: 1 });
    rt.destroy(true);
    return new Uint8Array(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength);
  }

  /** Seek all video layers frame-accurately (export path). */
  async seekVideos(project: Project, comp: Composition, time: number): Promise<void> {
    const media = new Map(project.media.map((m) => [m.id, m]));
    const jobs: Promise<void>[] = [];
    for (const layer of comp.layers) {
      if (layer.kind !== "video" || !layer.visible || time < layer.inPoint || time >= layer.outPoint) continue;
      const m = layer.sourceId ? media.get(layer.sourceId) : undefined;
      if (!m) continue;
      const v = this.media.video(layer, m);
      v.el.muted = true;
      jobs.push(this.media.seekExact(v.el, time - layer.start, v.texture));
    }
    await Promise.all(jobs);
  }

  destroy(): void {
    this.media.destroy();
    if (this.ready) this.app.destroy({ removeView: false }, { children: true });
    this.ready = false;
  }
}

export function drawShape(g: Graphics, kind: string, size: Vec2, points: number, roundness: number, path: Vec2[], closed: boolean): Graphics {
  const [w, h] = size;
  if (kind === "rect") {
    if (roundness > 0) g.roundRect(-w / 2, -h / 2, w, h, Math.min(roundness, Math.min(w, h) / 2));
    else g.rect(-w / 2, -h / 2, w, h);
  } else if (kind === "ellipse") {
    g.ellipse(0, 0, w / 2, h / 2);
  } else if (kind === "polygon") {
    const n = Math.max(3, Math.round(points));
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push((Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2);
    }
    g.poly(pts, true);
  } else if (path.length >= 2) {
    g.poly(path.flat(), closed);
  }
  return g;
}

function maskPath(g: Graphics, m: Mask): Graphics {
  const [x, y, w, h] = m.box;
  if (m.kind === "rect") return g.rect(x, y, w, h);
  if (m.kind === "ellipse") return g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
  if (m.path.length >= 3) return g.poly(m.path.flat(), true);
  return g.rect(x, y, w, h);
}
