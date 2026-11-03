// The chat, in the style of Claude's: a sidebar with projects and recent chats, the conversation in
// the middle, artifacts in a panel on the right. It talks to Claude Code, Codex, Gemini, a local
// Ollama model or an OpenCue agent (@name), with brain, Lumina and web search as pills, files and a
// working folder attached, skills and projects. The system prompt is built on the Rust side.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chats, Folder, Folders, MessageSquarePlus, MoreHorizontal, Search, Trash2, Pencil, X, Lock } from "../components/icons";
import { call, inTauri, type Attachment, type Chat as ChatT, type ChatModel, type ChatSummary, type McpServer, type OpenCueAgent, type Project, type Skill } from "../lib/api";
import { useStore } from "../lib/store";
import { locale, useLang, useT } from "../lib/i18n";
import { Logo, timeAgo, usePopover } from "../components/ui";
import { allModels, visibleModels } from "../lib/chatModels";
import { collectArtifacts, parseParts, type Artifact } from "../lib/artifacts";
import { Composer, emptyDraft, PILLS, type Draft, type Pill } from "../components/chat/Composer";
import { AnswerBody, BotMessage, lookOfModel, Thinking, ToolList, UserMessage } from "../components/chat/Message";
import { ArtifactPanel } from "../components/chat/ArtifactPanel";
import { ProjectModal, ProjectPage, ProjectsList, SkillsModal } from "./ChatProject";
import { Glyph } from "../components/ui";

type View = { kind: "chat" } | { kind: "projects" } | { kind: "project"; id: string };

