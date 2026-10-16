import { MessageCircle, Sparkles } from "lucide-react";
import { AIChat } from "../ai/AIChat";
import { useChat } from "../ai/chatStore";

/** Docked version of the AI chat (same conversation as the pop-up bubble). */
export function AIPanel() {
  const auto = useChat((s) => s.auto);
  const setAuto = useChat((s) => s.setAuto);
  const setOpen = useChat((s) => s.setOpen);
  return (
    <div className="panel-root">
      <div className="panel-bar">
        <Sparkles size={13} color="var(--accent)" />
        <span className="font-medium flex-1">AI Assistant</span>
        <label className="inline-flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-pilot
        </label>
        <button type="button" className="icon-btn" title="Open as chat bubble" aria-label="Open chat pop-up" onClick={() => setOpen(true)}>
          <MessageCircle size={14} />
        </button>
      </div>
      <AIChat />
    </div>
  );
}
