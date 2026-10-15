import { create } from "zustand";
import { backend } from "../lib/backend";

export type Language = "en" | "km";

export interface Settings {
  cacheMB: number;
  autosaveMinutes: number;
  proxyEnabled: boolean;
  proxyThresholdHeight: number;
  proxyHeight: number;
  accent: string;
  language: Language;
  shortcuts: Record<string, string>;
  recentFiles: string[];
  showInfoPerf: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  cacheMB: 1024,
  autosaveMinutes: 2,
  proxyEnabled: true,
  proxyThresholdHeight: 1440,
  proxyHeight: 540,
  accent: "#3d8bfd",
  language: "en",
  shortcuts: {},
  recentFiles: [],
  showInfoPerf: true,
};

interface SettingsState extends Settings {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
  addRecent: (path: string) => void;
}

const FILE = "settings.json";

function persist(s: Settings): void {
  const data: Settings = {
    cacheMB: s.cacheMB,
    autosaveMinutes: s.autosaveMinutes,
    proxyEnabled: s.proxyEnabled,
    proxyThresholdHeight: s.proxyThresholdHeight,
    proxyHeight: s.proxyHeight,
    accent: s.accent,
    language: s.language,
    shortcuts: s.shortcuts,
    recentFiles: s.recentFiles,
    showInfoPerf: s.showInfoPerf,
  };
  void backend.appDataWrite(FILE, JSON.stringify(data, null, 1));
}

export function applyAccent(color: string): void {
  document.documentElement.style.setProperty("--accent", color);
}

export const useSettings = create<SettingsState>()((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const raw = await backend.appDataRead(FILE);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        set({ ...DEFAULT_SETTINGS, ...parsed, loaded: true });
      } else set({ loaded: true });
    } catch {
      set({ loaded: true });
    }
    applyAccent(get().accent);
  },
  update: (patch) => {
    set(patch);
    if (patch.accent) applyAccent(patch.accent);
    persist(get());
  },
  addRecent: (path) => {
    const list = [path, ...get().recentFiles.filter((p) => p !== path)].slice(0, 10);
    set({ recentFiles: list });
    persist(get());
  },
}));
