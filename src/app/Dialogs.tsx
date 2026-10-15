import { useEffect, useState, type ReactNode } from "react";
import * as cmd from "../commands";
import { activeComp, useProject } from "../store/projectStore";
import { DEFAULT_SETTINGS, useSettings, type Language } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { discardRecovery, recoverAutosave, startAutosave } from "../lib/projectIO";
import { ACTIONS, actionKeys, comboFromEvent } from "./actions";
import { Check, Select } from "./ui";

function Modal(props: { title: string; children: ReactNode; onClose: () => void; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center" onPointerDown={props.onClose}>
      <div role="dialog" aria-label={props.title} className="bg-[#262626] border border-[#3c3c3c] rounded-md shadow-2xl flex flex-col max-h-[86vh]" style={{ width: props.width ?? 460 }} onPointerDown={(e) => e.stopPropagation()}>
        <div className="h-[34px] px-4 flex items-center border-b border-[#333] font-medium">{props.title}</div>
        <div className="p-4 overflow-y-auto flex-1">{props.children}</div>
        {props.footer && <div className="px-4 py-3 border-t border-[#333] flex justify-end gap-2">{props.footer}</div>}
      </div>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-[130px] text-[#cfcfcf]">{props.label}</span>
      {props.children}
    </label>
  );
}

const COMP_PRESETS = [
  { name: "HD 1080p 30", w: 1920, h: 1080, fps: 30 },
  { name: "HD 1080p 60", w: 1920, h: 1080, fps: 60 },
  { name: "Vertical 1080×1920", w: 1080, h: 1920, fps: 30 },
  { name: "Square 1080", w: 1080, h: 1080, fps: 30 },
  { name: "4K UHD 30", w: 3840, h: 2160, fps: 30 },
  { name: "HD 720p 25", w: 1280, h: 720, fps: 25 },
];

function CompDialog({ mode }: { mode: "newComp" | "compSettings" }) {
  const comp = useProject((s) => activeComp(s.project));
  const close = (): void => useUi.getState().set({ dialog: null });
  const init = mode === "compSettings" && comp ? comp : { name: `Comp ${useProject.getState().project.compositions.length + 1}`, width: 1920, height: 1080, fps: 30, duration: 10, bg: "#000000" };
  const [v, setV] = useState({ name: init.name, width: init.width, height: init.height, fps: init.fps, duration: init.duration, bg: init.bg });
  const ok = (): void => {
    const clean = { ...v, width: Math.max(16, Math.round(v.width)), height: Math.max(16, Math.round(v.height)), fps: Math.min(120, Math.max(1, v.fps)), duration: Math.max(0.1, v.duration) };
    if (mode === "newComp") cmd.newComposition(clean);
    else if (comp) cmd.updateComposition(comp.id, clean);
    close();
  };
  return (
    <Modal title={mode === "newComp" ? "Composition Settings — New" : "Composition Settings"} onClose={close} footer={<><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn btn-primary" onClick={ok}>OK</button></>}>
      <Field label="Name"><input className="field flex-1" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
      <Field label="Preset">
        <Select label="Preset" width={220} value="" options={[{ value: "", label: "Custom" }, ...COMP_PRESETS.map((p) => ({ value: p.name, label: p.name }))]} onChange={(n) => { const p = COMP_PRESETS.find((x) => x.name === n); if (p) setV({ ...v, width: p.w, height: p.h, fps: p.fps }); }} />
      </Field>
      <Field label="Width × Height">
        <input className="field w-[80px] mono" type="number" value={v.width} onChange={(e) => setV({ ...v, width: Number(e.target.value) })} />
        <span>×</span>
        <input className="field w-[80px] mono" type="number" value={v.height} onChange={(e) => setV({ ...v, height: Number(e.target.value) })} />
      </Field>
      <Field label="Frame Rate"><input className="field w-[80px] mono" type="number" value={v.fps} onChange={(e) => setV({ ...v, fps: Number(e.target.value) })} /> <span className="text-muted">fps</span></Field>
      <Field label="Duration"><input className="field w-[80px] mono" type="number" step="0.1" value={v.duration} onChange={(e) => setV({ ...v, duration: Number(e.target.value) })} /> <span className="text-muted">seconds</span></Field>
      <Field label="Background"><input type="color" value={v.bg} onChange={(e) => setV({ ...v, bg: e.target.value })} /></Field>
    </Modal>
  );
}

function Preferences() {
  const s = useSettings();
  const close = (): void => useUi.getState().set({ dialog: null });
  const [tab, setTab] = useState<"general" | "memory" | "proxy" | "shortcuts">("general");
  const [capture, setCapture] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapture(null);
      const combo = comboFromEvent(e);
      if (!combo || ["Ctrl", "Alt", "Shift", "Ctrl+Shift", "Ctrl+Alt"].includes(combo)) return;
      const clash = ACTIONS.find((a) => a.id !== capture && actionKeys(a)?.toUpperCase() === combo.toUpperCase());
      const next = { ...s.shortcuts, [capture]: combo };
      if (clash) next[clash.id] = "";
      s.update({ shortcuts: next });
      if (clash) useUi.getState().toast(`Removed ${combo} from “${clash.label}”`);
      setCapture(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capture, s]);

  return (
    <Modal title="Preferences" width={680} onClose={close} footer={<button type="button" className="btn btn-primary" onClick={close}>Done</button>}>
      <div className="flex gap-4 min-h-[380px]">
        <div className="w-[140px] flex flex-col gap-1">
          {(["general", "memory", "proxy", "shortcuts"] as const).map((t) => (
            <button key={t} type="button" className="btn text-left" style={{ background: tab === t ? "var(--accent)" : undefined }} onClick={() => setTab(t)}>
              {t === "general" ? "General" : t === "memory" ? "Memory & Cache" : t === "proxy" ? "Media & Proxies" : "Keyboard Shortcuts"}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          {tab === "general" && (
            <>
              <Field label="Language"><Select<Language> label="Language" value={s.language} options={[{ value: "en", label: "English" }, { value: "km", label: "ខ្មែរ (Khmer)" }]} onChange={(v) => s.update({ language: v })} /></Field>
              <Field label="Theme accent"><input type="color" value={s.accent} onChange={(e) => s.update({ accent: e.target.value })} /><button type="button" className="btn" onClick={() => s.update({ accent: DEFAULT_SETTINGS.accent })}>Reset</button></Field>
              <Field label="Auto-save every">
                <input className="field w-[60px] mono" type="number" min={1} max={60} value={s.autosaveMinutes} onChange={(e) => { s.update({ autosaveMinutes: Math.max(1, Number(e.target.value)) }); startAutosave(); }} />
                <span className="text-muted">minutes (crash recovery backup)</span>
              </Field>
              <Field label="Info panel"><Check label="Show performance numbers" checked={s.showInfoPerf} onChange={(v) => s.update({ showInfoPerf: v })} /></Field>
            </>
          )}
          {tab === "memory" && (
            <>
              <Field label="RAM preview cache">
                <input type="range" min={256} max={16384} step={256} value={s.cacheMB} onChange={(e) => s.update({ cacheMB: Number(e.target.value) })} style={{ accentColor: "var(--accent)" }} />
                <span className="mono">{(s.cacheMB / 1024).toFixed(2)} GB</span>
              </Field>
              <p className="text-muted leading-relaxed">Frames rendered during playback and RAM preview are kept in memory up to this limit. The green bar on the timeline ruler shows cached frames.</p>
            </>
          )}
          {tab === "proxy" && (
            <>
              <Field label="Auto proxies"><Check label="Create proxies for large video" checked={s.proxyEnabled} onChange={(v) => s.update({ proxyEnabled: v })} /></Field>
              <Field label="When height above"><input className="field w-[80px] mono" type="number" value={s.proxyThresholdHeight} onChange={(e) => s.update({ proxyThresholdHeight: Number(e.target.value) })} /> px</Field>
              <Field label="Proxy height"><Select label="Proxy height" value={String(s.proxyHeight)} options={["360", "540", "720", "1080"].map((v) => ({ value: v, label: `${v}p` }))} onChange={(v) => s.update({ proxyHeight: Number(v) })} /></Field>
              <p className="text-muted leading-relaxed">Proxies are used only for preview. Export always renders from the original files.</p>
            </>
          )}
          {tab === "shortcuts" && (
            <>
              <div className="flex gap-2 mb-2">
                <input className="field flex-1" placeholder="Search commands" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <button type="button" className="btn" onClick={() => s.update({ shortcuts: {} })}>Reset all</button>
              </div>
              <div className="max-h-[330px] overflow-y-auto border border-line rounded">
                {ACTIONS.filter((a) => a.label.toLowerCase().includes(filter.toLowerCase())).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 px-2 h-[26px] border-b border-[#2c2c2c]">
                    <span className="text-muted w-[86px] text-[11px]">{a.menu}</span>
                    <span className="flex-1 truncate">{a.label}</span>
                    <button type="button" className="btn mono" style={{ minWidth: 120, height: 20, background: capture === a.id ? "var(--accent)" : undefined }} onClick={() => setCapture(a.id)}>
                      {capture === a.id ? "Press keys…" : actionKeys(a) || "—"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Recovery() {
  const close = (): void => useUi.getState().set({ dialog: null });
  return (
    <Modal
      title="Recover unsaved work?"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={() => { void discardRecovery(); close(); }}>Discard</button>
          <button type="button" className="btn btn-primary" onClick={() => void recoverAutosave()}>Recover</button>
        </>
      }
    >
      <p className="leading-relaxed">MiniFX did not close normally last time. An auto-saved copy of your project is available. Do you want to open it?</p>
    </Modal>
  );
}

function About() {
  const close = (): void => useUi.getState().set({ dialog: null });
  return (
    <Modal title="About MiniFX" onClose={close} footer={<button type="button" className="btn btn-primary" onClick={close}>OK</button>}>
      <p className="leading-relaxed">MiniFX 0.1 — a lightweight motion graphics and video effects editor.<br />Tauri 2 · React · PixiJS · FFmpeg.<br /><span className="text-muted">FFmpeg is licensed under the LGPL/GPL; see the FFmpeg project for terms.</span></p>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useUi((s) => s.dialog);
  if (dialog === "newComp" || dialog === "compSettings") return <CompDialog mode={dialog} />;
  if (dialog === "preferences") return <Preferences />;
  if (dialog === "recovery") return <Recovery />;
  if (dialog === "about") return <About />;
  return null;
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="fixed bottom-3 right-3 z-[200] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto bg-[#2a2a2a] border rounded px-3 py-2 shadow-xl max-w-[420px]" style={{ borderColor: t.kind === "error" ? "var(--danger)" : t.kind === "success" ? "var(--ok)" : "#444" }} onClick={() => useUi.getState().dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
