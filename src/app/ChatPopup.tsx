import { useEffect } from "react";
import { Minus, RotateCcw, Sparkles, X } from "lucide-react";
import { AIChat } from "../ai/AIChat";
import { useChat } from "../ai/chatStore";

/**
 * Messenger-style AI chat: a floating bubble in the bottom-right corner that opens a chat window.
 * The conversation is shared with the docked AI Assistant panel. Nothing mounts until it is opened.
 */
export function ChatPopup() {
  const open = useChat((s) => s.open);
  const unread = useChat((s) => s.unread);
  const setOpen = useChat((s) => s.setOpen);
  const auto = useChat((s) => s.auto);
  const setAuto = useChat((s) => s.setAuto);
  const clear = useChat((s) => s.clear);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  return (
    <>
      {open && (
        <div className="chat-window" role="dialog" aria-label="MiniFX AI chat">
          <div className="chat-header">
            <span className="chat-avatar chat-avatar-lg" aria-hidden>
              <Sparkles size={16} />
              <span className="chat-online" />
            </span>
            <div className="flex-1 min-w-0 leading-tight">
              <div className="font-semibold text-[13.5px]">MiniFX AI</div>
              <div className="text-[11px] text-[#9fd8a8]">● Online · កែវីដេអូតាមសារ</div>
            </div>
            <label className="chat-auto" title="Auto-pilot: run plans without asking">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto
            </label>
            <button type="button" className="chat-hbtn" title="New chat" aria-label="New chat" onClick={clear}><RotateCcw size={15} /></button>
            <button type="button" className="chat-hbtn" title="Minimize (Esc)" aria-label="Minimize" onClick={() => setOpen(false)}><Minus size={16} /></button>
            <button type="button" className="chat-hbtn" title="Close" aria-label="Close chat" onClick={() => setOpen(false)}><X size={16} /></button>
          </div>
          <AIChat bubbleStyle autoFocus />
        </div>
      )}
      <button type="button" className="chat-fab" data-open={open} aria-label={open ? "Close AI chat" : "Open AI chat"} title="AI Chat (F1)" onClick={() => setOpen(!open)}>
        {open ? <X size={24} /> : <Sparkles size={24} />}
        {!open && unread > 0 && <span className="chat-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
    </>
  );
}
