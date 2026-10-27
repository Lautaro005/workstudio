import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Info, Download, Brain, Bot, NotebookPen } from "lucide-react";
import { Palette, ROUTE_ORDER, Sidebar, Topbar } from "./components/Shell";
import { Dot, Glyph, Modal } from "./components/ui";
import { here } from "./lib/api";
import { useStore } from "./lib/store";
import { appText, resolveLang, translate, useLang, useT } from "./lib/i18n";
import { Home } from "./views/Home";
import { Apps } from "./views/Apps";
import { AppView } from "./views/AppView";
import { Terminals } from "./views/Terminals";
import { Mcp } from "./views/Mcp";
import { Activity } from "./views/Activity";
import { Updates } from "./views/Updates";
import { Settings } from "./views/Settings";
import { Chat } from "./views/Chat";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "success" ? <CircleCheck /> : t.kind === "error" ? <CircleAlert /> : <Info />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Welcome() {
  const { settings, saveSettings, apps, statuses, runCommand } = useStore();
  const t = useT();
  const lang = useLang();
  const [name, setName] = useState(settings?.user_name ?? "");
  const open = !!settings && !settings.onboarded;
  const done = () => saveSettings({ onboarded: true, user_name: name.trim() });
  return (
    <Modal open={open} onClose={done} className="welcome-modal">
      <div className="welcome">
        <div className="welcome-art">
          <div className="tiles">
            <span>
              <Brain />
            </span>
            <span>
              <Bot />
            </span>
            <span>
              <NotebookPen />
            </span>
          </div>
          <div>
            <h2>
              {t("Tus IAs locales,")} <em>{t("en un solo estudio.")}</em>
            </h2>
            <p>{t("brain recuerda, Lumina escucha, OpenCue trabaja. WorkStudio las junta: estado, avisos, actualizaciones, MCP compartido, chat y terminales.")}</p>
          </div>
        </div>
        <div className="welcome-body">
          <div className="row">
            <h3 className="display" style={{ fontSize: 22, fontWeight: 560 }}>
              {t("Empecemos")}
            </h3>
            <span className="spacer" />
            <div className="seg" role="group" aria-label={t("Idioma")}>
              {(["es", "en"] as const).map((l) => (
                <button key={l} className={lang === l ? "on" : ""} onClick={() => saveSettings({ language: l })}>
                  {l === "es" ? "Español" : "English"}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="welcome-name">{t("¿Cómo te llamás?")}</label>
            <input id="welcome-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Tu nombre")} onKeyDown={(e) => e.key === "Enter" && done()} />
          </div>
          <div className="field">
            <label>{t("Tus apps")}</label>
            <div className="welcome-apps">
              {apps.map((a) => {
                const st = statuses[a.id];
                return (
                  <div key={a.id} className="welcome-app">
                    <Glyph icon={a.icon} color={a.color} className="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{a.name}</b>
                      <span className="small muted">{appText(a, lang).tagline}</span>
                    </div>
                    {st?.installed ? (
                      <span className="chip olive">
                        <Dot state="on" /> {t("Instalada")}
                      </span>
                    ) : (
                      <button className="btn sm" onClick={() => (done(), runCommand(t("Instalar {name}", { name: a.name }), here(a.install)))}>
                        <Download /> {t("Instalar")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <button className="btn primary lg welcome-go" onClick={done}>
            {t("Entrar a WorkStudio")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function App() {
  const { ready, route, init, settings } = useStore();
  const [palette, setPalette] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("ws-collapsed") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const t = settings?.theme ?? "system";
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }, [settings?.theme]);

  const lang = resolveLang(settings?.language as string | undefined);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (mod && !e.altKey && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        useStore.getState().go(ROUTE_ORDER[Number(e.key) - 1]);
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        useStore.getState().go("settings");
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("ws-collapsed", c ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !c;
    });
  };

  if (!ready) {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center" }} data-tauri-drag-region>
        <span className="muted">{translate(resolveLang(null), "Abriendo tu estudio…")}</span>
      </div>
    );
  }

  let view: React.JSX.Element | null = null;
  if (route === "home") view = <Home />;
  else if (route === "apps") view = <Apps />;
  else if (route.startsWith("app:")) view = <AppView id={route.slice(4)} />;
  else if (route === "chat") view = <Chat />;
  else if (route === "mcp") view = <Mcp />;
  else if (route === "activity") view = <Activity />;
  else if (route === "updates") view = <Updates />;
  else if (route === "settings") view = <Settings />;
  const full = route.startsWith("app:") || route === "terminals" || route === "chat";

  return (
    <div className={`shell ${collapsed ? "collapsed" : ""}`}>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <main className="main">
        <Topbar onPalette={() => setPalette(true)} />
        <div className="content" style={full ? { overflow: "hidden" } : undefined}>
          {view}
          {/* Terminals stay mounted so their sessions survive switching views. */}
          <Terminals visible={route === "terminals"} />
        </div>
      </main>
      <Palette open={palette} onClose={() => setPalette(false)} />
      <Welcome />
      <Toasts />
    </div>
  );
}