export function Chat() {
  const { settings, saveSettings, chatLive, chatTick, chatStarted, toast, statuses, route, chatIntent } = useStore();
  const t = useT();
  const lang = useLang();
  const [list, setList] = useState<ChatSummary[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatT | null>(null);
  const [view, setView] = useState<View>({ kind: "chat" });
  const [draftProject, setDraftProject] = useState("");
  const [models, setModels] = useState<ChatModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [agents, setAgents] = useState<OpenCueAgent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState<{ text: string; files: Attachment[]; agent: string } | null>(null);
  const [panel, setPanel] = useState<{ id: string; index: number; follow: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [projectModal, setProjectModal] = useState<{ open: boolean; project: Project | null }>({ open: false, project: null });
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const model = settings?.chat_model ?? "";
  const tools = settings?.chat_tools ?? ["brain"];
  const shown = visibleModels(models, settings);
  const cur = allModels(models, settings).find((m) => m.id === model);
  const canTools = cur ? cur.tools : true;
  const projectOf = (id?: string) => projects.find((p) => p.id === id);
  const chatProject = current ? projectOf(chat?.project) : projectOf(draftProject);

  const reloadList = () => call<ChatSummary[]>("chat_list").then(setList).catch(() => {});
  const reloadProjects = () => call<Project[]>("project_list").then(setProjects).catch(() => {});
  const reloadSkills = (folder?: string) => call<Skill[]>("skills_list", { folder: folder || null }).then(setSkills).catch(() => {});

  useEffect(() => {
    reloadList();
    reloadProjects();
    call<McpServer[]>("mcp_list").then(setServers).catch(() => {});
    call<OpenCueAgent[]>("opencue_agents").then(setAgents).catch(() => {});
    call<ChatModel[]>("chat_models")
      .then((m) => {
        setModels(m);
        const s = useStore.getState().settings;
        const v = visibleModels(m, s);
        if (v.length && !allModels(m, s).find((x) => x.id === s?.chat_model)) saveSettings({ chat_model: v[0].id });
      })
      .finally(() => setLoadingModels(false));
    const h = () => newChat();
    window.addEventListener("ws-new-chat", h);
    return () => window.removeEventListener("ws-new-chat", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reloadSkills(draft.folder);
  }, [draft.folder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Files and folders dropped on the window.
  useEffect(() => {
    if (!inTauri || route !== "chat") return;
    let un: (() => void) | undefined;
    import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent(async (e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") setDragging(true);
          else if (p.type === "leave") setDragging(false);
          else if (p.type === "drop") {
            setDragging(false);
            const files = await call<Attachment[]>("files_inspect", { paths: p.paths });
            const dirs = p.paths.filter((x) => !files.some((f) => f.path === x));
            setDraft((d) => ({ ...d, files: [...d.files, ...files.filter((f) => !d.files.some((g) => g.path === f.path))], folder: dirs[0] ?? d.folder }));
            window.dispatchEvent(new Event("ws-focus-composer"));
          }
        })
        .then((f) => (un = f)),
    );
    return () => un?.();
  }, [route]);

  useEffect(() => {
    if (!current) {
      setChat(null);
      return;
    }
    call<ChatT | null>("chat_get", { id: current }).then((c) => {
      setChat(c);
      setPending(null);
    });
  }, [current, chatTick]);
  useEffect(() => {
    reloadList();
  }, [chatTick]);

  const live = current ? chatLive[current] : undefined;
  const running = !!live;

  // Keep the view at the bottom while an answer streams in, unless the user scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat, live?.text, live?.thinking, live?.tools.length, pending]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const pillReady = (p: Pill) => {
    if (!p.app) return true;
    const s = servers.find((x) => x.source === `app:${p.app}`);
    return !!s && s.enabled && s.ready && !!statuses[p.app]?.installed;
  };
  const togglePill = (id: string) => saveSettings({ chat_tools: tools.includes(id) ? tools.filter((x) => x !== id) : [...tools, id] });
  const activeTools = canTools ? tools.filter((id) => pillReady(PILLS.find((p) => p.id === id)!)) : [];

  function newChat(projectId = "") {
    setCurrent(null);
    setChat(null);
    setPending(null);
    setPanel(null);
    const p = projects.find((x) => x.id === projectId);
    setDraftProject(projectId);
    setDraft({ ...emptyDraft(), folder: p?.folder ?? "", mode: p?.mode || "read" });
    if (p) {
      const patch: Record<string, unknown> = {};
      if (p.model) patch.chat_model = p.model;
      if (p.tools.length) patch.chat_tools = p.tools;
      if (Object.keys(patch).length) saveSettings(patch);
    }
    setView(projectId ? { kind: "project", id: projectId } : { kind: "chat" });
    setTimeout(() => window.dispatchEvent(new Event("ws-focus-composer")), 0);
  }

  // A chat another view asked to open (an automation's last run).
  useEffect(() => {
    if (route === "chat" && chatIntent) {
      useStore.setState({ chatIntent: null });
      openChat(chatIntent);
    }
  }, [route, chatIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  function openChat(id: string) {
    setCurrent(id);
    setView({ kind: "chat" });
    setPanel(null);
    stick.current = true;
    call<ChatT | null>("chat_get", { id }).then((c) => {
      if (!c) return;
      setDraft((d) => ({ ...d, folder: c.folder ?? "", mode: c.mode || "read", skills: c.skills ?? [], agent: "" }));
    });
  }

  const client = () => ({
    date: new Date().toLocaleString(locale(lang), { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  });

  const send = async (o?: { text: string; files: Attachment[]; truncate: number; agent?: string }) => {
    const text = (o?.text ?? draft.text).trim();
    const files = o?.files ?? draft.files;
    const agent = o ? (o.agent ?? "") : draft.agent;
    if ((!text && !files.length) || running) return;
    if (!model && !agent) {
      toast(t("Elegí un modelo"), "error");
      return;
    }
    const projectId = current ? (chat?.project ?? "") : draftProject;
    if (!o) setDraft((d) => ({ ...d, text: "", files: [], agent: "" }));
    setPending({ text, files, agent });
    stick.current = true;
    if (o && chat) setChat({ ...chat, messages: chat.messages.slice(0, o.truncate) });
    setView({ kind: "chat" });
    try {
      const id = await call<string>("chat_send", {
        opts: { chat: current, text, model, tools: agent ? [] : activeTools, files, skills: draft.skills, project: projectId, folder: draft.folder, mode: draft.mode, agent, truncate: o ? o.truncate : null, client: client() },
      });
      chatStarted(id);
      setCurrent(id);
      reloadList();
    } catch (e) {
      setPending(null);
      if (!o) setDraft((d) => ({ ...d, text, files, agent }));
      toast(String(e), "error");
    }
  };

  const modelName = (id: string) => {
    if (id.startsWith("opencue:")) return t("Agente {name}", { name: id.slice(8) });
    const m = models.find((x) => x.id === id);
    return m ? m.name : id.split(":")[1] || id.split(":")[0];
  };

  const messages = chat?.messages ?? [];
  const showPending = !!pending && !messages.some((m) => m.role === "user" && m.text === pending.text && Date.now() - m.ts < 60000);
  const empty = messages.length === 0 && !pending;

  // Artifacts of this conversation, with their versions.
  const arts = useMemo(() => collectArtifacts([...messages.filter((m) => m.role === "assistant").map((m) => m.text), live?.text ?? ""]), [messages, live?.text]);
  const versionOf = (a: Artifact) => {
    const l = arts.get(a.id) ?? [];
    const i = l.findIndex((x) => x.content === a.content);
    return (i >= 0 ? i : l.length - 1) + 1;
  };
  const openArtifact = (a: Artifact) => setPanel({ id: a.id, index: versionOf(a) - 1, follow: a.open });
  // Open the panel when an answer starts writing an artifact, and follow it while it streams.
  useEffect(() => {
    if (!live?.text) return;
    const parts = parseParts(live.text).filter((p) => p.kind === "artifact");
    const last = parts[parts.length - 1];
    if (!last || last.kind !== "artifact") return;
    const n = (arts.get(last.artifact.id)?.length ?? 1) - 1;
    setPanel((p) => (p && !p.follow && p.id !== last.artifact.id ? p : { id: last.artifact.id, index: n, follow: true }));
  }, [live?.text]); // eslint-disable-line react-hooks/exhaustive-deps
  const panelVersions = panel ? arts.get(panel.id) : undefined;

  const lastUser = (() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
    return -1;
  })();

  const hint = draft.agent
    ? t("Le escribís a {name} en OpenCue: responde con sus propias herramientas.", { name: draft.agent })
    : [
        activeTools.length ? t("Usa: {list}", { list: activeTools.map((x) => PILLS.find((p) => p.id === x)?.label).join(", ") }) : t("Sin herramientas"),
        draft.folder ? `${draft.folder.split(/[\\/]/).pop()} (${draft.mode === "edit" ? t("edita") : t("solo lectura")})` : "",
        t("/ skills · @ agentes · Shift+Enter: nueva línea"),
      ]
        .filter(Boolean)
        .join(" · ");

  const composer = (
    <Composer
      draft={draft}
      setDraft={setDraft}
      models={cur && !shown.includes(cur) ? [...shown, cur] : shown}
      model={model}
      onModel={(id) => saveSettings({ chat_model: id })}
      loadingModels={loadingModels}
      tools={tools}
      onToggleTool={togglePill}
      pillReady={pillReady}
      canTools={canTools}
      skills={skills}
      agents={agents}
      running={running}
      onSend={() => send()}
      onStop={() => current && call("chat_stop", { id: current })}
      onManageSkills={() => setSkillsOpen(true)}
      placeholder={view.kind === "project" ? t("Empezá un chat en {name}…", { name: chatProject?.name ?? "" }) : undefined}
      autoFocus
      hint={hint}
    />
  );

  const q = query.trim().toLowerCase();
  const recents = list.filter((c) => !q || c.title.toLowerCase().includes(q));
  const moveTo = async (projectId: string) => {
    if (!current) return;
    try {
      const c = await call<ChatT>("chat_update", { id: current, project: projectId });
      setChat(c);
      reloadList();
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const rename = async (id: string, title: string) => {
    setRenaming(null);
    if (!title.trim()) return;
    await call("chat_update", { id, title });
    reloadList();
    if (id === current && chat) setChat({ ...chat, title });
  };
  const deleteChat = async (id: string) => {
    await call("chat_delete", { id });
    if (id === current) newChat();
    reloadList();
  };

  const project = view.kind === "project" ? projectOf(view.id) : undefined;

  return (
    <div className={`chat-view ${panel && panelVersions ? "with-panel" : ""}`}>
      <aside className="chat-list">
        <button className="btn primary sm" onClick={() => newChat()} style={{ width: "100%" }}>
          <MessageSquarePlus /> {t("Nuevo chat")}
        </button>
        <label className="chat-search">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Buscar chats")} aria-label={t("Buscar chats")} />
          {query && (
            <button onClick={() => setQuery("")} aria-label={t("Borrar")}>
              <X size={12} />
            </button>
          )}
        </label>
        <nav className="chat-nav">
          <button className={view.kind === "chat" && !current ? "on" : ""} onClick={() => newChat()}>
            <Chats /> {t("Chats")}
          </button>
          <button className={view.kind !== "chat" ? "on" : ""} onClick={() => setView({ kind: "projects" })}>
            <Folders /> {t("Proyectos")}
          </button>
        </nav>
        <div className="chat-items">
          {projects.length > 0 && !q && (
            <>
              <div className="chat-group">{t("Proyectos")}</div>
              {projects.slice(0, 6).map((p) => (
                <button key={p.id} className={`chat-proj ${view.kind === "project" && view.id === p.id ? "on" : ""}`} onClick={() => newChat(p.id)}>
                  <Folder /> <span className="ellipsis">{p.name}</span>
                </button>
              ))}
            </>
          )}
          <div className="chat-group">{q ? t("Resultados") : t("Recientes")}</div>
          {recents.length === 0 && <div className="tiny muted" style={{ padding: "6px 8px" }}>{q ? t("Nada coincide.") : t("Tus conversaciones quedan acá, guardadas en tu compu.")}</div>}
          {recents.map((c) => (
            <div key={c.id} className={`chat-item ${c.id === current && view.kind === "chat" ? "on" : ""}`}>
              {renaming === c.id ? (
                <input className="rename" defaultValue={c.title} autoFocus onBlur={(e) => rename(c.id, e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? rename(c.id, (e.target as HTMLInputElement).value) : e.key === "Escape" && setRenaming(null))} />
              ) : (
                <button className="chat-item-main" onClick={() => openChat(c.id)} onDoubleClick={() => setRenaming(c.id)}>
                  <span className="chat-item-title">{c.title || t("Sin título")}</span>
                  <span className="tiny muted ellipsis">
                    {chatLive[c.id] ? t("respondiendo…") : timeAgo(c.updated)}
                    {c.project && projectOf(c.project) ? ` · ${projectOf(c.project)!.name}` : ""}
                  </span>
                </button>
              )}
              <button className="icon-btn sm" title={t("Borrar")} aria-label={t("Borrar")} onClick={() => deleteChat(c.id)}>
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {view.kind === "projects" ? (
        <section className="chat-main scroll">
          <ProjectsList projects={projects} chats={list} onOpen={(id) => newChat(id)} onNew={() => setProjectModal({ open: true, project: null })} />
        </section>
      ) : view.kind === "project" && project ? (
        <section className="chat-main scroll">
          <ProjectPage
            project={project}
            chats={list.filter((c) => c.project === project.id)}
            composer={composer}
            skills={skills}
            onBack={() => setView({ kind: "projects" })}
            onOpenChat={openChat}
            onEdit={() => setProjectModal({ open: true, project })}
            onChanged={(p) => setProjects((ps) => ps.map((x) => (x.id === p.id ? p : x)))}
            onDelete={async () => {
              if (!window.confirm(t("¿Borrar el proyecto «{name}»? Sus chats quedan en Recientes.", { name: project.name }))) return;
              await call("project_delete", { id: project.id, chats: false });
              await reloadProjects();
              reloadList();
              setView({ kind: "projects" });
            }}
          />
        </section>
      ) : (
        <section className="chat-main">
          {(current || chatProject) && (
            <ChatHeader
              title={chat?.title ?? ""}
              project={chatProject}
              folder={chat?.folder ?? ""}
              mode={chat?.mode ?? "read"}
              projects={projects}
              canEdit={!!current}
              onProject={() => chatProject && newChat(chatProject.id)}
              onRename={(title) => current && rename(current, title)}
              onMove={moveTo}
              onDelete={() => current && deleteChat(current)}
            />
          )}
          <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
            <div className="chat-thread">
              {empty && (
                <div className="chat-empty">
                  <Logo size={44} />
                  <h2>{settings?.user_name ? t("¿En qué te ayudo, {name}?", { name: settings.user_name.split(" ")[0] }) : t("¿En qué te ayudo?")}</h2>
                  <p className="muted">{t("Elegí un modelo o un agente de OpenCue y prendé lo que querés que use: tu memoria de brain, tus reuniones de Lumina o la web. Sumá archivos, una carpeta de trabajo o skills con +.")}</p>
                  <div className="chat-suggest">
                    {[t("¿Qué tengo anotado sobre mis proyectos?"), t("Resumime mi última reunión"), t("Buscá en la web las novedades de Tauri"), t("Armame una página interactiva con un pomodoro")].map((s) => (
                      <button key={s} onClick={() => (setDraft((d) => ({ ...d, text: s })), window.dispatchEvent(new Event("ws-focus-composer")))}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <UserMessage key={i} m={m} busy={running} onEdit={(text) => send({ text, files: m.files ?? [], truncate: i, agent: m.agent })} />
                ) : (
                  <BotMessage
                    key={i}
                    m={m}
                    name={modelName(m.model)}
                    onRegenerate={!running && i === messages.length - 1 && lastUser >= 0 ? () => send({ text: messages[lastUser].text, files: messages[lastUser].files ?? [], truncate: lastUser, agent: messages[lastUser].agent }) : undefined}
                    onArtifact={openArtifact}
                    activeArtifact={panel ? `${panel.id}#${panel.index + 1}` : undefined}
                    versionOf={versionOf}
                  />
                ),
              )}
              {showPending && pending && <UserMessage m={{ role: "user", text: pending.text, files: pending.files, agent: pending.agent, ts: Date.now(), model: "", tools: [], error: false }} busy />}
              {(running || showPending) && (
                <div className="msg bot">
                  <div className="msg-meta">
                    <Glyph icon={lookOfModel(pending?.agent ? "opencue:" : chat?.model || model)[0]} color={lookOfModel(pending?.agent ? "opencue:" : chat?.model || model)[1]} className="xs" />
                    {pending?.agent ? t("Agente {name}", { name: pending.agent }) : modelName(model)}
                  </div>
                  <Thinking text={live?.thinking ?? ""} live={!live?.text} />
                  <ToolList tools={live?.tools ?? []} live />
                  {live?.text ? (
                    <AnswerBody text={live.text} onArtifact={openArtifact} activeArtifact={panel ? `${panel.id}#${panel.index + 1}` : undefined} versionOf={versionOf} />
                  ) : (
                    !live?.thinking && (
                      <div className="typing" aria-label={t("Pensando")}>
                        <span />
                        <span />
                        <span />
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
          {composer}
          {dragging && (
            <div className="drop-hint">
              <b>{t("Soltá para adjuntar")}</b>
              <span>{t("Archivos se adjuntan; una carpeta pasa a ser la carpeta de trabajo.")}</span>
            </div>
          )}
        </section>
      )}

      {panel && panelVersions && panelVersions.length > 0 && (
        <ArtifactPanel versions={panelVersions} index={Math.min(panel.index, panelVersions.length - 1)} onIndex={(i) => setPanel({ ...panel, index: i, follow: false })} onClose={() => setPanel(null)} />
      )}

      <ProjectModal
        open={projectModal.open}
        project={projectModal.project}
        models={shown}
        skills={skills}
        onClose={() => setProjectModal({ open: false, project: null })}
        onSaved={async (p) => {
          setProjectModal({ open: false, project: null });
          await reloadProjects();
          if (!projectModal.project) {
            setProjects((ps) => (ps.some((x) => x.id === p.id) ? ps : [p, ...ps]));
            setDraftProject(p.id);
            setDraft({ ...emptyDraft(), folder: p.folder, mode: p.mode || "read" });
            setCurrent(null);
            setView({ kind: "project", id: p.id });
          } else if (draftProject === p.id && !current) {
            setDraft((d) => ({ ...d, folder: p.folder, mode: p.mode || "read" }));
          }
        }}
      />
      <SkillsModal open={skillsOpen} onClose={() => setSkillsOpen(false)} skills={skills} onChanged={() => reloadSkills(draft.folder)} />
    </div>
  );
}

function ChatHeader({
  title,
  project,
  folder,
  mode,
  projects,
  canEdit,
  onProject,
  onRename,
  onMove,
  onDelete,
}: {
  title: string;
  project?: Project;
  folder: string;
  mode: string;
  projects: Project[];
  canEdit: boolean;
  onProject: () => void;
  onRename: (t: string) => void;
  onMove: (id: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const menu = usePopover();
  const [editing, setEditing] = useState(false);
  return (
    <div className="chat-head">
      {project && (
        <>
          <button className="crumb" onClick={onProject}>
            <Folder /> {project.name}
          </button>
          <span className="muted">/</span>
        </>
      )}
      {editing ? (
        <input className="rename title" defaultValue={title} autoFocus onBlur={(e) => (setEditing(false), onRename(e.target.value))} onKeyDown={(e) => (e.key === "Enter" ? (setEditing(false), onRename((e.target as HTMLInputElement).value)) : e.key === "Escape" && setEditing(false))} />
      ) : (
        <button className="chat-title" onClick={() => canEdit && setEditing(true)} title={canEdit ? t("Renombrar") : undefined}>
          {title || (canEdit ? t("Sin título") : t("Nuevo chat"))}
        </button>
      )}
      {folder && (
        <span className="chip mono" title={folder}>
          {mode === "edit" ? <Pencil size={12} /> : <Lock size={12} />} {folder.split(/[\\/]/).pop()}
        </span>
      )}
      <span className="spacer" />
      {canEdit && (
        <div ref={menu.ref} style={{ position: "relative" }}>
          <button className="icon-btn sm" onClick={() => menu.setOpen(!menu.open)} aria-label={t("Más")}>
            <MoreHorizontal />
          </button>
          {menu.open && (
            <div className="popover menu" style={{ right: 0, top: 32, minWidth: 220 }}>
              <button className="menu-item" onClick={() => (menu.setOpen(false), setEditing(true))}>
                <Pencil /> {t("Renombrar")}
              </button>
              <div className="menu-label">{t("Mover a proyecto")}</div>
              {projects.map((p) => (
                <button key={p.id} className={`menu-item ${project?.id === p.id ? "sel" : ""}`} onClick={() => (menu.setOpen(false), onMove(p.id))}>
                  <Folder /> {p.name}
                </button>
              ))}
              {project && (
                <button className="menu-item" onClick={() => (menu.setOpen(false), onMove(""))}>
                  <X /> {t("Sacar del proyecto")}
                </button>
              )}
              {projects.length === 0 && <div className="menu-label">{t("Todavía no tenés proyectos")}</div>}
              <div className="menu-sep" />
              <button className="menu-item danger" onClick={() => (menu.setOpen(false), onDelete())}>
                <Trash2 /> {t("Borrar chat")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
