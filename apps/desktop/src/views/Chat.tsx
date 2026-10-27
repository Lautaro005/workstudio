// The chat: talk to Claude Code, Codex, Gemini, a local Ollama model or an OpenCue agent, with pills
// that hand it brain, Lumina and web search through WorkStudio's MCP server.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, Brain, Check, ChevronDown, Globe, Loader2, MessageSquarePlus, NotebookPen, Square, Trash2, Wrench, CircleAlert } from "lucide-react";
import { call, type Chat as ChatT, type ChatModel, type ChatSummary, type McpServer } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { Glyph, Logo, timeAgo, usePopover } from "../components/ui";
import { Markdown } from "../components/Markdown";

type Pill = { id: string; label: string; icon: typeof Brain; tone: string; app?: string };
const PILLS: Pill[] = [
  { id: "brain", label: "brain", icon: Brain, tone: "clay", app: "brain" },
  { id: "lumina", label: "Lumina", icon: NotebookPen, tone: "mustard", app: "lumina" },
  { id: "web", label: "Web", icon: Globe, tone: "olive" },
];

const GROUP_LOOK: Record<string, [string, string]> = {
  "Claude Code": ["sparkles", "clay"],
  Codex: ["cpu", "ink"],
  Gemini: ["gem", "mustard"],
  Ollama: ["box", "ink"],
  OpenCue: ["bot", "olive"],
};

