import { DockviewDefaultTab, DockviewReact, themeDark, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from "dockview-react";
import { useEffect, useState, type FunctionComponent } from "react";
import { AIPanel } from "../panels/AIPanel";
import { CompositionPanel } from "../panels/CompositionPanel";
import { EffectControlsPanel } from "../panels/EffectControlsPanel";
import { ProjectPanel } from "../panels/ProjectPanel";
import { CharacterPanel, EffectsPresetsPanel, HistoryPanel, InfoPanel, PreviewPanel, RenderQueuePanel } from "../panels/SmallPanels";
import { TimelinePanel } from "../panels/TimelinePanel";
import { diag, PanelBoundary, showErrorBanner } from "./diagnostics";
import { forgetSavedLayout, restoreLayout, scheduleLayoutSave, setDockApi, toggleMaximize } from "./workspace";

const wrap = (C: FunctionComponent, name: string): FunctionComponent<IDockviewPanelProps> => {
  const W: FunctionComponent<IDockviewPanelProps> = () => {
    useEffect(() => diag(`panel mounted: ${name}`), []);
    return (
      <PanelBoundary name={name}>
        <C />
      </PanelBoundary>
    );
  };
  return W;
};

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  project: wrap(ProjectPanel, "Project"),
  composition: wrap(CompositionPanel, "Composition"),
  timeline: wrap(TimelinePanel, "Timeline"),
  effectControls: wrap(EffectControlsPanel, "EffectControls"),
  effects: wrap(EffectsPresetsPanel, "EffectsPresets"),
  character: wrap(CharacterPanel, "Character"),
  info: wrap(InfoPanel, "Info"),
  preview: wrap(PreviewPanel, "Preview"),
  renderQueue: wrap(RenderQueuePanel, "RenderQueue"),
  history: wrap(HistoryPanel, "History"),
  ai: wrap(AIPanel, "AI"),
};

const Tab: FunctionComponent<IDockviewPanelHeaderProps> = (props) => (
  <DockviewDefaultTab
    {...props}
    onDoubleClick={() => {
      props.api.setActive();
      toggleMaximize();
    }}
  />
);

const theme = { ...themeDark, name: "minifx", className: `${themeDark.className} dockview-theme-minifx`, gap: 0 };

/** How many times the dock was rebuilt because its panels never appeared. */
let healAttempts = 0;

export function Workspace() {
  const [generation, setGeneration] = useState(0);
  const onReady = (e: DockviewReadyEvent): void => {
    diag(`dock ready (generation ${generation})`);
    setDockApi(e.api);
    void restoreLayout().then(() => {
      diag(`layout restored: ${e.api.panels.length} panels in ${e.api.groups.length} groups`);
      // Watchdog: dockview draws panels/tabs through React portals. If none show up,
      // throw away the saved layout and remount the dock instead of leaving a blank window.
      window.setTimeout(() => {
        const tabs = document.querySelectorAll(".dv-tab").length;
        diag(`watchdog: ${tabs} tabs visible, ${e.api.panels.length} panels`);
        if (tabs > 0 || e.api.panels.length === 0) return;
        if (healAttempts < 2) {
          healAttempts++;
          diag(`watchdog: panels missing, rebuilding dock (attempt ${healAttempts})`);
          void forgetSavedLayout().then(() => setGeneration((g) => g + 1));
        } else {
          showErrorBanner("Panels did not render", `${e.api.panels.length} panels were created but none appeared on screen.`);
        }
      }, 2500);
    });
    e.api.onDidLayoutChange(() => scheduleLayoutSave());
  };
  return (
    <div className="flex-1 min-h-0">
      <DockviewReact
        key={generation}
        components={components}
        defaultTabComponent={Tab}
        onReady={onReady}
        theme={theme}
        getTabContextMenuItems={() => ["maximize", "float", "separator", "close"]}
      />
    </div>
  );
}
