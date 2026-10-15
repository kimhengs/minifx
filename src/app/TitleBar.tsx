import { useEffect, useRef, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { backend } from "../lib/backend";
import { useProject } from "../store/projectStore";
import { ACTIONS, actionKeys, type Action } from "./actions";
import { customWorkspaces, switchWorkspace } from "./workspace";
import { t } from "../lib/i18n";
import { useSettings } from "../store/settingsStore";

const MENUS: Action["menu"][] = ["File", "Edit", "Composition", "Layer", "Effect", "Window", "Help"];
const EXTRA: Record<string, Action["menu"][]> = { Edit: ["Edit"], Layer: ["Layer", "Tools"], Composition: ["Composition", "Time", "View"] };

export function TitleBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState<string[]>([]);
  const name = useProject((s) => s.project.name);
  const dirty = useProject((s) => s.dirty);
  const barRef = useRef<HTMLDivElement>(null);
  useSettings((x) => x.language);

  useEffect(() => {
    if (!open) return;
    if (open === "Window") void customWorkspaces().then(setCustom);
    const close = (e: PointerEvent): void => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={barRef} className="h-[32px] flex-none flex items-center bg-[#202020] border-b border-[#2c2c2c] relative z-40" data-tauri-drag-region>
      <div className="flex items-center gap-2 px-3" data-tauri-drag-region>
        <span className="w-[18px] h-[18px] rounded bg-accent text-white text-[10px] font-semibold flex items-center justify-center">fx</span>
      </div>
      <nav className="flex items-center" aria-label="Menu bar">
        {MENUS.map((m) => (
          <div key={m} className="relative">
            <button
              type="button"
              className="h-[32px] px-2.5 border-0 bg-transparent hover:bg-[#333] text-[12.5px]"
              style={{ background: open === m ? "#333" : undefined }}
              onClick={() => setOpen(open === m ? null : m)}
              onPointerEnter={() => open && setOpen(m)}
              aria-haspopup="menu"
              aria-expanded={open === m}
            >
              {t(m)}
            </button>
            {open === m && (
              <div className="menu-pop" style={{ top: 32, left: 0, maxHeight: "80vh", overflowY: "auto" }} role="menu">
                {(EXTRA[m] ?? [m]).map((group, gi) => (
                  <div key={group}>
                    {gi > 0 && <div className="menu-sep" />}
                    {ACTIONS.filter((a) => a.menu === group).map((a) => {
                      const enabled = !a.enabled || a.enabled();
                      return (
                        <button key={a.id} type="button" role="menuitem" className="menu-item" disabled={!enabled} onClick={() => { setOpen(null); a.run(); }}>
                          <span className="flex-1">{a.label}</span>
                          <span className="text-[11px] opacity-60">{actionKeys(a)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {m === "Window" && custom.length > 0 && (
                  <>
                    <div className="menu-sep" />
                    {custom.map((w) => (
                      <button key={w} type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(null); void switchWorkspace(w); }}>
                        Workspace · {w}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="flex-1 text-center text-[12px] text-muted truncate" data-tauri-drag-region>
        MiniFX — {name}
        {dirty ? " *" : ""}
      </div>
      <div className="flex">
        <button type="button" className="w-[44px] h-[32px] flex items-center justify-center border-0 bg-transparent hover:bg-[#333]" aria-label="Minimize" onClick={() => void backend.windowAction("minimize")}>
          <Minus size={14} />
        </button>
        <button type="button" className="w-[44px] h-[32px] flex items-center justify-center border-0 bg-transparent hover:bg-[#333]" aria-label="Maximize" onClick={() => void backend.windowAction("toggleMaximize")}>
          <Square size={12} />
        </button>
        <button type="button" className="w-[44px] h-[32px] flex items-center justify-center border-0 bg-transparent hover:bg-[#c42b1c]" aria-label="Close" onClick={() => void backend.windowAction("close")}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
