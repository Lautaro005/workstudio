// The message box, in the style of Claude's: files, the working folder, skills and the @agent go
// in chips above the text; "+" adds files, a folder, skills or an OpenCue agent; "/" picks a skill
// and "@" an agent as you type; the pills turn brain, Lumina and the web on; the model sits on
// the right next to Send.
import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, AtSign, Bot, Brain, Check, ChevronDown, ChevronRight, Folder, FolderPlus, Globe, Lock, NotebookPen, Notebook, Paperclip, Pencil, Plus, Square, Zap, Settings as Gear } from "../icons";
import { call, inTauri, type Attachment, type ChatModel, type OpenCueAgent, type Skill } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import { Glyph, usePopover } from "../ui";
import { FileChip, GROUP_LOOK } from "./Message";

export type Draft = { text: string; files: Attachment[]; skills: string[]; folder: string; mode: string; agent: string };
export const emptyDraft = (): Draft => ({ text: "", files: [], skills: [], folder: "", mode: "read", agent: "" });

export type Pill = { id: string; label: string; icon: typeof Brain; tone: string; app?: string };
export const PILLS: Pill[] = [
  { id: "brain", label: "brain", icon: Brain, tone: "clay", app: "brain" },
  { id: "lumina", label: "Lumina", icon: NotebookPen, tone: "mustard", app: "lumina" },
  { id: "openblocks", label: "OpenBlocks", icon: Notebook, tone: "ink", app: "openblocks" },
  { id: "web", label: "Web", icon: Globe, tone: "olive" },
];

/** Skills keep the order they came in (already sorted by tool); this lists them under their titles. */
const groupOf = (s: Skill) => s.group || "Skills";
function GroupedSkills({ items, render }: { items: Skill[]; render: (s: Skill, i: number) => React.ReactNode }) {
  let last = "";
  return (
    <>
      {items.map((s, i) => {
        const g = groupOf(s);
        const head = g !== last;
        last = g;
        return (
          <div key={s.path} className="skill-row">
            {head && <div className="menu-label group-title">{g}</div>}
            {render(s, i)}
          </div>
        );
      })}
    </>
  );
}

