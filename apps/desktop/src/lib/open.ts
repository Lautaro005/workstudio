import { openUrl as tauriOpenUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { inTauri } from "./api";

export async function openUrl(url: string) {
  if (!url) return;
  if (!inTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  await tauriOpenUrl(url);
}

export async function reveal(path: string) {
  if (!inTauri || !path) return;
  await revealItemInDir(path);
}
