import { useEffect, useState } from "react";
import { ArrowRight, Check, Download, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "../lib/api";
import { useStore } from "../lib/store";
import { Glyph, Logo, termLook } from "../components/ui";
import { openUrl } from "../lib/open";
import { useT } from "../lib/i18n";

/** WorkStudio's own update (signed bundle from the GitHub release). */
export function useSelfUpdate() {
  const [state, setState] = useState<{ status: "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error"; update?: Update; progress?: number; error?: string }>({ status: "idle" });
  const look = async () => {
    if (!inTauri) return setState({ status: "none" });
    setState({ status: "checking" });
    try {
      const u = await check();
      setState(u ? { status: "available", update: u } : { status: "none" });
    } catch (e) {
      setState({ status: "error", error: String(e) });
    }
  };
  const install = async () => {
    const u = state.update;
    if (!u) return;
    let total = 0;
    let got = 0;
    setState({ status: "downloading", update: u, progress: 0 });
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          setState({ status: "downloading", update: u, progress: total ? got / total : 0 });
        }
      });
      setState({ status: "ready", update: u });
    } catch (e) {
      setState({ status: "error", error: String(e) });
    }
  };
  return { state, look, install };
}

export function Updates() {
  const { updates, checkUpdates, busy, runCommand, apps, info } = useStore();
  const t = useT();
  const self = useSelfUpdate();
  useEffect(() => {
    self.look();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const avail = updates.filter((u) => u.available);
  const appRows = updates.filter((u) => u.kind === "app");
  const cliRows = updates.filter((u) => u.kind === "cli");
  const updateAll = async () => {
    for (const u of avail) await runCommand(t("Actualizar {name}", { name: u.name }), u.command);
  };
  const s = self.state;
  const row = (u: (typeof updates)[number]) => {
    const app = apps.find((a) => a.id === u.id);
    const look = app ? { icon: app.icon, color: app.color } : termLook(u.id);
    return (
      <div key={u.id} className="upd-row">
        <Glyph icon={look.icon} color={look.color} />
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 14 }}>{u.name}</b>
          <div className="vers">
            {u.installed ? <span>{u.current ?? t("versión desconocida")}</span> : <span>{t("no instalado")}</span>}
            {u.latest && u.available && (
              <>
                <ArrowRight size={12} /> <span className="new">{u.latest}</span>
              </>
            )}
            {u.installed && !u.available && u.latest && (
              <>
                · <b>{t("al día")}</b>
              </>
            )}
          </div>
          {u.available && u.notes && <div className="small muted" style={{ marginTop: 4, maxWidth: 620, whiteSpace: "pre-line", maxHeight: 60, overflow: "hidden" }}>{u.notes}</div>}
        </div>
        {u.url ? (
          <button className="icon-btn sm" title={t("Notas de la versión")} onClick={() => openUrl(u.url)}>
            <ExternalLink />
          </button>
        ) : (
          <span />
        )}
        {u.command ? (
          <button className={`btn sm ${u.available ? "primary" : ""}`} onClick={() => runCommand(t(u.installed ? "Actualizar {name}" : "Instalar {name}", { name: u.name }), u.command)}>
            {u.installed ? <RefreshCw /> : <Download />} {t(u.installed ? (u.available ? "Actualizar" : "Reinstalar") : "Instalar")}
          </button>
        ) : (
          <span />
        )}
      </div>
    );
  };
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <h1>{t("Actualizaciones")}</h1>
          <p>{t("WorkStudio revisa GitHub y npm cada pocas horas y te avisa. Las actualizaciones corren en una terminal para que veas cada paso.")}</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => checkUpdates(true)} disabled={!!busy.updates}>
          {busy.updates ? <Loader2 className="spin" /> : <RefreshCw />} {t("Buscar ahora")}
        </button>
        {avail.length > 1 && (
          <button className="btn primary" onClick={updateAll}>
            {t("Actualizar todo ({n})", { n: avail.length })}
          </button>
        )}
      </div>

      <section className="card upd-hero" style={{ marginBottom: 22 }}>
        <Logo size={46} />
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: 15.5 }}>AI WorkStudio {info?.version}</b>
          <div className="small muted">
            {s.status === "checking" && t("Buscando una versión nueva…")}
            {s.status === "none" && t("Tenés la última versión.")}
            {s.status === "idle" && "—"}
            {s.status === "available" && t("Hay una versión nueva: {v}", { v: s.update?.version ?? "" })}
            {s.status === "downloading" && t("Descargando… {p}%", { p: Math.round((s.progress ?? 0) * 100) })}
            {s.status === "ready" && t("Lista. Reiniciá para usarla.")}
            {s.status === "error" && t("No pude revisar: {e}", { e: s.error ?? "" })}
          </div>
        </div>
        {s.status === "available" && (
          <button className="btn primary" onClick={self.install}>
            <Sparkles /> {t("Instalar {name}", { name: s.update?.version ?? "" })}
          </button>
        )}
        {s.status === "ready" && (
          <button className="btn primary" onClick={() => relaunch()}>
            {t("Reiniciar")}
          </button>
        )}
        {(s.status === "none" || s.status === "error") && (
          <button className="btn" onClick={self.look}>
            {s.status === "none" ? <Check /> : <RefreshCw />} {t("Revisar")}
          </button>
        )}
        {(s.status === "checking" || s.status === "downloading") && <Loader2 className="spin" />}
      </section>

      <div className="section-title">{t("Apps")}</div>
      <section className="card">{appRows.length ? appRows.map(row) : <div className="empty small">{t("Revisando…")}</div>}</section>
      <div className="section-title">{t("CLIs de agentes")}</div>
      <section className="card">{cliRows.length ? cliRows.map(row) : <div className="empty small">{t("Revisando…")}</div>}</section>
      <p className="tiny muted" style={{ marginTop: 14 }}>
        {t("¿No ves algo? Las versiones salen de cada release en GitHub y del registro de npm. Ajustá cada cuánto se revisa en Ajustes.")}
      </p>
    </div>
  );
}
