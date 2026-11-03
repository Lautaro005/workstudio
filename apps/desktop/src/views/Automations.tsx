// Automations: prompts that run by themselves — daily, on some days, every N minutes or on demand — as a
// new chat with the model, pills (brain, Lumina, OpenBlocks, web), skills, project and folder you pick.
// The templates come from Ben AI's second-brain method (daily update, weekly health check).
import { useEffect, useMemo, useState } from "react";
import { call, inTauri, type Automation, type ChatModel, type Project, type Skill } from "../lib/api";
import { useT } from "../lib/i18n";
import { useStore } from "../lib/store";
import { visibleModels } from "../lib/chatModels";
import { Modal, Switch, timeAgo } from "../components/ui";
import { PILLS } from "../components/chat/Composer";
import { Check, Clock, MessageSquare, Pencil, Play, Plus, Trash2, Zap, Loader2 } from "../components/icons";

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const blank = (model: string): Automation => ({
  id: "",
  name: "",
  prompt: "",
  model,
  tools: ["openblocks"],
  skills: [],
  project: "",
  folder: "",
  mode: "read",
  enabled: true,
  schedule: { kind: "daily", time: "08:00", days: [1, 2, 3, 4, 5], every_minutes: 60 },
  created: 0,
  last_run: 0,
  last_chat: "",
  last_error: "",
  runs: 0,
});

type Template = { key: string; name: string; desc: string; prompt: string; tools: string[]; skill?: string; schedule: Automation["schedule"] };

/** Spanish source strings; they go through t(). */
const TEMPLATES: Template[] = [
  {
    key: "daily",
    name: "Actualización diaria del second brain",
    desc: "Guarda en tu vault de OpenBlocks lo nuevo de tus reuniones: decisiones e insights, no datos crudos.",
    prompt:
      "Run the daily update of my second brain. Read AGENTS in my OpenBlocks vault first. Then look at what is new since yesterday (my Lumina meetings and the vault) and save only insights — decisions, client updates, preferences, lessons — in the folders the map points to. Update existing pages instead of duplicating them, keep the indexes current, and archive pages that became obsolete. Finish with a short report of what you saved, updated and archived.",
    tools: ["openblocks", "lumina", "brain"],
    skill: "second-brain-operator",
    schedule: { kind: "daily", time: "07:30", days: [], every_minutes: 60 },
  },
  {
    key: "weekly",
    name: "Limpieza semanal del second brain",
    desc: "Revisa el mapa AGENTS, los índices, los links rotos, los duplicados y da un puntaje de salud sobre 100.",
    prompt:
      "Give my second brain a full health check. Fix the small things, ask me before anything big, and show me the score out of 100 at the end. Save the report as a page in Decisiones.",
    tools: ["openblocks"],
    skill: "second-brain-optimizer",
    schedule: { kind: "weekly", time: "20:00", days: [0], every_minutes: 60 },
  },
  {
    key: "morning",
    name: "Briefing de la mañana",
    desc: "Tus 3 prioridades del día, las decisiones de la semana y las reuniones de hoy con una mini preparación.",
    prompt:
      "Build my morning briefing from my second brain: my top 3 priorities for today, the decisions we made this week, and my meetings for today with a 3-line prep for each. Keep it short and put it in an artifact.",
    tools: ["openblocks", "lumina", "brain"],
    schedule: { kind: "weekly", time: "08:30", days: [1, 2, 3, 4, 5], every_minutes: 60 },
  },
  {
    key: "meetings",
    name: "Cierre del día: reuniones",
    desc: "Toma las reuniones de hoy de Lumina y guarda decisiones y pendientes como notas en tu vault.",
    prompt:
      "Take today's meetings from Lumina and save to my OpenBlocks vault the decisions, the action items with owners, and anything that changes a project or a client. Link them with [[wikilinks]] to the existing pages. Do not copy transcripts. Report what you saved.",
    tools: ["lumina", "openblocks"],
    schedule: { kind: "daily", time: "19:00", days: [], every_minutes: 60 },
  },
];

function describe(a: Automation, t: ReturnType<typeof useT>) {
  const s = a.schedule;
  if (s.kind === "manual") return t("Solo cuando la ejecutás");
  if (s.kind === "interval") return t("Cada {n} min", { n: s.every_minutes });
  if (s.kind === "daily") return t("Todos los días a las {h}", { h: s.time });
  const days = s.days.length === 7 ? t("todos los días") : s.days.map((d) => t(DAYS[d])).join(" · ");
  return `${days} · ${s.time}`;
}

