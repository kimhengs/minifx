import { useEffect, useRef, useState } from "react";
import { Send, ShieldCheck, Sparkles } from "lucide-react";
import { audit, plan as makePlan, runPlan, type AuditItem, type Plan } from "../ai/assistant";
import { activeComp, useProject } from "../store/projectStore";

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  plan?: Plan;
  audit?: AuditItem[];
  status?: "pending" | "done" | "discarded";
  historyBefore?: number;
}

const EXAMPLES = ['add text "Siem Reap Vlog" and fade in', "glow on title", "new comp 1080x1920 30fps 15s", "split at 0:05", "opacity 50", "spin logo", "audit", "export"];

let nextId = 1;

export function AIPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: nextId++, role: "ai", text: "សួស្តី! Tell me what to edit (English or Khmer keywords). I audit the project and your prompt first, then show the exact commands before anything changes." },
  ]);
  const [draft, setDraft] = useState("");
  const [auto, setAuto] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [msgs]);

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const user: Msg = { id: nextId++, role: "user", text };
    if (/^(audit|check|ពិនិត្យ)/i.test(text)) {
      const s = useProject.getState();
      setMsgs((m) => [...m, user, { id: nextId++, role: "ai", text: "Project audit:", audit: audit(s.project, activeComp(s.project)) }]);
      return;
    }
    const p = makePlan(text);
    if (!p.understood) {
      setMsgs((m) => [...m, user, { id: nextId++, role: "ai", text: `I couldn't map that to editor commands. Try: ${EXAMPLES.slice(0, 4).join(" · ")}`, audit: p.audit }]);
      return;
    }
    const before = useProject.getState().past.length;
    if (auto) runPlan(p);
    setMsgs((m) => [...m, user, { id: nextId++, role: "ai", text: auto ? `Done — ran ${p.steps.length} command(s).` : `Plan ready: ${p.steps.length} command(s). Review, then Apply.`, plan: p, audit: p.audit, status: auto ? "done" : "pending", historyBefore: before }]);
  };

  const setStatus = (id: number, status: Msg["status"], historyBefore?: number): void => setMsgs((m) => m.map((x) => (x.id === id ? { ...x, status, historyBefore: historyBefore ?? x.historyBefore } : x)));

  return (
    <div className="panel-root">
      <div className="panel-bar">
        <Sparkles size={13} color="var(--accent)" />
        <span className="font-medium flex-1">AI Assistant</span>
        <label className="inline-flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-pilot
        </label>
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "self-end max-w-[85%] bg-[#24323a] border border-[#2e4651] rounded-lg px-3 py-1.5" : "self-start max-w-[95%] flex flex-col gap-1.5"}>
            {m.role === "user" ? (
              m.text
            ) : (
              <>
                <div className="bg-[#262626] border border-line rounded-lg px-3 py-1.5 leading-relaxed">{m.text}</div>
                {m.audit && (
                  <div className="bg-[#1a1c21] border border-[#3a3e46] rounded-lg px-3 py-2 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 font-medium"><ShieldCheck size={13} color="var(--accent)" /> Pre-edit audit</div>
                    {m.audit.map((a, i) => (
                      <div key={i} className="flex gap-1.5 text-[11.5px] leading-snug">
                        <span style={{ color: a.level === "warn" ? "#ff9447" : a.level === "ok" ? "var(--ok)" : "#6fa6db" }}>{a.level === "warn" ? "!" : a.level === "ok" ? "✓" : "i"}</span>
                        <span>{a.text}</span>
                      </div>
                    ))}
                    {m.plan?.notes.map((n, i) => (
                      <div key={`n${i}`} className="flex gap-1.5 text-[11.5px] leading-snug"><span style={{ color: "#ff9447" }}>!</span><span>{n}</span></div>
                    ))}
                  </div>
                )}
                {m.plan && m.plan.steps.length > 0 && (
                  <div className="bg-[#1c1e23] border border-[#2e4651] rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 flex flex-col gap-0.5">
                      {m.plan.steps.map((s, i) => (
                        <div key={i} className="mono text-[11px] text-[#c9ccd3]">{m.status === "done" ? "✓ " : "· "}{s.label}</div>
                      ))}
                    </div>
                    {m.status === "pending" && (
                      <div className="flex gap-2 px-3 py-1.5 border-t border-line">
                        <button type="button" className="btn btn-primary flex-1" onClick={() => { const before = useProject.getState().past.length; if (m.plan) runPlan(m.plan); setStatus(m.id, "done", before); }}>Apply {m.plan.steps.length}</button>
                        <button type="button" className="btn" onClick={() => setStatus(m.id, "discarded")}>Discard</button>
                      </div>
                    )}
                    {m.status === "done" && (
                      <div className="flex gap-2 items-center px-3 py-1.5 border-t border-line text-[11px] text-[#8be4f2]">
                        <span className="flex-1">Applied — every step is in History</span>
                        <button type="button" className="btn" style={{ height: 20 }} onClick={() => { useProject.getState().jumpToHistory(m.historyBefore ?? 0); setStatus(m.id, "discarded"); }}>Undo all</button>
                      </div>
                    )}
                    {m.status === "discarded" && <div className="px-3 py-1.5 border-t border-line text-[11px] text-muted">Discarded</div>}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-line flex flex-col gap-1.5">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="btn flex-none" style={{ height: 22, borderRadius: 11 }} onClick={() => setDraft(e)}>{e}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <input className="field flex-1" style={{ height: 28 }} placeholder="Tell the AI what to edit…" aria-label="AI prompt" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") send(); }} />
          <button type="button" className="btn btn-primary" style={{ height: 28 }} aria-label="Send" onClick={send}><Send size={13} /></button>
        </div>
      </div>
    </div>
  );
}
