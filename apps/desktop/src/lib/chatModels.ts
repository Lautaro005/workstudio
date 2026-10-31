// Which chat models show in the picker: the detected ones minus the hidden ones, plus the ones added by hand
// (Settings → Models).
import type { ChatModel, Settings } from "./api";

/** Providers whose CLI takes any model id, so models can be added by hand. */
export const CUSTOM_PROVIDERS: { group: string; prefix: string; example: string }[] = [
  { group: "Claude Code", prefix: "claude", example: "claude-opus-5-5" },
  { group: "Codex", prefix: "codex", example: "gpt-6.1-sol" },
  { group: "Gemini", prefix: "gemini", example: "gemini-2.5-pro" },
];

export const groupOf = (id: string) => CUSTOM_PROVIDERS.find((p) => id.startsWith(`${p.prefix}:`))?.group ?? "Claude Code";

export function customModels(settings: Settings | null): ChatModel[] {
  return (settings?.chat_custom_models ?? []).map((m) => ({ id: m.id, name: m.name || m.id.split(":").slice(1).join(":"), group: groupOf(m.id), tools: true }));
}

/** Every model (detected + added), in provider order, each added one after its provider's detected ones. */
export function allModels(detected: ChatModel[], settings: Settings | null): ChatModel[] {
  const extra = customModels(settings).filter((c) => !detected.some((d) => d.id === c.id));
  const out = [...detected];
  for (const c of extra) {
    const last = out.map((m) => m.group).lastIndexOf(c.group);
    if (last >= 0) out.splice(last + 1, 0, c);
    else out.push(c);
  }
  return out;
}

export function visibleModels(detected: ChatModel[], settings: Settings | null): ChatModel[] {
  const hidden = new Set(settings?.chat_hidden_models ?? []);
  return allModels(detected, settings).filter((m) => !hidden.has(m.id));
}
