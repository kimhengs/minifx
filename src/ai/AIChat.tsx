import { useEffect, useRef, useState } from "react";
import { Send, ShieldCheck, Sparkles } from "lucide-react";
import { QUICK_REPLIES, useChat, type ChatMsg } from "./chatStore";

const timeOf = (t: number): string => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Chat conversation UI, used both docked (AI panel) and in the Messenger-style pop-up. */
export function AIChat({ bubbleStyle = false, autoFocus = false }: { bubbleStyle?: boolean; autoFocus?: boolean }) {
  const msgs = useChat((s) => s.msgs);
  const typing = useChat((s) => s.typing);
  const send = useChat((s) => s.send);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, typing]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = (): void => {
    if (!draft.trim()) return;
    send(draft);
    setDraft("");
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2" style={{ background: bubbleStyle ? "#17181c" : undefined }}>
        {msgs.map((m, i) => (
          <Message key={m.id} m={m} showAvatar={bubbleStyle && m.role === "ai" && msgs[i + 1]?.role !== "ai"} bubbleStyle={bubbleStyle} />
        ))}
        {typing && (
          <div className="flex items-end gap-2">
            {bubbleStyle && <Avatar />}
            <div className="chat-typing"><span /><span /><span /></div>
          </div>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-2 pt-2 pb-1 border-t border-line flex-none">
        {QUICK_REPLIES.map((q) => (
          <button key={q} type="button" className="chat-chip" onClick={() => send(q)}>{q}</button>
        ))}
      </div>
      <div className="flex items-end gap-1.5 p-2 flex-none">
        <textarea
          ref={inputRef}
          rows={1}
          className="chat-input"
          placeholder="សរសេរសារ… (Enter ផ្ញើ · Shift+Enter ចុះបន្ទាត់)"
          aria-label="AI prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="chat-send" aria-label="Send" disabled={!draft.trim()} onClick={submit}>
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <span className="chat-avatar" aria-hidden>
      <Sparkles size={13} />
    </span>
  );
}

function Message({ m, showAvatar, bubbleStyle }: { m: ChatMsg; showAvatar: boolean; bubbleStyle: boolean }) {
  const apply = useChat((s) => s.apply);
  const discard = useChat((s) => s.discard);
  const undoAll = useChat((s) => s.undoAll);
  if (m.role === "user") {
    return (
      <div className="self-end flex flex-col items-end max-w-[80%]">
        <div className="chat-bubble chat-bubble-user">{m.text}</div>
        <span className="chat-time">{timeOf(m.time)}</span>
      </div>
    );
  }
  return (
    <div className="self-start flex items-end gap-2 max-w-[92%]">
      {bubbleStyle && (showAvatar ? <Avatar /> : <span className="w-[26px] flex-none" />)}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="chat-bubble chat-bubble-ai">{m.text}</div>
        {m.audit && m.audit.length > 0 && (
          <div className="chat-card">
            <div className="flex items-center gap-1.5 font-medium mb-1"><ShieldCheck size={13} color="var(--accent)" /> ពិនិត្យមុនកែ (Audit)</div>
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
          <div className="chat-card p-0 overflow-hidden">
            <div className="px-3 py-2 flex flex-col gap-0.5">
              {m.plan.steps.map((s, i) => (
                <div key={i} className="text-[11.5px] text-[#c9ccd3] leading-snug">{m.status === "done" ? "✓ " : `${i + 1}. `}{s.label}</div>
              ))}
            </div>
            {m.status === "pending" && (
              <div className="flex gap-2 px-3 py-2 border-t border-line">
                <button type="button" className="btn btn-primary flex-1" onClick={() => apply(m.id)}>Apply ({m.plan.steps.length})</button>
                <button type="button" className="btn" onClick={() => discard(m.id)}>បោះបង់</button>
              </div>
            )}
            {m.status === "done" && (
              <div className="flex gap-2 items-center px-3 py-1.5 border-t border-line text-[11px] text-[#8be4f2]">
                <span className="flex-1">បានអនុវត្ត ✓ (មើលក្នុង History)</span>
                <button type="button" className="btn" style={{ height: 20 }} onClick={() => undoAll(m.id)}>Undo ទាំងអស់</button>
              </div>
            )}
            {m.status === "discarded" && <div className="px-3 py-1.5 border-t border-line text-[11px] text-muted">បានបោះបង់</div>}
          </div>
        )}
        <span className="chat-time">{timeOf(m.time)}</span>
      </div>
    </div>
  );
}
