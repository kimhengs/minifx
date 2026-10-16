import { Component, type ErrorInfo, type ReactNode } from "react";
import { backend } from "../lib/backend";

/** Startup / runtime diagnostics. Everything goes to minifx.log and errors are shown on screen. */

const lines: string[] = [];

export function diag(msg: string): void {
  const line = `[ui ${Math.round(performance.now())}ms] ${msg}`;
  lines.push(line);
  if (lines.length > 200) lines.shift();
  try {
    console.info(line);
    void backend.log(line).catch(() => undefined);
  } catch {
    /* logging must never throw */
  }
}

export function diagLines(): string[] {
  return lines.slice();
}

/** Red banner drawn with plain DOM so it appears even if React is broken. */
export function showErrorBanner(title: string, detail: string): void {
  diag(`ERROR ${title}: ${detail}`);
  let box = document.getElementById("minifx-error-banner");
  if (!box) {
    box = document.createElement("div");
    box.id = "minifx-error-banner";
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-height:40vh;overflow:auto;background:#3a1114;border:1px solid #e5484d;color:#ffd7d9;font:12px/1.5 'JetBrains Mono',monospace;padding:10px 12px;border-radius:6px;white-space:pre-wrap;user-select:text";
    const close = document.createElement("button");
    close.textContent = "✕";
    close.style.cssText = "position:sticky;float:right;top:0;background:none;border:0;color:#ffd7d9;cursor:pointer;font-size:14px";
    close.onclick = () => box?.remove();
    box.appendChild(close);
    const hint = document.createElement("div");
    hint.style.cssText = "opacity:.8;margin-bottom:6px";
    hint.textContent = "MiniFX hit an error. Please send a screenshot of this box (F12 opens developer tools).";
    box.appendChild(hint);
    document.body.appendChild(box);
  }
  const item = document.createElement("div");
  item.textContent = `• ${title}\n${detail.slice(0, 1500)}`;
  item.style.marginTop = "6px";
  box.appendChild(item);
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (e) => {
    const err = e.error as Error | undefined;
    showErrorBanner(e.message || "Script error", err?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as unknown;
    const msg = r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r);
    // IPC/media failures are reported via toasts elsewhere; still log them, but only banner real crashes.
    diag(`unhandled rejection: ${msg}`);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
      e.preventDefault();
      void backend.openDevtools();
    }
  });
  diag(`boot ua="${navigator.userAgent}" dpr=${window.devicePixelRatio} size=${window.innerWidth}x${window.innerHeight}`);
}

interface BoundaryProps {
  name: string;
  children: ReactNode;
}
interface BoundaryState {
  error: Error | null;
}

/** Keeps one broken panel from taking down the whole window, and shows why it broke. */
export class PanelBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    diag(`panel "${this.props.name}" crashed: ${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-full overflow-auto p-3 text-xs" style={{ color: "#ffb4b8", fontFamily: "JetBrains Mono, monospace", whiteSpace: "pre-wrap" }}>
        <div className="mb-2" style={{ color: "#fff" }}>
          {this.props.name} panel error
        </div>
        {error.message}
        {"\n\n"}
        {error.stack?.split("\n").slice(0, 8).join("\n")}
        <div className="mt-3">
          <button className="px-2 py-1 rounded" style={{ background: "#333", color: "#ddd" }} onClick={() => this.setState({ error: null })}>
            Retry
          </button>
        </div>
      </div>
    );
  }
}
