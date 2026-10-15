import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import * as cmd from "../commands";
import { effectDef } from "../engine/effects";
import { valueAt } from "../engine/interpolation";
import type { BlendMode, Layer } from "../engine/types";
import { activeComp, useProject } from "../store/projectStore";
import { Empty, Row, ScrubNumber, Select, Stopwatch } from "../app/ui";
import { ValueEditor } from "./TimelinePanel";

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "add", label: "Add" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
];

export function EffectControlsPanel() {
  const comp = useProject((s) => activeComp(s.project));
  const selectedIds = useProject((s) => s.selectedLayerIds);
  const time = useProject((s) => s.currentTime);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const layer = comp?.layers.find((l) => l.id === selectedIds[0]);
  if (!comp || !layer) return <Empty>Select a layer to see its effects, masks and layer settings.</Empty>;
  const lt = time - layer.start;

  return (
    <div
      className="panel-root"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const fx = e.dataTransfer.getData("application/x-minifx-effect");
        if (fx) cmd.addEffect([layer.id], fx);
      }}
    >
      <div className="panel-bar">
        <span className="font-medium truncate">{comp.name} · {layer.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto pb-6">
        <Section title="Layer" open={!collapsed.layer} toggle={() => setCollapsed({ ...collapsed, layer: !collapsed.layer })}>
          <Row label="Blending Mode">
            <Select label="Blend mode" value={layer.blend} options={BLENDS} onChange={(v) => cmd.setBlend([layer.id], v)} width={110} />
          </Row>
          {(layer.kind === "audio" || layer.kind === "video") && (
            <Row label="Audio Level">
              <ScrubNumber label="Audio level" value={layer.volume ?? 0} step={0.1} min={-48} max={12} suffix=" dB" onChange={(v) => cmd.updateLayer(layer.id, "Audio Level", (l) => { l.volume = v; })} gestureKey={`vol:${layer.id}`} />
            </Row>
          )}
          {layer.solid && (
            <Row label="Solid Color">
              <input type="color" aria-label="Solid color" value={layer.solid.color} onChange={(e) => cmd.updateLayer(layer.id, "Solid Color", (l) => { if (l.solid) l.solid.color = e.target.value; })} />
            </Row>
          )}
        </Section>

        {layer.effects.length === 0 && <div className="text-muted px-3 py-3">No effects. Drag one here from Effects &amp; Presets, or double-click it there.</div>}
        {layer.effects.map((fx, i) => {
          const def = effectDef(fx.type);
          const open = !collapsed[fx.id];
          return (
            <div key={fx.id} className="border-b border-[#2a2a2a]">
              <div className="flex items-center gap-1 h-[26px] px-1 bg-[#242424]">
                <button type="button" className="icon-btn" style={{ width: 18 }} aria-label={open ? "Collapse" : "Expand"} onClick={() => setCollapsed({ ...collapsed, [fx.id]: open })}>
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <input type="checkbox" aria-label={`Enable ${def?.name}`} checked={fx.enabled} onChange={() => cmd.toggleEffect(layer.id, fx.id)} />
                <span className="font-medium flex-1 truncate">{def?.name ?? fx.type}</span>
                <button type="button" className="icon-btn" title="Reset" aria-label="Reset effect" onClick={() => cmd.resetEffect(layer.id, fx.id)}><RotateCcw size={12} /></button>
                <button type="button" className="icon-btn" title="Move up" aria-label="Move effect up" disabled={i === 0} onClick={() => cmd.moveEffect(layer.id, fx.id, -1)}><ArrowUp size={12} /></button>
                <button type="button" className="icon-btn" title="Move down" aria-label="Move effect down" disabled={i === layer.effects.length - 1} onClick={() => cmd.moveEffect(layer.id, fx.id, 1)}><ArrowDown size={12} /></button>
                <button type="button" className="icon-btn" title="Delete" aria-label="Delete effect" onClick={() => cmd.removeEffect(layer.id, fx.id)}><Trash2 size={12} /></button>
              </div>
              {open &&
                def?.params.map((pd) => {
                  const path = `fx.${fx.id}.${pd.key}`;
                  const prop = fx.params[pd.key];
                  if (!prop) return null;
                  return (
                    <Row key={pd.key} indent={1} label={<span className="inline-flex items-center gap-1"><Stopwatch on={prop.keyframes.length > 0} label={pd.label} onClick={() => cmd.toggleStopwatch(layer.id, path)} />{pd.label}</span>}>
                      <ValueEditor layer={layer} path={path} value={valueAt(prop, lt)} def={pd} />
                      {pd.kind === "number" && pd.min !== undefined && pd.max !== undefined && (
                        <input
                          type="range"
                          aria-label={`${pd.label} slider`}
                          min={pd.min}
                          max={pd.max}
                          step={pd.step}
                          value={Number(valueAt(prop, lt))}
                          onPointerDown={() => useProject.getState().beginGesture(path)}
                          onPointerUp={() => useProject.getState().endGesture()}
                          onChange={(e) => cmd.setPropValue(layer.id, path, Number(e.target.value))}
                          className="flex-1 min-w-[60px]"
                          style={{ accentColor: "var(--accent)" }}
                        />
                      )}
                    </Row>
                  );
                })}
            </div>
          );
        })}

        <Masks layer={layer} open={!collapsed.masks} toggle={() => setCollapsed({ ...collapsed, masks: !collapsed.masks })} />
      </div>
    </div>
  );
}

