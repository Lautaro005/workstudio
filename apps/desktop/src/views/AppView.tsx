// One app inside WorkStudio. It opens on its details; web apps (brain, Lumina) can also be used in a
// child webview laid over the content area (or open there directly, if the user checks that).
// Native apps (OpenCue) open in their own window.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Download, ExternalLink, FolderOpen, Info, Loader2, Maximize2, Play, Plug, RefreshCw, RotateCw, Square, SquareTerminal, Trash2 } from "lucide-react";
import { call, here, inTauri, type AppDef } from "../lib/api";
import { useStore } from "../lib/store";
import { appText, useLang, useT } from "../lib/i18n";
import { CopyLine, Dot, Glyph } from "../components/ui";
import { openUrl, reveal } from "../lib/open";

function Embed({ app }: { app: AppDef }) {
  const host = useRef<HTMLDivElement>(null);
  const overlays = useStore((s) => s.overlays);
  const [err, setErr] = useState("");

  useLayoutEffect(() => {
    if (!inTauri) return;
    const el = host.current;
    if (!el) return;
    let raf = 0;
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        if (overlays > 0 || r.width < 20) {
          call("embed_hide_all");
          return;
        }
        call("embed_show", { id: app.id, url: app.url, x: r.left, y: r.top, w: r.width, h: r.height }).catch((e) => setErr(String(e)));
      });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
      call("embed_hide_all");
    };
  }, [app.id, app.url, overlays]);

  return (
    <div className="embed-host" ref={host}>
      {!inTauri ? (
        <iframe title={app.name} src={app.url} style={{ border: 0, width: "100%", height: "100%" }} />
      ) : (
        <div className="placeholder">{err ? <span>{err}</span> : <Loader2 className="spin" />}</div>
      )}
    </div>
  );
}

