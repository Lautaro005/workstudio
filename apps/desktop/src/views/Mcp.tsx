import { useEffect, useState } from "react";
import { CircleAlert, Download, Link2, Loader2, Plug, Plus, Server, Trash2, Unlink, FileCode2, ListTree } from "../components/icons";
import { call, type McpClient, type McpServer } from "../lib/api";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { CopyLine, Glyph, Logo, Modal, Switch } from "../components/ui";

type Agent = { id: string; name: string };
const HUB = "workstudio";

function AddServer({ open, onClose, onSaved, initial }: { open: boolean; onClose: () => void; onSaved: () => void; initial?: McpServer | null }) {
  const toast = useStore((s) => s.toast);
  const t = useT();
  const [kind, setKind] = useState<"stdio" | "http">("stdio");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState("");
  const [desc, setDesc] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(initial?.url ? "http" : "stdio");
    setName(initial?.name ?? "");
    setCommand(initial?.command ?? "");
    setArgs((initial?.args ?? []).join("\n"));
    setUrl(initial?.url ?? "");
    setEnv(Object.entries(initial?.env ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"));
    setDesc(initial?.description ?? "");
  }, [open, initial]);
  const save = async () => {
    const envObj: Record<string, string> = {};
    env.split("\n").forEach((l) => {
      const i = l.indexOf("=");
      if (i > 0) envObj[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    });
    try {
      await call("mcp_save", {
        server: {
          name,
          command: kind === "stdio" ? command.trim() : "",
          args: kind === "stdio" ? args.split("\n").map((a) => a.trim()).filter(Boolean) : [],
          env: envObj,
          url: kind === "http" ? url.trim() : "",
          headers: {},
          enabled: true,
          source: initial?.source ?? "user",
          description: desc,
        },
      });
      toast(t("Guardé {name}", { name }), "success");
      onSaved();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    }
  };
  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-head">
        <h2>{initial ? t("Editar {name}", { name: initial.name }) : t("Agregar un servidor MCP")}</h2>
        <p>{t("Se suma al servidor de WorkStudio: lo reciben las terminales, el chat y los clientes que conectes.")}</p>
      </div>
      <div className="modal-body">
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          <button className={kind === "stdio" ? "on" : ""} onClick={() => setKind("stdio")}>
            {t("Comando local")}
          </button>
          <button className={kind === "http" ? "on" : ""} onClick={() => setKind("http")}>
            {t("URL (HTTP)")}
          </button>
        </div>
        <div className="field">
          <label>{t("Nombre")}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="github" disabled={!!initial} />
        </div>
        {kind === "stdio" ? (
          <>
            <div className="field">
              <label>{t("Comando")}</label>
              <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </div>
            <div className="field">
              <label>{t("Argumentos")}</label>
              <textarea className="textarea mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder={"-y\n@modelcontextprotocol/server-filesystem\n~/Documents"} />
              <span className="hint">{t("Uno por línea.")}</span>
            </div>
          </>
        ) : (
          <div className="field">
            <label>URL</label>
            <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/mcp" />
            <span className="hint">{t("Los servidores HTTP se pasan aparte: el servidor de WorkStudio junta los locales.")}</span>
          </div>
        )}
        <div className="field">
          <label>{t("Variables de entorno")}</label>
          <textarea className="textarea mono" style={{ minHeight: 60 }} value={env} onChange={(e) => setEnv(e.target.value)} placeholder="API_KEY=…" />
          <span className="hint">{t("CLAVE=valor, una por línea. Quedan en ~/.workstudio/mcp.json, solo en tu compu.")}</span>
        </div>
        <div className="field">
          <label>{t("Descripción (opcional)")}</label>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("Para qué sirve")} />
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" onClick={save} disabled={!name || (kind === "stdio" ? !command : !url)}>
          {t("Guardar")}
        </button>
      </div>
    </Modal>
  );
}

type Preview = { claude: string; codex: string; workspace: string; members: string[] };

