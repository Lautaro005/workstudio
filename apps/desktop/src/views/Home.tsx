import { ArrowRight, Download, ExternalLink, MoreHorizontal, Play, Plug, RefreshCw, Square, SquareTerminal, Loader2, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { call, here, type AppDef, type McpServer } from "../lib/api";
import { PROFILES, useStore } from "../lib/store";
import { appText, locale, useLang, useT } from "../lib/i18n";
import { Dot, Glyph, Logo, NoteIcon, timeAgo, usePopover, termLook } from "../components/ui";
import { openAction } from "../components/Shell";
import { openUrl } from "../lib/open";

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

export function AppCard({ app }: { app: AppDef }) {
  const { statuses, busy, start, stop, go, openApp, runCommand, updates } = useStore();
  const t = useT();
  const lang = useLang();
  const st = statuses[app.id];
  const upd = updates.find((u) => u.id === app.id && u.available);
  const menu = usePopover();
  const b = busy[app.id];
  const state = b ? "busy" : st?.running ? "on" : st?.installed ? "idle" : "off";
  const label = b === "start" ? t("Iniciando…") : b === "stop" ? t("Deteniendo…") : st?.running ? t("Corriendo") : st?.installed ? t("Detenido") : t("No instalado");
  return (
    <article className="card app-card">
      <span className={`stripe ${app.color}`} />
      <div className="app-card-top">
        <Glyph icon={app.icon} color={app.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{app.name}</h3>
          <div className="tag">{appText(app, lang).tagline}</div>
        </div>
        <div ref={menu.ref} style={{ position: "relative" }}>
          <button className="icon-btn sm" onClick={() => menu.setOpen(!menu.open)} aria-label={t("Más")}>
            <MoreHorizontal />
          </button>
          {menu.open && (
            <div className="popover menu" style={{ right: 0, top: 30 }}>
              {st?.installed && (
                <button className="menu-item" onClick={() => (menu.setOpen(false), runCommand(t("Actualizar {name}", { name: app.name }), here(app.update)))}>
                  <RefreshCw /> {t("Actualizar")}
                </button>
              )}
              {st?.running && (
                <button className="menu-item" onClick={() => (menu.setOpen(false), stop(app.id))}>
                  <Square /> {t("Detener")}
                </button>
              )}
              <button className="menu-item" onClick={() => (menu.setOpen(false), go(`app:${app.id}`))}>
                <ArrowRight /> {t("Detalles")}
              </button>
              {app.site && (
                <button className="menu-item" onClick={() => (menu.setOpen(false), openUrl(app.site))}>
                  <ExternalLink /> {t("Sitio web")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="status">
        <Dot state={state as "on"} /> {label}
        {st?.version && <span className="muted mono">· {st.version}</span>}
        {upd && <span className="chip mustard">{t("Nueva {v}", { v: upd.latest ?? "" })}</span>}
      </div>
      <div className="actions">
        {!st?.installed ? (
          <button className="btn primary" onClick={() => runCommand(t("Instalar {name}", { name: app.name }), here(app.install))}>
            <Download /> {t("Instalar")}
          </button>
        ) : st.running || app.kind === "native" ? (
          <button className="btn primary" onClick={() => (app.kind === "native" ? start(app.id) : openApp(app.id))} disabled={!!b}>
            <ArrowRight /> {t("Abrir")}
          </button>
        ) : (
          <button className="btn olive" onClick={() => start(app.id).then(() => openApp(app.id))} disabled={!!b}>
            {b ? <Loader2 className="spin" /> : <Play />} {t("Iniciar")}
          </button>
        )}
        <button className="btn" onClick={() => go(`app:${app.id}`)}>
          {t("Detalles")}
        </button>
      </div>
    </article>
  );
}

export function Home() {
  const { apps, statuses, notes, settings, updates, go, addPane, clis } = useStore();
  const t = useT();
  const lang = useLang();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [cliOk, setCliOk] = useState<Record<string, boolean>>({});
  useEffect(() => {
    call<McpServer[]>("mcp_list").then(setServers).catch(() => {});
    call<{ id: string; installed: boolean }[]>("clis_status").then((l) => setCliOk(Object.fromEntries(l.map((c) => [c.id, c.installed]))));
  }, []);
  const running = Object.values(statuses).filter((s) => s.running).length;
  const avail = updates.filter((u) => u.available).length;
  const carried = servers.filter((s) => s.enabled && s.ready && !s.url);
  const recent = [...notes].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const name = settings?.user_name?.split(" ")[0];
  const date = new Date().toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" });
  const quick = PROFILES.filter((p) => ["claude", "codex", "gemini", "shell"].includes(p.id));
  const binOk = (bin?: string) => {
    if (!bin) return true;
    const c = clis.find((x) => x.bin === bin);
    return c ? cliOk[c.id] !== false : true;
  };
  return (
    <div className="page">
      <div className="hello">
        <div>
          <div className="date">{date}</div>
          <h1>
            {t(greeting())}
            {name ? (
              <>
                , <em>{name}</em>.
              </>
            ) : (
              "."
            )}
          </h1>
          <div className="summary">
            <span>
              <Dot state={running ? "on" : "idle"} /> {t("{a} de {b} apps corriendo", { a: running, b: apps.length })}
            </span>
            <span>
              <Plug size={15} /> {t("{n} apps en el servidor MCP", { n: carried.length })}
            </span>
            <span>
              <RefreshCw size={15} /> {avail ? <b>{avail === 1 ? t("1 actualización") : t("{n} actualizaciones", { n: avail })}</b> : t("Todo al día")}
            </span>
          </div>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => go("chat")}>
          <MessageSquare /> {t("Abrir el chat")}
        </button>
      </div>

      <div className="app-grid">
        {apps.map((a) => (
          <AppCard key={a.id} app={a} />
        ))}
      </div>

      <div className="home-cols" style={{ marginTop: 18 }}>
        <section className="card">
          <div className="card-head">
            <h3>{t("Actividad reciente")}</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => go("activity")}>
              {t("Ver todo")} <ArrowRight />
            </button>
          </div>
          <div style={{ padding: 6 }}>
            {recent.length === 0 && <div className="empty small">{t("Cuando brain guarde algo, Lumina grabe o haya una actualización, lo vas a ver acá.")}</div>}
            {recent.map((n) => (
              <button key={n.id} className={`note ${n.read ? "" : "unread"}`} onClick={() => openAction(n.action)}>
                <NoteIcon kind={n.kind} app={n.app} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="note-title">{n.title}</div>
                  {n.body && <div className="note-body">{n.body}</div>}
                </div>
                <span className="note-time">{timeAgo(n.ts)}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="col" style={{ gap: 16 }}>
          <section className="card">
            <div className="card-head">
              <h3>{t("Terminal rápida")}</h3>
              <span className="spacer" />
              <span className="chip olive">
                <Plug /> {t("MCP incluido")}
              </span>
            </div>
            <div className="quick">
              {quick.map((p) => {
                const look = termLook(p.id);
                const ok = binOk(p.bin);
                return (
                  <button
                    key={p.id}
                    style={ok ? undefined : { opacity: 0.55 }}
                    onClick={async () => {
                      if (await addPane(p.id)) go("terminals");
                    }}
                  >
                    <Glyph icon={look.icon} color={look.color} />
                    <span>
                      {p.name}
                      <small>{ok ? (p.mcp === "none" ? t("Shell de siempre") : t("Con el servidor de WorkStudio")) : t("No instalado")}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>{t("Servidor MCP")}</h3>
              <span className="spacer" />
              <button className="btn sm ghost" onClick={() => go("mcp")}>
                {t("Configurar")} <ArrowRight />
              </button>
            </div>
            <div className="mesh">
              {servers.length === 0 && <span className="muted small">{t("Instalá una app para compartir sus herramientas.")}</span>}
              {servers
                .filter((s) => !s.url)
                .slice(0, 5)
                .map((s) => {
                  const app = apps.find((a) => s.source === `app:${a.id}`);
                  const live = s.enabled && s.ready;
                  return (
                    <div key={s.name} className="mesh-row">
                      {app ? <Glyph icon={app.icon} color={app.color} /> : <Glyph icon="box" color="ink" />}
                      <b style={{ minWidth: 70 }}>{app?.name ?? s.name}</b>
                      <span className={`mesh-line ${live ? "live" : ""}`} />
                      <span className={`chip ${live ? "olive" : s.enabled ? "mustard" : ""}`}>{live ? t("Incluido") : s.enabled ? t("Falta un dato") : t("Apagado")}</span>
                    </div>
                  );
                })}
              <div className="mesh-hub">
                <Logo size={22} />
                <span>
                  <b className="mono">workstudio</b>
                  <small>{t("Un solo servidor con las herramientas de todas")}</small>
                </span>
              </div>
              <div className="mesh-row" style={{ marginTop: 2 }}>
                <SquareTerminal size={16} className="muted" />
                <span className="muted small">{t("Llega solo a Claude Code, Codex, Gemini y Cursor en las terminales y al chat de WorkStudio.")}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
