import { useEffect } from "react";
import { backend } from "../lib/backend";
import { perf } from "../lib/perf";
import { autosaveNow, checkRecovery, confirmDiscard, importFiles, markCleanExit, openProject, startAutosave } from "../lib/projectIO";
import { useSettings } from "../store/settingsStore";
import { useUi } from "../store/uiStore";
import { comboFromEvent, findActionForCombo } from "./actions";
import { maybeRunSelfTest } from "../lib/selftest";
import { Dialogs, Toasts } from "./Dialogs";
import { keyState } from "./keyState";
import { togglePlay } from "./playback";
import { StartScreen } from "./StartScreen";
import { TitleBar } from "./TitleBar";
import { Workspace } from "./Workspace";
import { ChatPopup } from "./ChatPopup";
import { diag } from "./diagnostics";

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function App() {
  const startScreen = useUi((s) => s.startScreen);
  useEffect(() => diag(`view: ${startScreen ? "start screen" : "workspace"}`), [startScreen]);

  // boot: settings, launch file (double-clicked .msproj), crash recovery, autosave
  useEffect(() => {
    void (async () => {
      diag("boot: loading settings");
      await useSettings.getState().load();
      const launch = await backend.launchFile();
      diag(`boot: settings ok, launch file=${launch ?? "none"}`);
      if (launch) await openProject(launch);
      else if (await checkRecovery()) useUi.getState().set({ dialog: "recovery" });
      startAutosave();
      perf.mark("ready");
      diag("boot: ready");
      void maybeRunSelfTest();
    })();
    void backend.onFileDrop((paths) => {
      const proj = paths.find((p) => p.toLowerCase().endsWith(".msproj"));
      if (proj) {
        void confirmDiscard().then((ok) => ok && void openProject(proj));
        return;
      }
      void importFiles(paths.map((p) => ({ path: p, name: p.split(/[\\/]/).pop() ?? p })));
    });
    void backend.onCloseRequested(async () => {
      const ok = await confirmDiscard().catch(() => true);
      if (ok) {
        // Never let bookkeeping block quitting.
        await Promise.race([markCleanExit().catch(() => undefined), new Promise((r) => window.setTimeout(r, 1500))]);
        diag("quit");
      }
      return ok;
    });
    if (backend.isDesktopApp()) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<string>("open-project", (e) => {
          void confirmDiscard().then((ok) => ok && void openProject(e.payload));
        }),
      );
    }
    const onHide = (): void => void autosaveNow();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // global keyboard shortcuts (customizable in Preferences)
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (isTyping(e) || useUi.getState().dialog) return;
      if (e.code === "Space" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (!keyState.spaceDown) {
          keyState.spaceDown = true;
          keyState.spaceUsed = false;
        }
        return;
      }
      const combo = comboFromEvent(e);
      const action = findActionForCombo(combo);
      if (!action) return;
      if (useUi.getState().startScreen && !action.id.startsWith("file.") && !action.id.startsWith("edit.preferences")) return;
      e.preventDefault();
      if (!action.enabled || action.enabled()) action.run();
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      const wasDown = keyState.spaceDown;
      keyState.spaceDown = false;
      if (wasDown && !keyState.spaceUsed && !isTyping(e) && !useUi.getState().startScreen && !useUi.getState().dialog) togglePlay();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <div className="h-full flex flex-col font-ui" onContextMenu={(e) => e.preventDefault()}>
      <TitleBar />
      {startScreen ? <StartScreen /> : <Workspace />}
      {!startScreen && <ChatPopup />}
      <Dialogs />
      <Toasts />
    </div>
  );
}