function ModelPicker({ models, value, onChange, loading }: { models: ChatModel[]; value: string; onChange: (id: string) => void; loading: boolean }) {
  const pop = usePopover();
  const t = useT();
  const cur = models.find((m) => m.id === value);
  const groups = [...new Set(models.map((m) => m.group))];
  const look = GROUP_LOOK[cur?.group ?? ""] ?? ["box", "ink"];
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button className="model-btn" onClick={() => pop.setOpen(!pop.open)} aria-haspopup="listbox" aria-expanded={pop.open}>
        {cur ? <Glyph icon={look[0]} color={look[1]} className="xs" /> : <Bot size={15} />}
        <span>{cur ? (cur.group === "OpenCue" ? t("Agente {name}", { name: cur.name }) : cur.name) : loading ? t("Buscando modelos…") : t("Elegí un modelo")}</span>
        <ChevronDown size={14} />
      </button>
      {pop.open && (
        <div className="popover menu model-menu" role="listbox">
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

function ToolChips({ tools, live }: { tools: { name: string; done?: boolean; ok?: boolean }[]; live?: boolean }) {
  if (!tools.length) return null;
  return (
    <div className="tool-chips">
      {tools.map((x, i) => {
        const [app, ...rest] = x.name.split("__");
        const label = rest.length ? `${app} · ${rest.join("__")}` : x.name;
        const busy = live && !x.done && i === tools.length - 1;
        return (
          <span key={i} className={`tool-chip ${x.ok === false ? "bad" : ""}`}>
            {busy ? <Loader2 className="spin" /> : <Wrench />}
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function Chat() {
  const { settings, saveSettings, chatLive, chatTick, chatStarted, toast, statuses } = useStore();
  const t = useT();
  const [list, setList] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatT | null>(null);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const model = settings?.chat_model ?? "";
  const tools = settings?.chat_tools ?? ["brain"];
  const cur = models.find((m) => m.id === model);
  const canTools = cur ? cur.tools : true;

  const reloadList = () => call<ChatSummary[]>("chat_list").then(setList).catch(() => {});
  useEffect(() => {
    reloadList();
    call<McpServer[]>("mcp_list").then(setServers).catch(() => {});
    call<ChatModel[]>("chat_models")
      .then((m) => {
        setModels(m);
        const s = useStore.getState().settings;
        if (m.length && !m.find((x) => x.id === s?.chat_model)) saveSettings({ chat_model: m[0].id });
      })
      .finally(() => setLoadingModels(false));
    const h = () => newChat();
    window.addEventListener("ws-new-chat", h);
    return () => window.removeEventListener("ws-new-chat", h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, live?.text, live?.tools.length, pending]);

  const pillReady = (p: Pill) => {
    if (!p.app) return true;
    const s = servers.find((x) => x.source === `app:${p.app}`);
    return !!s && s.enabled && s.ready && !!statuses[p.app]?.installed;
  };
  const togglePill = (id: string) => saveSettings({ chat_tools: tools.includes(id) ? tools.filter((x) => x !== id) : [...tools, id] });
  const activeTools = canTools ? tools.filter((id) => pillReady(PILLS.find((p) => p.id === id)!)) : [];

  function newChat() {
    setCurrent(null);
    setChat(null);
    setPending(null);
    setTimeout(() => input.current?.focus(), 0);
  }

  const send = async () => {
    const msg = text.trim();
    if (!msg || running) return;
    if (!model) {
      toast(t("Elegí un modelo"), "error");
      return;
    }
    setText("");
    setPending(msg);
    try {
      const id = await call<string>("chat_send", { chat: current, text: msg, model, tools: activeTools });
      chatStarted(id);
      setCurrent(id);
      reloadList();
    } catch (e) {
      setPending(null);
      setText(msg);
      toast(String(e), "error");
    }
  };

  const modelName = (id: string) => {
    const m = models.find((x) => x.id === id);
    return m ? m.name : id.split(":")[1] || id.split(":")[0];
  };

  const messages = chat?.messages ?? [];
  const showPending = pending && !messages.some((m) => m.role === "user" && m.text === pending && Date.now() - m.ts < 60000);
  const empty = messages.length === 0 && !pending;
  const suggestions = useMemo(
    () => [t("¿Qué tengo anotado sobre mis proyectos?"), t("Resumime mi última reunión"), t("Buscá en la web las novedades de Tauri")],
    [t],
  );

  return (
    <div className="chat-view">
      <aside className="chat-list">
        <button className="btn primary sm" onClick={newChat} style={{ width: "100%" }}>
          <MessageSquarePlus /> {t("Nuevo chat")}
        </button>
        <div className="chat-items">
          {list.length === 0 && <div className="tiny muted" style={{ padding: "10px 6px" }}>{t("Tus conversaciones quedan acá, guardadas en tu compu.")}</div>}
          {list.map((c) => (
            <div key={c.id} className={`chat-item ${c.id === current ? "on" : ""}`}>
              <button className="chat-item-main" onClick={() => setCurrent(c.id)}>
                <span className="chat-item-title">{c.title || t("Sin título")}</span>
                <span className="tiny muted">
                  {chatLive[c.id] ? t("respondiendo…") : timeAgo(c.updated)} · {modelName(c.model)}
                </span>
              </button>
              <button
                className="icon-btn sm"
                title={t("Borrar")}
                aria-label={t("Borrar")}
                onClick={async () => {
                  await call("chat_delete", { id: c.id });
                  if (c.id === current) newChat();
                  reloadList();
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-main">
        <div className="chat-scroll" ref={scroller}>
          <div className="chat-thread">
            {empty && (
              <div className="chat-empty">
                <Logo size={44} />
                <h2>{t("¿En qué te ayudo?")}</h2>
                <p className="muted">{t("Elegí un modelo o un agente de OpenCue y prendé lo que querés que use: tu memoria de brain, tus reuniones de Lumina o la web.")}</p>
                <div className="chat-suggest">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => (setText(s), input.current?.focus())}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="msg user">
                  <div className="bubble">{m.text}</div>
                </div>
              ) : (
                <div key={i} className={`msg bot ${m.error ? "error" : ""}`}>
                  <div className="msg-meta">
                    {modelName(m.model)}
                    {m.error && (
                      <span className="chip clay">
                        <CircleAlert /> {t("Error")}
                      </span>
                    )}
                  </div>
                  <ToolChips tools={m.tools} />
                  <Markdown text={m.text} />
                </div>
              ),
            )}
            {showPending && (
              <div className="msg user">
                <div className="bubble">{pending}</div>
              </div>
            )}
            {(running || showPending) && (
              <div className="msg bot">
                <div className="msg-meta">{modelName(chat?.model || model)}</div>
                <ToolChips tools={live?.tools ?? []} live />
                {live?.text ? (
                  <Markdown text={live.text} />
                ) : (
                  <div className="typing" aria-label={t("Pensando")}>
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={input}
              rows={1}
              value={text}
              placeholder={t("Escribí un mensaje…")}
              aria-label={t("Mensaje")}
              onChange={(e) => {
                setText(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="composer-bar">
              <div className="pills" role="group" aria-label={t("Herramientas")}>
                {PILLS.map((p) => {
                  const ready = pillReady(p);
                  const on = canTools && ready && tools.includes(p.id);
                  const I = p.icon;
                  const why = !canTools ? t("El agente usa sus propias herramientas") : !ready ? t("{name} no está instalada o está fuera del servidor MCP", { name: p.label }) : on ? t("Desactivar {name}", { name: p.label }) : t("Activar {name}", { name: p.label });
                  return (
                    <button key={p.id} className={`pill ${p.tone} ${on ? "on" : ""}`} disabled={!canTools || !ready} onClick={() => togglePill(p.id)} title={why} aria-pressed={on}>
                      <I /> {p.label}
                    </button>
                  );
                })}
              </div>
              <span className="spacer" />
              <ModelPicker models={models} value={model} onChange={(id) => saveSettings({ chat_model: id })} loading={loadingModels} />
              {running ? (
                <button className="send stop" onClick={() => current && call("chat_stop", { id: current })} title={t("Detener")} aria-label={t("Detener")}>
                  <Square />
                </button>
              ) : (
                <button className="send" onClick={send} disabled={!text.trim() || !model} title={t("Enviar")} aria-label={t("Enviar")}>
                  <ArrowUp />
                </button>
              )}
            </div>
          </div>
          <div className="composer-hint tiny muted">
            {cur?.group === "OpenCue"
              ? t("Le escribís a {name} en OpenCue: responde con sus propias herramientas.", { name: cur.name })
              : activeTools.length
                ? t("Usa: {list}", { list: activeTools.map((x) => PILLS.find((p) => p.id === x)?.label).join(", ") })
                : t("Sin herramientas: responde solo con el modelo.")}
          </div>
        </div>
      </section>
    </div>
  );
}
