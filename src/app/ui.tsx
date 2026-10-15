import { useEffect, useRef, useState, type ReactNode } from "react";
import { Timer } from "lucide-react";
import { useProject } from "../store/projectStore";

/** After Effects style number: drag the blue value left/right to scrub, click to type. */
export function ScrubNumber(props: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  label?: string;
  width?: number;
  gestureKey?: string;
}) {
  const { value, onChange, step = 1, min = -Infinity, max = Infinity, precision = 1, suffix = "", label, width = 56, gestureKey } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const clampV = (v: number): number => Math.min(max, Math.max(min, v));
  const fmt = (v: number): string => (Number.isInteger(v) && precision <= 1 ? String(v) : v.toFixed(precision));

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        className="field mono"
        style={{ width }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text);
          if (Number.isFinite(n)) onChange(clampV(n));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
          e.stopPropagation();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={label ? `${label} ${fmt(value)}${suffix}` : undefined}
      className="scrub mono bg-transparent border-0 p-0 text-left"
      style={{ minWidth: 28 }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
        if (gestureKey) useProject.getState().beginGesture(gestureKey);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        if (!d.moved) return;
        const mult = e.shiftKey ? 10 : e.ctrlKey ? 0.1 : 1;
        onChange(clampV(d.v + dx * step * mult));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (gestureKey) useProject.getState().endGesture();
        if (d && !d.moved) {
          setText(fmt(value));
          setEditing(true);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(clampV(value + step * (e.shiftKey ? 10 : 1)));
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(clampV(value - step * (e.shiftKey ? 10 : 1)));
        if (e.key === "Enter") {
          setText(fmt(value));
          setEditing(true);
        }
      }}
    >
      {fmt(value)}
      {suffix}
    </button>
  );
}

export function Stopwatch(props: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn" style={{ width: 18, height: 18 }} aria-pressed={props.on} aria-label={`Keyframes for ${props.label}`} onClick={props.onClick} title="Stopwatch: enable keyframes">
      <Timer size={13} color={props.on ? "var(--key)" : "#777"} />
    </button>
  );
}

export function ColorField(props: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1" title={props.label}>
      <input type="color" aria-label={props.label} value={props.value.slice(0, 7)} onChange={(e) => props.onChange(e.target.value)} className="h-5 w-7 cursor-pointer border border-[#444] bg-transparent p-0" />
      <span className="mono text-[11px] text-muted">{props.value}</span>
    </label>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Select<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; width?: number }) {
  return (
    <select aria-label={props.label} className="field" style={{ width: props.width, height: 22, padding: "0 4px" }} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Row(props: { label: ReactNode; children: ReactNode; indent?: number }) {
  return (
    <div className="flex items-center gap-2 min-h-[24px] px-2 hover:bg-[#242424]" style={{ paddingLeft: 8 + (props.indent ?? 0) * 14 }}>
      <div className="w-[130px] flex-none truncate text-[#cfcfcf]">{props.label}</div>
      <div className="flex items-center gap-2 flex-1 min-w-0">{props.children}</div>
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <div className="flex-1 flex items-center justify-center text-muted p-6 text-center leading-relaxed">{props.children}</div>;
}

export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export const LABEL_COLORS = ["#777777", "#b53838", "#e4d84c", "#a9cbc7", "#e5bcc9", "#a9a9ca", "#e7c19e", "#b3c7b3", "#677de0"];