const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export function ModelPicker({ models, value, onChange, loading, up = true }: { models: ChatModel[]; value: string; onChange: (id: string) => void; loading: boolean; up?: boolean }) {
  const pop = usePopover();
  const t = useT();
  const cur = models.find((m) => m.id === value);
  const groups = [...new Set(models.map((m) => m.group))];
  const look = GROUP_LOOK[cur?.group ?? ""] ?? ["box", "ink"];
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button type="button" className="model-btn" onClick={() => pop.setOpen(!pop.open)} aria-haspopup="listbox" aria-expanded={pop.open}>
        {cur ? <Glyph icon={look[0]} color={look[1]} className="xs" /> : <Bot size={15} />}
        <span>{cur ? (cur.group === "OpenCue" ? t("Agente {name}", { name: cur.name }) : cur.name) : loading ? t("Buscando modelos…") : t("Elegí un modelo")}</span>
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <div className={`popover menu model-menu ${up ? "" : "down"}`} role="listbox">
          {models.length === 0 && <div className="menu-label">{loading ? t("Buscando modelos…") : t("No encontré modelos. Instalá Claude Code, Codex, Gemini u Ollama.")}</div>}
          {groups.map((g) => (
            <div key={g}>
              <div className="menu-label">{g === "OpenCue" ? t("Agentes de OpenCue") : g}</div>
              {models
                .filter((m) => m.group === g)
                .map((m) => {
                  const l = GROUP_LOOK[m.group] ?? ["box", "ink"];
                  return (
                    <button key={m.id} role="option" aria-selected={m.id === value} className={`menu-item ${m.id === value ? "sel" : ""}`} onClick={() => (pop.setOpen(false), onChange(m.id))}>
                      <Glyph icon={l[0]} color={l[1]} className="xs" />
                      {m.name}
                      {!m.tools && m.group !== "OpenCue" && <span className="muted">{t("sin herramientas")}</span>}
                      {m.id === value && <Check size={14} style={{ marginLeft: m.tools || m.group === "OpenCue" ? "auto" : 6 }} />}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Suggest = { kind: "skill" | "agent"; query: string; start: number };

export function Composer({
  draft,
  setDraft,
  models,
  model,
  onModel,
  loadingModels,
  tools,
  onToggleTool,
  pillReady,
  canTools,
  skills,
  agents,
  running,
  onSend,
  onStop,
  onManageSkills,
  placeholder,
  autoFocus,
  hint,
}: {
  draft: Draft;
  setDraft: (d: Draft | ((d: Draft) => Draft)) => void;
  models: ChatModel[];
  model: string;
  onModel: (id: string) => void;
  loadingModels: boolean;
  tools: string[];
  onToggleTool: (id: string) => void;
  pillReady: (p: Pill) => boolean;
  canTools: boolean;
  skills: Skill[];
  agents: OpenCueAgent[];
  running: boolean;
  onSend: () => void;
  onStop: () => void;
  onManageSkills: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const input = useRef<HTMLTextAreaElement>(null);
  const plus = usePopover();
  const [sub, setSub] = useState<"" | "skills" | "agents">("");
  const [sug, setSug] = useState<Suggest | null>(null);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [draft.text]);
  useEffect(() => {
    const h = () => input.current?.focus();
    window.addEventListener("ws-focus-composer", h);
    return () => window.removeEventListener("ws-focus-composer", h);
  }, []);
  useEffect(() => {
    if (!plus.open) setSub("");
  }, [plus.open]);

  const addFiles = async () => {
    plus.setOpen(false);
    if (!inTauri) {
      setDraft((d) => ({ ...d, files: [...d.files, { name: "notas.md", path: "/Users/you/notas.md", kind: "text", size: 2048 }] }));
      return;
    }
    const picked = await openDialog({ multiple: true, directory: false });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const got = await call<Attachment[]>("files_inspect", { paths });
    setDraft((d) => ({ ...d, files: [...d.files, ...got.filter((g) => !d.files.some((f) => f.path === g.path))] }));
  };
  const pickFolder = async () => {
    plus.setOpen(false);
    if (!inTauri) {
      setDraft((d) => ({ ...d, folder: "~/Proyectos/demo" }));
      return;
    }
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") setDraft((d) => ({ ...d, folder: picked }));
  };
  const toggleSkill = (path: string) => setDraft((d) => ({ ...d, skills: d.skills.includes(path) ? d.skills.filter((s) => s !== path) : [...d.skills, path] }));

  const onPaste = async (e: React.ClipboardEvent) => {
    const items = [...e.clipboardData.items].filter((i) => i.kind === "file");
    if (!items.length) return;
    e.preventDefault();
    for (const it of items) {
      const file = it.getAsFile();
      if (!file) continue;
      if (file.size > 25_000_000) {
        toast(t("El archivo es muy grande"), "error");
        continue;
      }
      const data = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(file);
      });
      try {
        const a = await call<Attachment>("files_save_blob", { name: file.name || "pegado.png", data });
        if (a) setDraft((d) => ({ ...d, files: [...d.files, a] }));
      } catch (err) {
        toast(String(err), "error");
      }
    }
  };

  // "/skill" and "@agent" as you type.
  const detect = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(^|\s)([/@])([\w.-]*)$/.exec(before);
    if (!m) return setSug(null);
    const kind = m[2] === "/" ? "skill" : "agent";
    if (kind === "agent" && !agents.length) return setSug(null);
    if (kind === "skill" && !skills.length) return setSug(null);
    setSug({ kind, query: m[3].toLowerCase(), start: caret - m[3].length - 1 });
    setSel(0);
  };
  const options =
    sug?.kind === "skill"
      ? skills.filter((s) => !sug.query || `${s.name} ${s.description} ${groupOf(s)}`.toLowerCase().includes(sug.query)).slice(0, 60)
      : sug?.kind === "agent"
        ? agents.filter((a) => a.name.toLowerCase().includes(sug.query)).slice(0, 8)
        : [];
  const choose = (i: number) => {
    if (!sug) return;
    const o = options[i];
    if (!o) return;
    const caret = input.current?.selectionStart ?? draft.text.length;
    const text = (draft.text.slice(0, sug.start) + draft.text.slice(caret)).replace(/^\s+/, "");
    if (sug.kind === "skill") {
      const s = o as Skill;
      setDraft((d) => ({ ...d, text, skills: d.skills.includes(s.path) ? d.skills : [...d.skills, s.path] }));
    } else {
      setDraft((d) => ({ ...d, text, agent: (o as OpenCueAgent).name }));
    }
    setSug(null);
    setTimeout(() => input.current?.focus(), 0);
  };

  const skillName = (p: string) => skills.find((s) => s.path === p)?.name ?? baseName(p.replace(/[\\/]SKILL\.md$/, ""));
  const canSend = (!!draft.text.trim() || draft.files.length > 0) && (!!model || !!draft.agent);
  const chips = draft.files.length > 0 || !!draft.folder || draft.skills.length > 0 || !!draft.agent;

  return (
    <div className="composer-wrap">
      <div className="composer">
        {sug && options.length > 0 && (
          <div className="popover menu suggest-menu" role="listbox">
            {sug.kind === "skill" ? (
              <div className="menu-scroll">
                <GroupedSkills
                  items={options as Skill[]}
                  render={(o, i) => (
                    <button className={`menu-item ${i === sel ? "sel" : ""}`} onMouseDown={(e) => (e.preventDefault(), choose(i))} onMouseEnter={() => setSel(i)}>
                      <Zap />
                      <span className="sug-txt">
                        <b>/{o.name}</b>
                        {o.description && <span className="muted">{o.description}</span>}
                      </span>
                    </button>
                  )}
                />
              </div>
            ) : (
              <>
                <div className="menu-label">{t("Agentes de OpenCue")}</div>
                {options.map((o, i) => (
                  <button key={i} className={`menu-item ${i === sel ? "sel" : ""}`} onMouseDown={(e) => (e.preventDefault(), choose(i))} onMouseEnter={() => setSel(i)}>
                    <Glyph icon="opencue" color="olive" className="xs" />
                    <span className="sug-txt">
                      <b>@{(o as OpenCueAgent).name}</b>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
        {chips && (
          <div className="composer-chips">
            {draft.agent && (
              <span className="tag-chip olive" title={t("El mensaje va a este agente de OpenCue")}>
                <AtSign /> {draft.agent}
                <button onClick={() => setDraft((d) => ({ ...d, agent: "" }))} aria-label={t("Quitar")}>
                  ×
                </button>
              </span>
            )}
            {draft.folder && (
              <span className="tag-chip ink folder-chip" title={draft.folder}>
                <Folder /> {baseName(draft.folder)}
                <button className="mode-toggle" onClick={() => setDraft((d) => ({ ...d, mode: d.mode === "edit" ? "read" : "edit" }))} title={draft.mode === "edit" ? t("Puede editar archivos y correr comandos. Click: solo lectura") : t("Solo lectura. Click: permitir editar")}>
                  {draft.mode === "edit" ? (
                    <>
                      <Pencil /> {t("Edita")}
                    </>
                  ) : (
                    <>
                      <Lock /> {t("Lee")}
                    </>
                  )}
                </button>
                <button onClick={() => setDraft((d) => ({ ...d, folder: "" }))} aria-label={t("Quitar")}>
                  ×
                </button>
              </span>
            )}
            {draft.skills.map((p) => (
              <span key={p} className="tag-chip mustard" title={p}>
                <Zap /> {skillName(p)}
                <button onClick={() => toggleSkill(p)} aria-label={t("Quitar")}>
                  ×
                </button>
              </span>
            ))}
            {draft.files.map((f, i) => (
              <FileChip key={f.path + i} f={f} onRemove={() => setDraft((d) => ({ ...d, files: d.files.filter((_, k) => k !== i) }))} />
            ))}
          </div>
        )}
        <textarea
          ref={input}
          rows={1}
          value={draft.text}
          placeholder={draft.agent ? t("Mensaje para {name}…", { name: draft.agent }) : (placeholder ?? t("Escribí un mensaje…"))}
          aria-label={t("Mensaje")}
          onPaste={onPaste}
          onChange={(e) => {
            setDraft((d) => ({ ...d, text: e.target.value }));
            detect(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={() => setTimeout(() => setSug(null), 120)}
          onKeyDown={(e) => {
            if (sug && options.length) {
              if (e.key === "ArrowDown") return e.preventDefault(), setSel((sel + 1) % options.length);
              if (e.key === "ArrowUp") return e.preventDefault(), setSel((sel - 1 + options.length) % options.length);
              if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), choose(sel);
              if (e.key === "Escape") return e.preventDefault(), setSug(null);
            }
            if (e.key === "Backspace" && !draft.text && draft.agent) setDraft((d) => ({ ...d, agent: "" }));
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend && !running) onSend();
            }
          }}
        />
        <div className="composer-bar">
          <div ref={plus.ref} style={{ position: "relative" }}>
            <button type="button" className={`round-btn ${plus.open ? "on" : ""}`} onClick={() => plus.setOpen(!plus.open)} aria-label={t("Agregar")} title={t("Agregar archivos, carpeta, skills o un agente")}>
              <Plus />
            </button>
            {plus.open && (
              <div className="popover menu plus-menu">
                {sub === "" && (
                  <>
                    <button className="menu-item" onClick={addFiles}>
                      <Paperclip /> {t("Agregar archivos o fotos")}
                    </button>
                    <button className="menu-item" onClick={pickFolder}>
                      <FolderPlus /> {draft.folder ? t("Cambiar carpeta de trabajo") : t("Agregar carpeta de trabajo")}
                    </button>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={() => setSub("skills")}>
                      <Zap /> {t("Skills")}
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        {draft.skills.length || ""}
                      </span>
                      <ChevronRight size={13} />
                    </button>
                    <button className="menu-item" onClick={() => setSub("agents")} disabled={!agents.length} title={!agents.length ? t("No encontré agentes de OpenCue") : undefined}>
                      <AtSign /> {t("Enviar a un agente de OpenCue")}
                      <ChevronRight size={13} style={{ marginLeft: "auto" }} />
                    </button>
                  </>
                )}
                {sub === "skills" && (
                  <>
                    <button className="menu-label back" onClick={() => setSub("")}>
                      ‹ {t("Skills")}
                    </button>
                    {skills.length === 0 && <div className="menu-label">{t("Todavía no hay skills.")}</div>}
                    <div className="menu-scroll">
                      <GroupedSkills
                        items={skills}
                        render={(s) => (
                          <button className="menu-item two" onClick={() => toggleSkill(s.path)} title={s.path}>
                            <span className="check-box">{draft.skills.includes(s.path) && <Check size={12} />}</span>
                            <span className="sug-txt">
                              <b>{s.name}</b>
                              {s.description && <span className="muted">{s.description}</span>}
                            </span>
                          </button>
                        )}
                      />
                    </div>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={() => (plus.setOpen(false), onManageSkills())}>
                      <Gear /> {t("Administrar skills")}
                    </button>
                  </>
                )}
                {sub === "agents" && (
                  <>
                    <button className="menu-label back" onClick={() => setSub("")}>
                      ‹ {t("Agentes de OpenCue")}
                    </button>
                    {agents.map((a) => (
                      <button key={a.id} className={`menu-item ${draft.agent === a.name ? "sel" : ""}`} onClick={() => (plus.setOpen(false), setDraft((d) => ({ ...d, agent: d.agent === a.name ? "" : a.name })))}>
                        <Glyph icon="opencue" color="olive" className="xs" /> @{a.name}
                        {draft.agent === a.name && <Check size={14} style={{ marginLeft: "auto" }} />}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="pills" role="group" aria-label={t("Herramientas")}>
            {PILLS.map((p) => {
              const ready = pillReady(p);
              const on = canTools && ready && tools.includes(p.id) && !draft.agent;
              const I = p.icon;
              const why = draft.agent ? t("El agente usa sus propias herramientas") : !canTools ? t("Este modelo no usa herramientas") : !ready ? t("{name} no está instalada o está fuera del servidor MCP", { name: p.label }) : on ? t("Desactivar {name}", { name: p.label }) : t("Activar {name}", { name: p.label });
              return (
                <button key={p.id} type="button" className={`pill ${p.tone} ${on ? "on" : ""}`} disabled={!canTools || !ready || !!draft.agent} onClick={() => onToggleTool(p.id)} title={why} aria-pressed={on}>
                  <I /> <span>{p.label}</span>
                </button>
              );
            })}
          </div>
          <span className="spacer" />
          {!draft.agent && <ModelPicker models={models} value={model} onChange={onModel} loading={loadingModels} />}
          {running ? (
            <button className="send stop" onClick={onStop} title={t("Detener")} aria-label={t("Detener")}>
              <Square />
            </button>
          ) : (
            <button className="send" onClick={onSend} disabled={!canSend} title={t("Enviar")} aria-label={t("Enviar")}>
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
      {hint && <div className="composer-hint tiny muted">{hint}</div>}
    </div>
  );
}
