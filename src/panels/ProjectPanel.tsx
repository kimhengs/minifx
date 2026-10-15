import { useState } from "react";
import { Film, Image as ImageIcon, Music, Clapperboard, Plus, FolderInput, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import * as cmd from "../commands";
import { formatTimecode } from "../engine/factory";
import type { MediaItem } from "../engine/types";
import { importDialog } from "../lib/projectIO";
import { useProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";

function fmtSize(b: number): string {
  if (!b) return "";
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

export function ProjectPanel() {
  const project = useProject((s) => s.project);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const sel = project.media.find((m) => m.id === selected);
  const q = query.toLowerCase();

  return (
    <div className="panel-root">
      <div className="flex gap-3 p-2 border-b border-line min-h-[86px]">
        <div className="w-[120px] h-[68px] flex-none bg-[#111] border border-line flex items-center justify-center overflow-hidden">
          {sel?.thumbnail ? <img src={sel.thumbnail} alt="" className="max-w-full max-h-full" /> : sel ? <KindIcon m={sel} size={28} /> : <Clapperboard size={28} color="#444" />}
        </div>
        <div className="min-w-0 text-[11px] leading-[16px] text-muted">
          {sel ? (
            <>
              <div className="text-ink font-medium truncate">{sel.name}</div>
              {sel.kind !== "audio" && <div>{sel.width} × {sel.height}{sel.kind === "video" ? ` · ${sel.fps.toFixed(2)} fps` : ""}</div>}
              {sel.duration > 0 && <div>Δ {formatTimecode(sel.duration, Math.round(sel.fps) || 30)}</div>}
              <div>{sel.codec} {sel.hasAudio ? "· audio" : ""} {fmtSize(sel.size)}</div>
              {sel.proxyPath && <div className="text-[#46c08a]">Proxy ready</div>}
            </>
          ) : (
            <div>Select an item to see details. Drag footage to the Timeline or Composition.</div>
          )}
        </div>
      </div>
      <div className="panel-bar">
        <input className="field flex-1" placeholder="Search" aria-label="Search project" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="button" className="icon-btn" title="Import (Ctrl+I)" aria-label="Import" onClick={() => void importDialog()}>
          <FolderInput size={14} />
        </button>
        <button type="button" className="icon-btn" title="New Composition" aria-label="New composition" onClick={() => useUi.getState().set({ dialog: "newComp" })}>
          <Plus size={14} />
        </button>
        <button type="button" className="icon-btn" title="Delete footage" aria-label="Delete footage" disabled={!sel} onClick={() => sel && cmd.removeMedia(sel.id)}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto" role="list" aria-label="Project items">
        {project.compositions
          .filter((c) => c.name.toLowerCase().includes(q))
          .map((c) => (
            <button
              key={c.id}
              type="button"
              role="listitem"
              className="w-full flex items-center gap-2 px-2 h-[24px] text-left border-0 bg-transparent hover:bg-[#2a2a2a]"
              style={{ background: project.activeCompId === c.id ? "#2b3340" : undefined }}
              onDoubleClick={() => cmd.setActiveComp(c.id)}
              onClick={() => setSelected(null)}
            >
              <Clapperboard size={13} color="#9fb4dd" />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-muted text-[11px]">{c.width}×{c.height}</span>
            </button>
          ))}
        {project.media
          .filter((m) => m.name.toLowerCase().includes(q))
          .map((m) => (
            <button
              key={m.id}
              type="button"
              role="listitem"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-minifx-media", m.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="w-full flex items-center gap-2 px-2 h-[24px] text-left border-0 bg-transparent hover:bg-[#2a2a2a]"
              style={{ background: selected === m.id ? "#2b3340" : undefined }}
              onClick={() => setSelected(m.id)}
              onDoubleClick={() => cmd.addMediaLayer(m)}
              title="Double-click to add to the composition"
            >
              <KindIcon m={m} size={13} />
              <span className="flex-1 truncate" style={{ color: m.status === "offline" ? "var(--danger)" : undefined }}>{m.name}</span>
              {m.status === "processing" && <Loader2 size={12} className="animate-spin" />}
              {m.status === "offline" && <AlertTriangle size={12} color="var(--danger)" />}
              <span className="text-muted text-[11px] w-[54px] text-right">{m.kind === "image" ? "Still" : formatTimecode(m.duration, 30).slice(3, 8)}</span>
            </button>
          ))}
        {project.media.length === 0 && <div className="text-muted p-4 text-center leading-relaxed">Import media with Ctrl+I or drag files from Explorer onto the window.</div>}
      </div>
    </div>
  );
}

function KindIcon({ m, size }: { m: MediaItem; size: number }) {
  if (m.kind === "video") return <Film size={size} color="#8ec5ff" />;
  if (m.kind === "image") return <ImageIcon size={size} color="#c9a7ff" />;
  return <Music size={size} color="#7fe0b8" />;
}
