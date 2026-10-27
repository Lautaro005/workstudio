import { useState } from "react";
import { FolderOpen, Languages, Monitor, Moon, Sun } from "lucide-react";
import { call } from "../lib/api";
import { useStore } from "../lib/store";
import { Glyph, Switch } from "../components/ui";
import { reveal, openUrl } from "../lib/open";
import { useT } from "../lib/i18n";

const SECTIONS = [
  ["general", "General"],
  ["notifications", "Notificaciones"],
  ["apps", "Apps"],
  ["terminal", "Terminal"],
  ["updates", "Actualizaciones"],
  ["about", "Acerca de"],
] as const;

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="set-row">
      <div className="txt">
        <b>{t(title)}</b>
        {sub && <small>{t(sub)}</small>}
      </div>
      {children}
    </div>
  );
}

export function Settings() {
  const { settings, saveSettings, apps, info } = useStore();
  const t = useT();
  const [sec, setSec] = useState<(typeof SECTIONS)[number][0]>("general");
  if (!settings) return null;
  const s = settings;
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <div>
          <h1>{t("Ajustes")}</h1>
          <p>{t("Todo queda en {dir}, en tu compu.", { dir: info?.data_dir ?? "~/.workstudio" })}</p>
        </div>
      </div>
      <div className="settings">
        <nav className="settings-nav">
          {SECTIONS.map(([k, l]) => (
            <button key={k} className={`nav-item ${sec === k ? "active" : ""}`} onClick={() => setSec(k)}>
              {t(l)}
            </button>
          ))}
        </nav>
        <div>
          {sec === "general" && (
            <section className="card">
              <Row title="Tu nombre" sub="Para el saludo del inicio.">
                <input className="input" style={{ width: 220 }} defaultValue={s.user_name} onBlur={(e) => saveSettings({ user_name: e.target.value.trim() })} />
              </Row>
              <Row title="Idioma" sub="El de la interfaz, los avisos y el chat.">
                <div className="seg">
                  {(
                    [
                      ["es", "Español"],
                      ["en", "English"],
                      ["system", "Sistema"],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={(s.language || "system") === v ? "on" : ""} onClick={() => saveSettings({ language: v })}>
                      {v === "system" && <Languages />} {v === "system" ? t(l) : l}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Tema" sub="Claro (tierra), oscuro (carbón) o el del sistema.">
                <div className="seg">
                  {(
                    [
                      ["light", "Claro", Sun],
                      ["dark", "Oscuro", Moon],
                      ["system", "Sistema", Monitor],
                    ] as const
                  ).map(([v, l, I]) => (
                    <button key={v} className={s.theme === v ? "on" : ""} onClick={() => saveSettings({ theme: v })}>
                      <I /> {t(l)}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Cerrar a la bandeja" sub="Al cerrar la ventana, WorkStudio sigue en la barra de menú para avisarte.">
                <Switch on={s.close_to_tray} onChange={(v) => saveSettings({ close_to_tray: v })} />
              </Row>
            </section>
          )}
          {sec === "notifications" && (
            <section className="card">
              <Row title="Avisos del sistema" sub="Además del centro de notificaciones, mostrar el aviso de macOS, Windows o Linux.">
                <Switch on={s.system_notifications} onChange={(v) => saveSettings({ system_notifications: v })} />
              </Row>
              {apps.map((a) => (
                <Row key={a.id} title={a.name} sub={a.id === "brain" ? "Cambios en el vault, app iniciada o detenida." : a.id === "lumina" ? "Reuniones que empiezan y terminan, app iniciada o detenida." : "App iniciada o detenida, actualizaciones."}>
                  <Switch on={s.notify_apps[a.id] ?? true} onChange={(v) => saveSettings({ notify_apps: { ...s.notify_apps, [a.id]: v } })} />
                </Row>
              ))}
              <Row title="Probar" sub="Manda un aviso de prueba.">
                <button className="btn sm" onClick={() => call("notify_test")}>
                  {t("Enviar")}
                </button>
              </Row>
            </section>
          )}
          {sec === "apps" && (
            <section className="card">
              {apps
                .filter((a) => a.kind === "web")
                .map((a) => (
                  <div key={a.id}>
                    <Row title={t("Iniciar {name} con WorkStudio", { name: a.name })} sub="Arranca su servidor en segundo plano al abrir WorkStudio.">
                      <Glyph icon={a.icon} color={a.color} className="xs" />
                      <Switch
                        on={s.autostart.includes(a.id)}
                        onChange={(v) => saveSettings({ autostart: v ? [...s.autostart, a.id] : s.autostart.filter((x) => x !== a.id) })}
                      />
                    </Row>
                    <Row title={t("Abrir {name} directo en la app", { name: a.name })} sub="Si está apagado, al entrar ves los detalles primero.">
                      <Switch
                        on={(s.open_in_app ?? []).includes(a.id)}
                        onChange={(v) => {
                          const list = (s.open_in_app ?? []).filter((x) => x !== a.id);
                          saveSettings({ open_in_app: v ? [...list, a.id] : list });
                        }}
                      />
                    </Row>
                  </div>
                ))}
            </section>
          )}
          {sec === "terminal" && (
            <section className="card">
              <Row title="Tamaño de letra" sub={`${s.terminal_font_size} px`}>
                <input type="range" min={10} max={20} value={s.terminal_font_size} onChange={(e) => saveSettings({ terminal_font_size: Number(e.target.value) })} />
              </Row>
              <Row title="Shell" sub={t("Vacío = el tuyo ({shell}).", { shell: info?.shell ?? "zsh" })}>
                <input className="input mono" style={{ width: 220 }} placeholder={info?.shell} defaultValue={s.terminal_shell} onBlur={(e) => saveSettings({ terminal_shell: e.target.value.trim() })} />
              </Row>
              <Row title="Workspace de los agentes" sub="Carpeta donde arrancan Claude Code, Codex, Gemini y Cursor con el MCP cargado.">
                <button className="btn sm" onClick={() => info && reveal(info.workspace)}>
                  <FolderOpen /> {t("Abrir")}
                </button>
              </Row>
            </section>
          )}
          {sec === "updates" && (
            <section className="card">
              <Row title="Buscar actualizaciones solo" sub="Revisa GitHub (apps y WorkStudio) y npm (CLIs).">
                <Switch on={s.auto_check_updates} onChange={(v) => saveSettings({ auto_check_updates: v })} />
              </Row>
              <Row title="Cada cuánto" sub="Horas entre revisiones.">
                <select className="select" style={{ width: 140 }} value={s.update_interval_hours} onChange={(e) => saveSettings({ update_interval_hours: Number(e.target.value) })}>
                  {[1, 3, 6, 12, 24].map((h) => (
                    <option key={h} value={h}>
                      {h} h
                    </option>
                  ))}
                </select>
              </Row>
            </section>
          )}
          {sec === "about" && (
            <section className="card">
              <Row title={`AI WorkStudio ${info?.version ?? ""}`} sub={`${info?.os} · ${info?.arch}`}>
                <button className="btn sm" onClick={() => openUrl("https://lautaro005.github.io/workstudio/")}>
                  {t("Sitio")}
                </button>
              </Row>
              <Row title="Carpeta de datos" sub={info?.data_dir}>
                <button className="btn sm" onClick={() => info && reveal(info.data_dir)}>
                  <FolderOpen /> {t("Mostrar")}
                </button>
              </Row>
              <Row title="Código" sub="Apache-2.0 con Commons Clause: libre para usar, no para vender.">
                <button className="btn sm" onClick={() => openUrl("https://github.com/Lautaro005/workstudio")}>
                  GitHub
                </button>
              </Row>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