export function Mcp() {
  const { apps, toast, settings, saveSettings, refreshLaunch } = useStore();
  const t = useT();
  const [tab, setTab] = useState<"servers" | "clients" | "config">("servers");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [busy, setBusy] = useState("");

  const load = async () => {
    const [s, c] = await Promise.all([call<McpServer[]>("mcp_list"), call<McpClient[]>("mcp_clients")]);
    setServers(s);
    setClients(c);
    refreshLaunch();
  };
  useEffect(() => {
    load();
    call<Agent[]>("opencue_agents").then(setAgents).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === "config") call<Preview>("mcp_preview").then(setPreview);
  }, [tab, servers]);

  const toggle = async (s: McpServer, v: boolean) => {
    await call("mcp_toggle", { name: s.name, enabled: v });
    setTools(null);
    load();
  };
  const setClient = async (c: McpClient, connect: boolean) => {
    setBusy(c.id);
    try {
      await call("mcp_client_set", { id: c.id, connect });
      toast(connect ? t("{name} conectado. Reinicialo para que cargue las herramientas.", { name: c.name }) : t("{name} desconectado", { name: c.name }), "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy("");
      load();
    }
  };
  const listTools = async () => {
    setLoadingTools(true);
    try {
      setTools(await call<{ name: string; description: string }[]>("mcp_hub_tools"));
    } finally {
      setLoadingTools(false);
    }
  };
  const mine = servers.filter((s) => s.source.startsWith("app:"));
  const added = servers.filter((s) => !s.source.startsWith("app:"));
  const carried = servers.filter((s) => s.enabled && s.ready && !s.url);
  const external = clients.flatMap((c) => c.external.map((x) => ({ ...x, client: c })));

  const row = (s: McpServer) => {
    const app = apps.find((a) => s.source === `app:${a.id}`);
    return (
      <div key={s.name} className="server">
        {app ? <Glyph icon={app.icon} color={app.color} /> : <Glyph icon="box" color="ink" />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="server-name">
            {app?.name ?? s.name}
            {!app && <span className="chip">{s.source.startsWith("import:") ? t("de {name}", { name: s.source.slice(7) }) : t("propio")}</span>}
            {s.url ? <span className="chip">{t("HTTP, aparte")}</span> : <span className="chip mono">{s.name}__*</span>}
          </div>
          {s.description && <div className="small muted">{s.description}</div>}
          <div className="server-cmd">{s.url || [s.command, ...s.args].join(" ")}</div>
          {!s.ready && (
            <div className="warn-line">
              <CircleAlert /> {s.problem}
            </div>
          )}
          {s.source === "app:opencue" && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small muted">{t("Agente:")}</span>
              <select
                className="select"
                style={{ width: 220, height: 30 }}
                value={settings?.opencue_agent ?? ""}
                onChange={async (e) => {
                  await saveSettings({ opencue_agent: e.target.value });
                  load();
                }}
              >
                <option value="">{t("Elegí un agente…")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {agents.length === 0 && <span className="tiny muted">{t("No encontré agentes (¿abriste OpenCue alguna vez?)")}</span>}
            </div>
          )}
        </div>
        {!app && (
          <>
            <button className="btn sm ghost" onClick={() => (setEditing(s), setAdding(true))}>
              {t("Editar")}
            </button>
            <button
              className="icon-btn sm"
              title={t("Quitar")}
              onClick={async () => {
                await call("mcp_remove", { name: s.name });
                load();
              }}
            >
              <Trash2 />
            </button>
          </>
        )}
        <Switch on={s.enabled} onChange={(v) => toggle(s, v)} label={t("Incluir {name}", { name: s.name })} />
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("Servidor MCP")}</h1>
          <p>{t("WorkStudio junta las herramientas de tus apps en un solo servidor, workstudio. Los agentes ven uno solo, con los tools de todas.")}</p>
        </div>
        <span className="spacer" />
        <button className="btn primary" onClick={() => (setEditing(null), setAdding(true))}>
          <Plus /> {t("Agregar servidor")}
        </button>
      </div>

      <div className="tabs">
        <button className={tab === "servers" ? "on" : ""} onClick={() => setTab("servers")}>
          <Server size={15} /> {t("Servidores")} <span className="nav-badge soft">{carried.length}</span>
        </button>
        <button className={tab === "clients" ? "on" : ""} onClick={() => setTab("clients")}>
          <Link2 size={15} /> {t("Clientes")}
        </button>
        <button className={tab === "config" ? "on" : ""} onClick={() => setTab("config")}>
          <FileCode2 size={15} /> {t("Config generada")}
        </button>
      </div>

      {tab === "servers" && (
        <>
          <section className="card hub-card">
            <Logo size={38} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="server-name">
                <span className="mono">workstudio</span>
                <span className="chip olive">{t("{n} incluidos", { n: carried.length })}</span>
              </div>
              <div className="small muted">{t("Las herramientas llegan como brain__*, lumina__*, opencue__*. El chat suma web__* si activás Web.")}</div>
            </div>
            <button className="btn sm" onClick={listTools} disabled={loadingTools || carried.length === 0}>
              {loadingTools ? <Loader2 className="spin" /> : <ListTree />} {tools ? t("{n} herramientas", { n: tools.length }) : t("Ver herramientas")}
            </button>
          </section>
          {tools && (
            <section className="card tool-list">
              {tools.map((x) => (
                <div key={x.name} className="tool-row">
                  <span className="mono">{x.name}</span>
                  <span className="small muted">{x.description.replace(/^\[[^\]]+\]\s*/, "")}</span>
                </div>
              ))}
            </section>
          )}

          <div className="section-title">{t("De tus apps")}</div>
          <section className="card">
            {mine.length === 0 && <div className="empty">{t("Instalá brain, Lumina u OpenCue para compartir sus herramientas.")}</div>}
            {mine.map(row)}
          </section>

          {added.length > 0 && (
            <>
              <div className="section-title">{t("Agregados por vos")}</div>
              <section className="card">{added.map(row)}</section>
            </>
          )}

          {external.length > 0 && (
            <>
              <div className="section-title">{t("Encontrados en tus clientes")}</div>
              <p className="small muted" style={{ margin: "-4px 0 10px" }}>
                {t("Están en la config de otros programas. Si importás uno, se suma al servidor de WorkStudio.")}
              </p>
              <section className="card">
                {external.map((x) => (
                  <div key={`${x.client.id}:${x.name}`} className="server">
                    <Glyph icon="box" color="ink" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="server-name">
                        {x.name} <span className="chip">{t("en {name}", { name: x.client.name })}</span>
                      </div>
                      <div className="server-cmd">{x.summary}</div>
                    </div>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        try {
                          await call("mcp_import", { client: x.client.id, name: x.name });
                          toast(t("{name} ahora es parte de WorkStudio", { name: x.name }), "success");
                          load();
                        } catch (e) {
                          toast(String(e), "error");
                        }
                      }}
                    >
                      <Download /> {t("Importar")}
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}

      {tab === "clients" && (
        <>
          <p className="muted" style={{ marginBottom: 14, maxWidth: 720 }}>
            {t("Conectar escribe el servidor workstudio en la config del cliente y saca las entradas sueltas de tus apps, para que no aparezcan dos veces (antes hace una copia .bak-workstudio). Las terminales y el chat de WorkStudio no lo necesitan.")}
          </p>
          <div className="clients">
            {clients.map((c) => {
              const full = c.connected.includes(HUB);
              return (
                <div key={c.id} className="card client">
                  <div className="client-top">
                    <span className={`glyph ${c.detected ? "clay" : "ink"}`} style={{ width: 34, height: 34, borderRadius: 10 }}>
                      <Plug size={16} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <b>{c.name}</b>
                      <div className="tiny muted">{c.detected ? (full ? t("Con el servidor workstudio") : t("Detectado")) : t("No detectado")}</div>
                    </div>
                    <span className="spacer" />
                    {full && <span className="chip olive">{t("Conectado")}</span>}
                  </div>
                  <div className="path" title={c.path}>
                    {c.path}
                  </div>
                  <div className="row">
                    <button className={`btn sm ${full ? "" : "primary"}`} style={{ flex: 1 }} disabled={busy === c.id || carried.length === 0} onClick={() => setClient(c, true)}>
                      {busy === c.id ? <Loader2 className="spin" /> : <Link2 />}
                      {full ? t("Volver a escribir") : t("Conectar")}
                    </button>
                    {c.connected.length > 0 && (
                      <button className="btn sm ghost" disabled={busy === c.id} onClick={() => setClient(c, false)} title={t("Quitar el servidor de WorkStudio")}>
                        <Unlink />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "config" && preview && (
        <div className="col" style={{ gap: 16 }}>
          <section className="card card-pad col" style={{ gap: 10 }}>
            <b>{t("Un solo servidor")}</b>
            <p className="small muted">
              {t("Incluye: {list}. Cada vez que un agente lo arranca, WorkStudio levanta esos servidores y le pasa sus herramientas juntas.", { list: preview.members.join(", ") || "—" })}
            </p>
          </section>
          <section className="card card-pad col" style={{ gap: 10 }}>
            <b>Claude Code · Cursor · Claude Desktop</b>
            <pre className="code">{preview.claude}</pre>
          </section>
          <section className="card card-pad col" style={{ gap: 10 }}>
            <b>{t("Codex (config.toml)")}</b>
            <pre className="code">{preview.codex}</pre>
          </section>
          <section className="card card-pad col" style={{ gap: 10 }}>
            <b>{t("Workspace de las terminales")}</b>
            <p className="small muted">{t("Ahí viven .mcp.json (Claude Code), .cursor/mcp.json, .gemini/settings.json, .vscode/mcp.json y un AGENTS.md que explica las herramientas.")}</p>
            <CopyLine text={preview.workspace} />
          </section>
        </div>
      )}

      <AddServer open={adding} onClose={() => setAdding(false)} onSaved={load} initial={editing} />
    </div>
  );
}
