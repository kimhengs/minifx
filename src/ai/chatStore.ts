import { create } from "zustand";
import { activeComp, useProject } from "../store/projectStore";
import { audit, plan as makePlan, runPlan, type AuditItem, type Plan } from "./assistant";

/** One conversation shared by the AI panel and the Messenger-style pop-up. */
export interface ChatMsg {
  id: number;
  role: "user" | "ai";
  text: string;
  time: number;
  plan?: Plan;
  audit?: AuditItem[];
  status?: "pending" | "done" | "discarded";
  historyBefore?: number;
}

export const QUICK_REPLIES = [
  'ដាក់អក្សរ "Siem Reap Vlog" លេចឡើង',
  "ពន្លឺលើអក្សរ",
  "TikTok comp 15s",
  "កាត់នៅ 0:05",
  "បង្វិល logo",
  "ពិនិត្យ",
  "export",
];

/** Khmer editing words → the English keywords the planner understands. */
const KHMER: [RegExp, string][] = [
  [/ពិនិត្យ|ត្រួតពិនិត្យ/g, " audit "],
  [/(ដាក់|បន្ថែម|បង្កើត)\s*(អក្សរ|ចំណងជើង|ពាក្យ|អត្ថបទ)/g, " add text "],
  [/អក្សរ|ចំណងជើង|ពាក្យ|អត្ថបទ/g, " text "],
  [/លេចឡើង|ចូលបន្តិចម្តងៗ|ចូល/g, " fade in "],
  [/បាត់ទៅ|រលាយ|ចេញ/g, " fade out "],
  [/ពន្លឺ|ភ្លឺ/g, " glow "],
  [/ស្រមោល/g, " drop shadow "],
  [/ព្រិល|ស្រអាប់/g, " blur "],
  [/កាត់|បំបែក/g, " split "],
  [/បង្វិល|វិល/g, " spin "],
  [/លោត|ផុស/g, " pop in "],
  [/រំកិលពីឆ្វេង|រអិលពីឆ្វេង/g, " slide left "],
  [/ឡើងលើ/g, " rise up "],
  [/ពង្រីក|ហ្សូម/g, " ken burns "],
  [/ញ័រ|រញ្ជួយ/g, " wiggle "],
  [/ពណ៌|ពណ៍/g, " color "],
  [/ថ្លា|ភាពថ្លា/g, " opacity "],
  [/ទំហំ|ធំ|តូច/g, " scale "],
  [/លុប/g, " delete "],
  [/រូបរាង|ប្រអប់|ការ៉េ/g, " shape rectangle "],
  [/រង្វង់/g, " shape ellipse "],
  [/ផ្ទៃ|ផ្ទៃខាងក្រោយ/g, " solid "],
  [/នាំចេញ|បញ្ចេញ/g, " export "],
  [/\s*វិនាទី/g, "s "],
  [/នៅ|ត្រង់/g, " at "],
  [/ថ្មី/g, " new "],
];

/** Translates Khmer keywords outside quotes; quoted text (titles, names) is kept exactly as typed. */
export function translateKhmer(text: string): string {
  return text
    .split(/(["“][^"”]*["”])/)
    .map((part) => {
      if (/^["“]/.test(part)) return part;
      let t = part;
      for (const [re, en] of KHMER) t = t.replace(re, en);
      return t;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

interface ChatState {
  msgs: ChatMsg[];
  auto: boolean;
  typing: boolean;
  unread: number;
  open: boolean;
  setAuto: (v: boolean) => void;
  setOpen: (v: boolean) => void;
  send: (text: string) => void;
  apply: (id: number) => void;
  discard: (id: number) => void;
  undoAll: (id: number) => void;
  clear: () => void;
}

let nextId = 1;
const welcome = (): ChatMsg => ({
  id: nextId++,
  role: "ai",
  time: Date.now(),
  text: "សួស្តី! 👋 ខ្ញុំជា MiniFX AI។ ប្រាប់ខ្ញុំថាចង់កែអ្វី (ខ្មែរ ឬ English)។ ខ្ញុំពិនិត្យ Project មុន ហើយបង្ហាញជំហាននីមួយៗ មុនពេលកែអ្វីទាំងអស់។",
});

export const useChat = create<ChatState>((set, get) => ({
  msgs: [welcome()],
  auto: false,
  typing: false,
  unread: 0,
  open: false,
  setAuto: (auto) => set({ auto }),
  setOpen: (open) => set({ open, unread: open ? 0 : get().unread }),
  clear: () => set({ msgs: [welcome()] }),

  send: (raw) => {
    const text = raw.trim();
    if (!text) return;
    const user: ChatMsg = { id: nextId++, role: "user", text, time: Date.now() };
    set((s) => ({ msgs: [...s.msgs, user], typing: true }));
    // a short "typing…" beat so replies feel like a conversation
    window.setTimeout(() => {
      const reply = respond(text, get().auto);
      set((s) => ({ msgs: [...s.msgs, reply], typing: false, unread: s.open ? 0 : s.unread + 1 }));
    }, 450);
  },

  apply: (id) => {
    const m = get().msgs.find((x) => x.id === id);
    if (!m?.plan) return;
    const before = useProject.getState().past.length;
    runPlan(m.plan);
    patch(set, id, { status: "done", historyBefore: before });
  },
  discard: (id) => patch(set, id, { status: "discarded" }),
  undoAll: (id) => {
    const m = get().msgs.find((x) => x.id === id);
    useProject.getState().jumpToHistory(m?.historyBefore ?? 0);
    patch(set, id, { status: "discarded" });
  },
}));

function patch(set: (fn: (s: ChatState) => Partial<ChatState>) => void, id: number, p: Partial<ChatMsg>): void {
  set((s) => ({ msgs: s.msgs.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
}

function respond(text: string, auto: boolean): ChatMsg {
  const base = { id: nextId++, role: "ai" as const, time: Date.now() };
  const prompt = translateKhmer(text);
  if (/^(audit|check)\b/i.test(prompt)) {
    const s = useProject.getState();
    return { ...base, text: "នេះជាលទ្ធផលពិនិត្យ Project៖", audit: audit(s.project, activeComp(s.project)) };
  }
  if (/^(hi|hello|hey|សួស្តី|ជំរាបសួរ)/i.test(text)) {
    return { ...base, text: "សួស្តី! សាកនិយាយថា៖ ដាក់អក្សរ \"Hello\" លេចឡើង · ពន្លឺលើអក្សរ · កាត់នៅ 0:05 · TikTok comp 15s" };
  }
  const p = makePlan(prompt);
  if (!p.understood) {
    return { ...base, text: `ខ្ញុំមិនទាន់យល់សំណើនេះទេ 🙏 សាក៖ ${QUICK_REPLIES.slice(0, 4).join(" · ")}`, audit: p.audit };
  }
  const before = useProject.getState().past.length;
  if (auto) runPlan(p);
  return {
    ...base,
    text: auto ? `រួចរាល់ ✓ បានធ្វើ ${p.steps.length} ជំហាន។` : `ខ្ញុំរៀបចំបាន ${p.steps.length} ជំហាន។ សូមពិនិត្យ រួចចុច Apply។`,
    plan: p,
    audit: p.audit,
    status: auto ? "done" : "pending",
    historyBefore: before,
  };
}
