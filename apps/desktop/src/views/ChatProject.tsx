// Projects (like Claude's): a page with the project's chats, its instructions, knowledge files,
// working folder and skills; a modal to set them up; and the skills manager.
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, BookOpen, Folder, FolderOpen, Lock, Paperclip, Pencil, Plus, Settings as Gear, Trash2, Zap, Chats } from "../components/icons";
import { call, inTauri, type ChatModel, type ChatSummary, type Project, type Skill } from "../lib/api";
import { useT } from "../lib/i18n";
import { useStore } from "../lib/store";
import { Modal, timeAgo } from "../components/ui";
import { reveal } from "../lib/open";
import { fmtSize, FileGlyph } from "../components/chat/Message";
import { ModelPicker, PILLS } from "../components/chat/Composer";

export const newProject = (): Project => ({ id: "", name: "", description: "", instructions: "", folder: "", mode: "read", model: "", tools: ["brain"], skills: [], files: [], created: 0, updated: 0 });

export function ProjectModal({ open, project, onClose, onSaved, models, skills }: { open: boolean; project: Project | null; onClose: () => void; onSaved: (p: Project) => void; models: ChatModel[]; skills: Skill[] }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [p, setP] = useState<Project>(project ?? newProject());
  useEffect(() => {
    if (open) setP(project ?? newProject());
  }, [open, project]);
  const set = (patch: Partial<Project>) => setP((x) => ({ ...x, ...patch }));
  const pickFolder = async () => {
    if (!inTauri) return set({ folder: "~/Proyectos/demo" });
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") set({ folder: picked });
  };
  const save = async () => {
    try {
      const saved = await call<Project>("project_save", { project: p });
      onSaved(saved);
    } catch (e) {
      toast(String(e), "error");
    }
  };
  return (
    <Modal open={open} onClose={onClose} wide className="project-modal">
      <div className="modal-head">
        <h2>{p.id ? t("Configurar proyecto") : t("Nuevo proyecto")}</h2>
        <p className="muted small">{t("Los chats del proyecto comparten sus instrucciones, archivos, carpeta y skills.")}</p>
      </div>
      <div className="modal-body col" style={{ gap: 16 }}>
        <div className="field">
          <label>{t("Nombre")}</label>
          <input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Ej.: Tesis, Lanzamiento, Cliente X")} autoFocus />
        </div>
        <div className="field">
          <label>{t("Descripción")}</label>
          <input className="input" value={p.description} onChange={(e) => set({ description: e.target.value })} placeholder={t("¿De qué se trata? (opcional)")} />
        </div>
        <div className="field">
          <label>{t("Instrucciones")}</label>
          <textarea rows={6} value={p.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder={t("Cómo querés que responda en este proyecto: tono, formato, contexto, qué evitar…")} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>{t("Carpeta de trabajo")}</label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm" onClick={pickFolder}>
                <Folder /> {p.folder ? t("Cambiar") : t("Elegir carpeta")}
              </button>
              {p.folder && (
                <>
                  <span className="mono small ellipsis" title={p.folder}>
                    {p.folder}
                  </span>
                  <button className="icon-btn sm" onClick={() => set({ folder: "" })} aria-label={t("Quitar")}>
                    ×
                  </button>
                </>
              )}
            </div>
            {p.folder && (
              <div className="seg sm" style={{ marginTop: 8, alignSelf: "flex-start" }}>
                <button className={p.mode !== "edit" ? "on" : ""} onClick={() => set({ mode: "read" })}>
                  <Lock /> {t("Solo lectura")}
                </button>
                <button className={p.mode === "edit" ? "on" : ""} onClick={() => set({ mode: "edit" })}>
                  <Pencil /> {t("Puede editar")}
                </button>
              </div>
            )}
          </div>
          <div className="field">
            <label>{t("Modelo predeterminado")}</label>
            <div className="model-field">
              <ModelPicker models={models} value={p.model} onChange={(id) => set({ model: id })} loading={false} up={false} />
              {p.model && (
                <button className="icon-btn sm" onClick={() => set({ model: "" })} aria-label={t("Quitar")}>
                  ×
                </button>
              )}
            </div>
            {!p.model && <span className="tiny muted">{t("Sin elegir: usa el último modelo del chat.")}</span>}
          </div>
        </div>
        <div className="field">
          <label>{t("Herramientas")}</label>
          <div className="row wrap" style={{ gap: 8 }}>
            {PILLS.map((x) => {
              const on = p.tools.includes(x.id);
              const I = x.icon;
              return (
                <button key={x.id} className={`pill ${x.tone} ${on ? "on" : ""}`} onClick={() => set({ tools: on ? p.tools.filter((y) => y !== x.id) : [...p.tools, x.id] })} aria-pressed={on}>
                  <I /> {x.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label>{t("Skills siempre activas")}</label>
          {skills.length === 0 ? (
            <span className="small muted">{t("Todavía no hay skills.")}</span>
          ) : (
            <div className="skill-checks">
              {skills.map((s) => (
                <label key={s.path} className="check" title={s.path}>
                  <input type="checkbox" checked={p.skills.includes(s.path)} onChange={(e) => set({ skills: e.target.checked ? [...p.skills, s.path] : p.skills.filter((x) => x !== s.path) })} />
                  <span>
                    <b>{s.name}</b> <span className="muted small">{s.description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" onClick={save} disabled={!p.name.trim()}>
          {p.id ? t("Guardar") : t("Crear proyecto")}
        </button>
      </div>
    </Modal>
  );
}

export function SkillsModal({ open, onClose, skills, onChanged }: { open: boolean; onClose: () => void; skills: Skill[]; onChanged: () => void }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const [view, setView] = useState<Skill | null>(null);
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", body: "" });
  useEffect(() => {
    if (!open) {
      setView(null);
      setCreating(false);
    }
  }, [open]);
  useEffect(() => {
    if (!view) return;
    call<string>("skill_read", { path: view.path }).then(setBody).catch((e) => setBody(String(e)));
  }, [view]);
  const save = async () => {
    try {
      await call("skill_save", draft);
      toast(t("Skill guardada"), "success");
      setCreating(false);
      setDraft({ name: "", description: "", body: "" });
      onChanged();
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const source = (s: Skill) => (s.source === "claude" ? "Claude" : s.source === "folder" ? t("Carpeta") : "WorkStudio");
  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="modal-head">
        <h2>{t("Skills")}</h2>
        <p className="muted small">{t("Instrucciones para tareas específicas (formato SKILL.md, como en Claude). Activalas con / en el chat o dejalas fijas en un proyecto. WorkStudio lee ~/.workstudio/skills, ~/.claude/skills y las de la carpeta de trabajo.")}</p>
      </div>
      <div className="modal-body">
        {creating ? (
          <div className="col" style={{ gap: 12 }}>
            <div className="field">
              <label>{t("Nombre")}</label>
              <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="resumen-reunion" autoFocus />
            </div>
            <div className="field">
              <label>{t("Cuándo usarla")}</label>
              <input className="input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t("Ej.: Resume reuniones en decisiones, pendientes y responsables")} />
            </div>
            <div className="field">
              <label>{t("Instrucciones")}</label>
              <textarea rows={10} className="mono" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder={t("# Pasos\n1. …")} />
            </div>
          </div>
        ) : view ? (
          <div className="col" style={{ gap: 10 }}>
            <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setView(null)}>
              <ArrowLeft /> {t("Todas")}
            </button>
            <div>
              <b>{view.name}</b> <span className="chip">{source(view)}</span>
              <div className="small muted">{view.description}</div>
            </div>
            <pre className="skill-body">{body}</pre>
          </div>
        ) : (
          <div className="skill-list">
            {skills.length === 0 && <div className="empty small">{t("Todavía no hay skills. Creá una o copiá carpetas con SKILL.md en ~/.workstudio/skills.")}</div>}
            {skills.map((s) => (
              <div key={s.path} className="skill-row">
                <Zap />
                <button className="skill-row-main" onClick={() => setView(s)}>
                  <b>{s.name}</b>
                  <span className="small muted">{s.description || "—"}</span>
                </button>
                <span className="chip">{source(s)}</span>
                {s.source === "workstudio" && (
                  <button
                    className="icon-btn sm"
                    title={t("Borrar")}
                    aria-label={t("Borrar")}
                    onClick={async () => {
                      try {
                        await call("skill_delete", { path: s.path });
                        onChanged();
                      } catch (e) {
                        toast(String(e), "error");
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-foot">
        {!creating && (
          <button className="btn ghost" onClick={async () => reveal(await call<string>("skills_folder"))}>
            <FolderOpen /> {t("Abrir carpeta")}
          </button>
        )}
        <span className="spacer" />
        {creating ? (
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>
              {t("Cancelar")}
            </button>
            <button className="btn primary" onClick={save} disabled={!draft.name.trim() || !draft.body.trim()}>
              {t("Guardar")}
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus /> {t("Nueva skill")}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function ProjectPage({
  project,
  chats,
  composer,
  onBack,
  onOpenChat,
  onEdit,
  onChanged,
  onDelete,
  skills,
}: {
  project: Project;
  chats: ChatSummary[];
  composer: React.ReactNode;
  onBack: () => void;
  onOpenChat: (id: string) => void;
  onEdit: () => void;
  onChanged: (p: Project) => void;
  onDelete: () => void;
  skills: Skill[];
}) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const addFiles = async () => {
    if (!inTauri) return toast(t("Disponible en la app"), "info");
    const picked = await openDialog({ multiple: true, directory: false });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    try {
      onChanged(await call<Project>("project_add_files", { id: project.id, paths }));
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const removeFile = async (name: string) => {
    try {
      onChanged(await call<Project>("project_remove_file", { id: project.id, name }));
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const skillName = (p: string) => skills.find((s) => s.path === p)?.name ?? p.split(/[\\/]/).slice(-2, -1)[0];
  return (
    <div className="project-page">
      <div className="project-main">
        <button className="btn sm ghost back-btn" onClick={onBack}>
          <ArrowLeft /> {t("Todos los proyectos")}
        </button>
        <div className="project-title">
          <h1>{project.name}</h1>
          <button className="icon-btn" title={t("Configurar proyecto")} aria-label={t("Configurar proyecto")} onClick={onEdit}>
            <Gear />
          </button>
        </div>
        {project.description && <p className="muted">{project.description}</p>}
        <div className="project-composer">{composer}</div>
        <div className="section-title">{t("Chats del proyecto")}</div>
        {chats.length === 0 ? (
          <div className="empty small">{t("Todavía no hay chats. Escribí arriba para empezar uno.")}</div>
        ) : (
          <div className="project-chats">
            {chats.map((c) => (
              <button key={c.id} className="project-chat" onClick={() => onOpenChat(c.id)}>
                <Chats />
                <span className="ellipsis">{c.title || t("Sin título")}</span>
                <span className="tiny muted">{timeAgo(c.updated)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="project-side">
        <section className="card card-pad">
          <div className="side-head">
            <h3>{t("Instrucciones")}</h3>
            <button className="icon-btn sm" onClick={onEdit} aria-label={t("Editar")}>
              <Pencil />
            </button>
          </div>
          {project.instructions ? <p className="small instr-preview">{project.instructions}</p> : <p className="small muted">{t("Contale cómo trabajar en este proyecto: tono, formato, contexto.")}</p>}
        </section>
        <section className="card card-pad">
          <div className="side-head">
            <h3>{t("Conocimiento")}</h3>
            <button className="icon-btn sm" onClick={addFiles} aria-label={t("Agregar archivos")} title={t("Agregar archivos")}>
              <Plus />
            </button>
          </div>
          {project.files.length === 0 ? (
            <p className="small muted">{t("Archivos de texto que el modelo lee en cada chat del proyecto (notas, docs, código, CSV…).")}</p>
          ) : (
            <div className="kfiles">
              {project.files.map((f) => (
                <div key={f.name} className="kfile" title={f.path}>
                  <FileGlyph kind={/\.(png|jpe?g|gif|webp)$/i.test(f.name) ? "image" : /\.pdf$/i.test(f.name) ? "pdf" : "text"} />
                  <span className="ellipsis">{f.name}</span>
                  <span className="tiny muted">{fmtSize(f.size)}</span>
                  <button className="icon-btn sm" onClick={() => removeFile(f.name)} aria-label={t("Quitar")}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button className="btn sm ghost" onClick={addFiles} style={{ marginTop: 8 }}>
            <Paperclip /> {t("Agregar archivos")}
          </button>
        </section>
        <section className="card card-pad">
          <div className="side-head">
            <h3>{t("Carpeta y skills")}</h3>
            <button className="icon-btn sm" onClick={onEdit} aria-label={t("Editar")}>
              <Pencil />
            </button>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <div className="row small" style={{ gap: 6 }}>
              <Folder />
              {project.folder ? (
                <button className="link mono ellipsis" onClick={() => reveal(project.folder)} title={project.folder}>
                  {project.folder}
                </button>
              ) : (
                <span className="muted">{t("Sin carpeta de trabajo")}</span>
              )}
              {project.folder && <span className="chip">{project.mode === "edit" ? t("Edita") : t("Lee")}</span>}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {project.skills.length === 0 ? (
                <span className="small muted">
                  <Zap size={13} /> {t("Sin skills fijas")}
                </span>
              ) : (
                project.skills.map((s) => (
                  <span key={s} className="tag-chip mustard">
                    <Zap /> {skillName(s)}
                  </span>
                ))
              )}
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {project.tools.map((x) => {
                const p = PILLS.find((y) => y.id === x);
                if (!p) return null;
                const I = p.icon;
                return (
                  <span key={x} className={`tag-chip ${p.tone}`}>
                    <I /> {p.label}
                  </span>
                );
              })}
            </div>
          </div>
        </section>
        <button className="btn sm ghost danger" onClick={onDelete} style={{ alignSelf: "flex-start" }}>
          <Trash2 /> {t("Borrar proyecto")}
        </button>
      </aside>
    </div>
  );
}

export function ProjectsList({ projects, onOpen, onNew, chats }: { projects: Project[]; onOpen: (id: string) => void; onNew: () => void; chats: ChatSummary[] }) {
  const t = useT();
  return (
    <div className="projects-home">
      <div className="page-head">
        <div>
          <h1>{t("Proyectos")}</h1>
          <p>{t("Agrupá chats con sus propias instrucciones, archivos, carpeta de trabajo y skills.")}</p>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={onNew}>
          <Plus /> {t("Nuevo proyecto")}
        </button>
      </div>
      {projects.length === 0 ? (
        <div className="card card-pad empty-project">
          <BookOpen size={28} />
          <b>{t("Todavía no tenés proyectos")}</b>
          <p className="small muted">{t("Un proyecto guarda el contexto que se repite: tus instrucciones, documentos de referencia y la carpeta donde trabajás.")}</p>
          <button className="btn primary" onClick={onNew}>
            <Plus /> {t("Crear el primero")}
          </button>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const n = chats.filter((c) => c.project === p.id).length;
            return (
              <button key={p.id} className="card project-card" onClick={() => onOpen(p.id)}>
                <b>{p.name}</b>
                <span className="small muted clamp-2">{p.description || p.instructions || t("Sin descripción")}</span>
                <span className="tiny muted">
                  {n === 1 ? t("1 chat") : t("{n} chats", { n })} · {timeAgo(p.updated)}
                  {p.folder ? ` · ${p.folder.split(/[\\/]/).pop()}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

