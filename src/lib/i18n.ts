import { useSettings } from "../store/settingsStore";

const KM: Record<string, string> = {
  File: "ឯកសារ",
  Edit: "កែសម្រួល",
  Composition: "សមាសភាព",
  Layer: "ស្រទាប់",
  Effect: "Effect",
  Window: "បង្អួច",
  Help: "ជំនួយ",
  Project: "គម្រោង",
  Timeline: "Timeline",
  "Effect Controls": "ការកំណត់ Effect",
  "Effects & Presets": "Effects & Presets",
  Character: "អក្សរ",
  Info: "ព័ត៌មាន",
  Preview: "មើលជាមុន",
  "Render Queue": "ជួរ Render",
  History: "ប្រវត្តិ",
  "AI Assistant": "ជំនួយការ AI",
  "New Project": "គម្រោងថ្មី",
  "Open Project…": "បើកគម្រោង…",
};

export function t(s: string): string {
  return useSettings.getState().language === "km" ? (KM[s] ?? s) : s;
}