function Details({ app, onOpen }: { app: AppDef; onOpen: () => void }) {
  const { statuses, busy, start, stop, runCommand, updates, go, reloadCatalog, toast, settings, saveSettings } = useStore();
  const t = useT();
  const lang = useLang();
  const text = appText(app, lang);
  const st = statuses[app.id];
  const upd = updates.find((u) => u.id === app.id);
  const b = busy[app.id];
  const web = app.kind === "web" && !!app.url;
  const openFirst = (settings?.open_in_app ?? []).includes(app.id);
  const setOpenFirst = (v: boolean) => {
    const list = (settings?.open_in_app ?? []).filter((x) => x !== app.id);
    saveSettings({ open_in_app: v ? [...list, app.id] : list });
  };
  return (
    <div className="page">
      <div className="card hero-app" style={{ marginBottom: 16 }}>
        <Glyph icon={app.icon} color={app.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{app.name}</h1>
          <p className="muted" style={{ fontSize: 15 }}>
            {text.tagline}
          </p>
          <div className="row" style={{ marginTop: 10 }}>
            <Dot state={b ? "busy" : st?.running ? "on" : st?.installed ? "idle" : "off"} />
            <span className="small" style={{ fontWeight: 650 }}>
              {st?.running ? t("Corriendo") : st?.installed ? t("Instalado, detenido") : t("No instalado")}
            </span>
            {st?.version && <span className="chip mono">{st.version}</span>}
            {upd?.available && <span className="chip mustard">{t("Hay {v}", { v: upd.latest ?? "" })}</span>}
          </div>
        </div>
        <div className="col" style={{ alignItems: "stretch", minWidth: 180 }}>
          {!st?.installed ? (
            <button className="btn primary lg" onClick={() => runCommand(t("Instalar {name}", { name: app.name }), here(app.install))}>
              <Download /> {t("Instalar")}
            </button>
          ) : app.kind === "native" ? (
            <button className="btn primary lg" onClick={() => start(app.id)}>
              <ArrowUpRight /> {t("Abrir {name}", { name: app.name })}
            </button>
          ) : st.running ? (
            <button className="btn primary lg" onClick={onOpen}>
              <ArrowRight /> {t("Abrir")}
            </button>
          ) : (
            <button className="btn olive lg" onClick={() => start(app.id).then(() => web && onOpen())} disabled={!!b}>
              {b ? <Loader2 className="spin" /> : <Play />} {t("Iniciar")}
            </button>
          )}
          {st?.running && (
            <button className="btn" onClick={() => stop(app.id)}>
              <Square /> {app.kind === "native" ? t("Cerrar") : t("Detener")}
            </button>
          )}
          {web && st?.installed && (
            <label className="check">
              <input type="checkbox" checked={openFirst} onChange={(e) => setOpenFirst(e.target.checked)} />
              <span>{t("Abrir directo en la app")}</span>
            </label>
          )}
        </div>
      </div>

      <div className="app-detail">
        <section className="card">
          <div className="card-head">
            <h3>{t("Qué hace")}</h3>
          </div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <p style={{ color: "var(--ink-2)", lineHeight: 1.6 }}>{text.description}</p>
            <div className="row wrap">
              {st?.installed && (
                <button className="btn" onClick={() => runCommand(t("Actualizar {name}", { name: app.name }), here(app.update))}>
                  <RefreshCw /> {t("Actualizar")}
                </button>
              )}
              {app.cli && st?.installed && (
                <button className="btn" onClick={() => runCommand(app.name, "", app.home || "~")}>
                  <SquareTerminal /> {t("Terminal")}
                </button>
              )}
              {app.mcp && (
                <button className="btn" onClick={() => go("mcp")}>
                  <Plug /> MCP
                </button>
              )}
              {app.site && (
                <button className="btn ghost" onClick={() => openUrl(app.site)}>
                  <ExternalLink /> {t("Sitio")}
                </button>
              )}
              {!app.builtin && (
                <button
                  className="btn ghost danger"
                  onClick={async () => {
                    await call("app_remove", { id: app.id });
                    toast(t("Saqué {name} de WorkStudio", { name: app.name }), "success");
                    await reloadCatalog();
                    go("apps");
                  }}
                >
                  <Trash2 /> {t("Quitar")}
                </button>
              )}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h3>{t("Instalación")}</h3>
          </div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <dl className="kv">
              <dt>{t("Ubicación")}</dt>
              <dd className="mono">
                {st?.location ? (
                  <button className="row link" onClick={() => reveal(st.location!)}>
                    {st.location} <FolderOpen size={13} />
                  </button>
                ) : (
                  "—"
                )}
              </dd>
              {app.url && (
                <>
                  <dt>{t("Dirección")}</dt>
                  <dd className="mono">{app.url}</dd>
                </>
              )}
              {app.cli && (
                <>
                  <dt>{t("Comando")}</dt>
                  <dd className="mono">{app.cli}</dd>
                </>
              )}
              {app.repo && (
                <>
                  <dt>{t("Repositorio")}</dt>
                  <dd>
                    <button className="link" onClick={() => openUrl(`https://github.com/${app.repo}`)}>
                      github.com/{app.repo}
                    </button>
                  </dd>
                </>
              )}
              {upd?.latest && (
                <>
                  <dt>{t("Última versión")}</dt>
                  <dd className="mono">{upd.latest}</dd>
                </>
              )}
            </dl>
            <div className="field">
              <label>{st?.installed ? t("Actualizar desde la terminal") : t("Instalar desde la terminal")}</label>
              <CopyLine text={here(st?.installed ? app.update : app.install)} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export function AppView({ id }: { id: string }) {
  const { apps, statuses, busy, settings, takeAppIntent } = useStore();
  const t = useT();
  const app = apps.find((a) => a.id === id);
  const st = app ? statuses[app.id] : undefined;
  const wantsApp = () => useStore.getState().appIntent === id || (settings?.open_in_app ?? []).includes(id);
  const [tab, setTab] = useState<"app" | "info">(() => (wantsApp() ? "app" : "info"));
  useEffect(() => {
    setTab(wantsApp() ? "app" : "info");
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Abrir" from a card or the details page asks for the app itself.
  const intent = useStore((s) => s.appIntent);
  useEffect(() => {
    if (intent === id && takeAppIntent(id)) setTab("app");
  }, [intent, id, takeAppIntent]);
  if (!app) return <div className="empty">{t("Esta app ya no está en el catálogo.")}</div>;
  const canEmbed = app.kind === "web" && !!app.url && !!st?.running;
  if (!canEmbed || tab === "info") {
    return (
      <div className="app-view">
        {canEmbed && <AppBar app={app} tab={tab} setTab={setTab} />}
        <div className="content">
          <Details app={app} onOpen={() => setTab("app")} />
        </div>
      </div>
    );
  }
  return (
    <div className="app-view">
      <AppBar app={app} tab={tab} setTab={setTab} />
      <Embed app={app} />
      {busy[app.id] === "stop" && <div className="placeholder">{t("Deteniendo…")}</div>}
    </div>
  );
}

function AppBar({ app, tab, setTab }: { app: AppDef; tab: string; setTab: (t: "app" | "info") => void }) {
  const { statuses, stop } = useStore();
  const t = useT();
  const st = statuses[app.id];
  return (
    <div className="appbar">
      <Glyph icon={app.icon} color={app.color} />
      <b>{app.name}</b>
      <Dot state={st?.running ? "on" : "idle"} />
      <span className="muted mono small">{app.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
      <div className="seg" style={{ marginLeft: 12 }}>
        <button className={tab === "info" ? "on" : ""} onClick={() => setTab("info")}>
          <Info /> {t("Detalles")}
        </button>
        <button className={tab === "app" ? "on" : ""} onClick={() => setTab("app")}>
          <ArrowUpRight /> {t("App")}
        </button>
      </div>
      <span className="spacer" />
      {tab === "app" && (
        <>
          <button className="icon-btn sm" title={t("Recargar")} onClick={() => call("embed_reload", { id: app.id })}>
            <RotateCw />
          </button>
          <button className="icon-btn sm" title={t("Abrir en el navegador")} onClick={() => openUrl(app.url)}>
            <Maximize2 />
          </button>
        </>
      )}
      <button className="btn sm" onClick={() => stop(app.id)}>
        <Square /> {t("Detener")}
      </button>
    </div>
  );
}