function Section(props: { title: string; open: boolean; toggle: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="border-b border-[#2a2a2a]">
      <div className="flex items-center gap-1 h-[26px] px-1 bg-[#242424]">
        <button type="button" className="icon-btn" style={{ width: 18 }} aria-label={props.open ? "Collapse" : "Expand"} onClick={props.toggle}>
          {props.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="font-medium flex-1">{props.title}</span>
        {props.actions}
      </div>
      {props.open && props.children}
    </div>
  );
}

function Masks({ layer, open, toggle }: { layer: Layer; open: boolean; toggle: () => void }) {
  return (
    <Section
      title={`Masks (${layer.masks.length})`}
      open={open}
      toggle={toggle}
      actions={
        <>
          <button type="button" className="btn" style={{ height: 20 }} onClick={() => cmd.addMask(layer.id, "rect")}>+ Rect</button>
          <button type="button" className="btn" style={{ height: 20 }} onClick={() => cmd.addMask(layer.id, "ellipse")}>+ Ellipse</button>
        </>
      }
    >
      {layer.masks.length === 0 && <div className="text-muted px-3 py-2">Draw masks in the viewer with the Mask tool (M) or add one here.</div>}
      {layer.masks.map((m) => (
        <div key={m.id} className="py-1 border-t border-[#262626]">
          <Row label={<span className="inline-flex items-center gap-1"><input type="checkbox" aria-label="Enable mask" checked={m.enabled} onChange={() => cmd.updateMask(layer.id, m.id, { enabled: !m.enabled })} />{m.name} <span className="text-muted">({m.kind})</span></span>}>
            <Select label="Mask mode" value={m.mode} options={[{ value: "add", label: "Add" }, { value: "subtract", label: "Subtract" }]} onChange={(v) => cmd.updateMask(layer.id, m.id, { mode: v })} width={90} />
            <button type="button" className="icon-btn" aria-label="Delete mask" onClick={() => cmd.removeMask(layer.id, m.id)}><Trash2 size={12} /></button>
          </Row>
          <Row label="Mask Feather" indent={1}>
            <ScrubNumber label="Mask feather" value={m.feather} min={0} max={500} step={1} suffix=" px" gestureKey={`mf:${m.id}`} onChange={(v) => cmd.updateMask(layer.id, m.id, { feather: v })} />
          </Row>
          <Row label="Mask Opacity" indent={1}>
            <ScrubNumber label="Mask opacity" value={m.opacity} min={0} max={100} step={1} suffix="%" gestureKey={`mo:${m.id}`} onChange={(v) => cmd.updateMask(layer.id, m.id, { opacity: v })} />
          </Row>
          <Row label="Mask Box" indent={1}>
            {m.box.map((v, i) => (
              <ScrubNumber key={i} label={["x", "y", "w", "h"][i]} value={Math.round(v)} step={1} gestureKey={`mb:${m.id}`} onChange={(nv) => cmd.updateMask(layer.id, m.id, { box: m.box.map((b, j) => (j === i ? nv : b)) as [number, number, number, number] })} />
            ))}
          </Row>
        </div>
      ))}
    </Section>
  );
}