function when(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

export function Automations() {
  const t = useT();
  const { settings, toast, openChatId } = useStore();
  const [list, setList] = useState<Automation[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [edit, setEdit] = useState<Automation | null>(null);
  const [running, setRunning] = useState<string>("");

  const reload = () => call<Automation[]>("automations_list").then(setList).catch(() => {});
  useEffect(() => {
    reload();
    call<ChatModel[]>("chat_models").then(setModels).catch(() => {});
    call<Skill[]>("skills_list", { folder: null }).then(setSkills).catch(() => {});
    call<Project[]>("project_list").then(setProjects).catch(() => {});
    if (!inTauri) return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/event").then((m) => m.listen("automations-changed", reload).then((f) => (un = f)));
    const iv = setInterval(reload, 30000);
    return () => {
      un?.();
      clearInterval(iv);
    };
  }, []);

  const shown = useMemo(() => visibleModels(models, settings).filter((m) => m.group !== "OpenCue"), [models, settings]);
  const defaultModel = settings?.chat_model && shown.some((m) => m.id === settings.chat_model) ? settings.chat_model : (shown[0]?.id ?? "");

  const fromTemplate = (tp: Template) => {
    const sk = tp.skill ? skills.find((s) => s.name === tp.skill) : undefined;
    setEdit({ ...blank(defaultModel), name: t(tp.name), prompt: tp.prompt, tools: tp.tools, skills: sk ? [sk.path] : [], schedule: tp.schedule });
  };

  const save = async (a: Automation) => {
    try {
      await call("automation_save", { a });
      setEdit(null);
      reload();
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const runNow = async (a: Automation) => {
    setRunning(a.id);
    try {
      const chat = await call<string>("automation_run", { id: a.id });
      toast(t("Corriendo «{name}». Mirá el chat.", { name: a.name }));
      reload();
      if (chat) openChatId(chat);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setRunning("");
    }
  };

  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>{t("Automatizaciones")}</h1>
          <p>{t("Prompts que corren solos con el modelo, las herramientas y las skills que elijas. Cada corrida queda como un chat. Corren mientras WorkStudio está abierto (queda en la bandeja al cerrar la ventana).")}</p>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setEdit(blank(defaultModel))}>
          <Plus /> {t("Nueva automatización")}
        </button>
      </div>

      {list.length === 0 && (
        <div className="auto-empty">
          <Zap />
          <b>{t("Todavía no tenés automatizaciones")}</b>
          <span className="muted">{t("Empezá con una de estas, basadas en el método de second brain de Ben AI:")}</span>
        </div>
      )}

      <div className="auto-list">
        {list.map((a) => (
          <div key={a.id} className={`auto-row ${a.enabled ? "" : "off"}`}>
            <div className="auto-main">
              <div className="auto-title">
                <b>{a.name}</b>
                {a.tools.map((id) => (
                  <span key={id} className="chip">
                    {PILLS.find((p) => p.id === id)?.label ?? id}
                  </span>
                ))}
                {a.skills.length > 0 && (
                  <span className="chip mustard">
                    <Zap /> {a.skills.map((p) => skills.find((s) => s.path === p)?.name ?? "skill").join(", ")}
                  </span>
                )}
              </div>
              <div className="small muted">
                <Clock size={12} /> {describe(a, t)}
                {a.enabled && a.next_run ? ` · ${t("próxima: {w}", { w: when(a.next_run) })}` : ""}
                {a.last_run ? ` · ${t("última: {w}", { w: timeAgo(a.last_run) })}` : ` · ${t("todavía no corrió")}`}
              </div>
              {a.last_error && <div className="small bad-text">{a.last_error}</div>}
              <div className="small auto-prompt">{a.prompt}</div>
            </div>
            <div className="auto-actions">
              {a.last_chat && (
                <button className="icon-btn sm" title={t("Abrir la última corrida")} aria-label={t("Abrir la última corrida")} onClick={() => openChatId(a.last_chat)}>
                  <MessageSquare />
                </button>
              )}
              <button className="icon-btn sm" title={t("Ejecutar ahora")} aria-label={t("Ejecutar ahora")} disabled={running === a.id} onClick={() => runNow(a)}>
                {running === a.id ? <Loader2 className="spin" /> : <Play />}
              </button>
              <button className="icon-btn sm" title={t("Editar")} aria-label={t("Editar")} onClick={() => setEdit(a)}>
                <Pencil />
              </button>
              <button
                className="icon-btn sm"
                title={t("Borrar")}
                aria-label={t("Borrar")}
                onClick={async () => {
                  if (!window.confirm(t("¿Borrar «{name}»?", { name: a.name }))) return;
                  await call("automation_delete", { id: a.id });
                  reload();
                }}
              >
                <Trash2 />
              </button>
              <Switch on={a.enabled} label={t("Activa")} onChange={async (v) => (await call("automation_enable", { id: a.id, on: v }), reload())} />
            </div>
          </div>
        ))}
      </div>

      <h3 className="auto-sub">{t("Plantillas")}</h3>
      <div className="auto-templates">
        {TEMPLATES.map((tp) => (
          <button key={tp.key} className="auto-tpl" onClick={() => fromTemplate(tp)}>
            <b>
              <Zap /> {t(tp.name)}
            </b>
            <span className="small muted">{t(tp.desc)}</span>
          </button>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} wide>
        {edit && <Editor a={edit} models={shown} skills={skills} projects={projects} onSave={save} onClose={() => setEdit(null)} />}
      </Modal>
    </div>
  );
}

function Editor({ a: initial, models, skills, projects, onSave, onClose }: { a: Automation; models: ChatModel[]; skills: Skill[]; projects: Project[]; onSave: (a: Automation) => void; onClose: () => void }) {
  const t = useT();
  const [a, setA] = useState(initial);
  const set = (patch: Partial<Automation>) => setA((x) => ({ ...x, ...patch }));
  const sch = (patch: Partial<Automation["schedule"]>) => setA((x) => ({ ...x, schedule: { ...x.schedule, ...patch } }));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const groups = [...new Set(skills.map((s) => s.group))];
  const ok = a.name.trim() && a.prompt.trim() && a.model;
  return (
    <>
      <div className="modal-head">
        <h3>{initial.id ? t("Editar automatización") : t("Nueva automatización")}</h3>
      </div>
      <div className="modal-body">
        <div className="field">
          <label>{t("Nombre")}</label>
          <input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("Actualización diaria del second brain")} />
        </div>
        <div className="field">
          <label>{t("Qué tiene que hacer")}</label>
          <textarea className="textarea" style={{ minHeight: 120 }} value={a.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder={t("Escribilo como se lo escribirías en el chat.")} />
        </div>
        <div className="field">
          <label>{t("Cuándo")}</label>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            {(["daily", "weekly", "interval", "manual"] as const).map((k) => (
              <button key={k} className={a.schedule.kind === k ? "on" : ""} onClick={() => sch({ kind: k })}>
                {t({ daily: "Todos los días", weekly: "Días elegidos", interval: "Cada tanto", manual: "A mano" }[k])}
              </button>
            ))}
          </div>
          {(a.schedule.kind === "daily" || a.schedule.kind === "weekly") && (
            <div className="row" style={{ gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <input className="input" type="time" style={{ width: 120 }} value={a.schedule.time} onChange={(e) => sch({ time: e.target.value })} />
              {a.schedule.kind === "weekly" && (
                <div className="day-pick">
                  {DAYS.map((d, i) => (
                    <button key={d} className={a.schedule.days.includes(i) ? "on" : ""} onClick={() => sch({ days: toggle(a.schedule.days, i) })}>
                      {t(d)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {a.schedule.kind === "interval" && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
              {t("Cada")}
              <input className="input" type="number" min={5} style={{ width: 90 }} value={a.schedule.every_minutes} onChange={(e) => sch({ every_minutes: Number(e.target.value) || 60 })} />
              {t("minutos")}
            </div>
          )}
          <span className="hint">{t("Si WorkStudio estaba cerrado a esa hora, corre una vez al abrirse.")}</span>
        </div>
        <div className="field">
          <label>{t("Modelo")}</label>
          <select className="input" value={a.model} onChange={(e) => set({ model: e.target.value })}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.group} · {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("Herramientas")}</label>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {PILLS.map((p) => (
              <button key={p.id} type="button" className={`pill ${p.tone} ${a.tools.includes(p.id) ? "on" : ""}`} onClick={() => set({ tools: toggle(a.tools, p.id) })}>
                <p.icon /> <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t("Skills")}</label>
          <div className="auto-skills">
            {skills.length === 0 && <span className="muted small">{t("Todavía no hay skills.")}</span>}
            {groups.map((g) => (
              <div key={g}>
                <div className="menu-label group-title">{g}</div>
                {skills
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <button key={s.path} className="menu-item two" onClick={() => set({ skills: toggle(a.skills, s.path) })} title={s.path}>
                      <span className="check-box">{a.skills.includes(s.path) && <Check size={12} />}</span>
                      <span className="sug-txt">
                        <b>{s.name}</b>
                        {s.description && <span className="muted">{s.description}</span>}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t("Proyecto (opcional)")}</label>
          <select className="input" value={a.project} onChange={(e) => set({ project: e.target.value })}>
            <option value="">{t("Ninguno")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t("Carpeta de trabajo (opcional)")}</label>
          <div className="row" style={{ gap: 8 }}>
            <input className="input mono" value={a.folder} onChange={(e) => set({ folder: e.target.value })} placeholder="~/Proyectos/demo" />
            <select className="input" style={{ width: 130 }} value={a.mode} onChange={(e) => set({ mode: e.target.value })} disabled={!a.folder}>
              <option value="read">{t("Lee")}</option>
              <option value="edit">{t("Edita")}</option>
            </select>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" disabled={!ok} onClick={() => onSave(a)}>
          {t("Guardar")}
        </button>
      </div>
    </>
  );
}
