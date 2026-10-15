import { DockviewDefaultTab, DockviewReact, themeDark, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps } from "dockview-react";
import type { FunctionComponent } from "react";
import { AIPanel } from "../panels/AIPanel";
import { CompositionPanel } from "../panels/CompositionPanel";
import { EffectControlsPanel } from "../panels/EffectControlsPanel";
import { ProjectPanel } from "../panels/ProjectPanel";
import { CharacterPanel, EffectsPresetsPanel, HistoryPanel, InfoPanel, PreviewPanel, RenderQueuePanel } from "../panels/SmallPanels";
import { TimelinePanel } from "../panels/TimelinePanel";
import { restoreLayout, scheduleLayoutSave, setDockApi, toggleMaximize } from "./workspace";

const wrap = (C: FunctionComponent): FunctionComponent<IDockviewPanelProps> => {
  const W: FunctionComponent<IDockviewPanelProps> = () => <C />;
  return W;
};

const components: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  project: wrap(ProjectPanel),
  composition: wrap(CompositionPanel),
  timeline: wrap(TimelinePanel),
  effectControls: wrap(EffectControlsPanel),
  effects: wrap(EffectsPresetsPanel),
  character: wrap(CharacterPanel),
  info: wrap(InfoPanel),
  preview: wrap(PreviewPanel),
  renderQueue: wrap(RenderQueuePanel),
  history: wrap(HistoryPanel),
  ai: wrap(AIPanel),
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

export function Workspace() {
  const onReady = (e: DockviewReadyEvent): void => {
    setDockApi(e.api);
    void restoreLayout();
    e.api.onDidLayoutChange(() => scheduleLayoutSave());
  };
  return (
    <div className="flex-1 min-h-0">
      <DockviewReact
        components={components}
        defaultTabComponent={Tab}
        onReady={onReady}
        theme={theme}
        getTabContextMenuItems={() => ["maximize", "float", "separator", "close"]}
      />
    </div>
  );
}
