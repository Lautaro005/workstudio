import { useState } from "react";
import { BellRing, CheckCheck, Trash2 } from "../components/icons";
import { call } from "../lib/api";
import { appName, useStore } from "../lib/store";
import { NoteIcon, timeAgo } from "../components/ui";
import { openAction } from "../components/Shell";
import { locale, tt, useLang, useT } from "../lib/i18n";

function dayLabel(ts: number, lang: "es" | "en") {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return tt("Hoy");
  if (d.toDateString() === y.toDateString()) return tt("Ayer");
  return d.toLocaleDateString(locale(lang), { weekday: "long", day: "numeric", month: "long" });
}

export function Activity() {
  const { notes, apps } = useStore();
  const t = useT();
  const lang = useLang();
  const [filter, setFilter] = useState("all");
  const list = [...notes].sort((a, b) => b.ts - a.ts).filter((n) => filter === "all" || (filter === "unread" ? !n.read : n.app === filter));
  const groups: [string, typeof list][] = [];
  for (const n of list) {
    const k = dayLabel(n.ts, lang);
    const g = groups.find((x) => x[0] === k);
    if (g) g[1].push(n);
    else groups.push([k, [n]]);
  }
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>{t("Actividad")}</h1>
          <p>{t("Lo que pasa en tus apps: cambios en el vault de brain, reuniones de Lumina, apps que arrancan o se detienen, actualizaciones y conexiones.")}</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => call("notify_test")}>
          <BellRing /> {t("Probar aviso")}
        </button>
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            {t("Todo")}
          </button>
          <button className={filter === "unread" ? "on" : ""} onClick={() => setFilter("unread")}>
            {t("Sin leer")}
          </button>
          {apps.map((a) => (
            <button key={a.id} className={filter === a.id ? "on" : ""} onClick={() => setFilter(a.id)}>
              {a.name}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={() => call("notes_mark_read", { ids: [] })}>
          <CheckCheck /> {t("Marcar leídas")}
        </button>
        <button className="btn sm ghost" onClick={() => call("notes_clear")}>
          <Trash2 /> {t("Borrar")}
        </button>
      </div>
      {groups.length === 0 && (
        <div className="card empty">
          <h3>{t("Todo tranquilo")}</h3>
          <p>{t("Cuando haya novedades en tus apps aparecen acá y, si lo activaste, como aviso del sistema.")}</p>
        </div>
      )}
      {groups.map(([day, items]) => (
        <div key={day}>
          <div className="section-title">{day}</div>
          <section className="card" style={{ padding: 6 }}>
            {items.map((n) => (
              <button
                key={n.id}
                className={`note ${n.read ? "" : "unread"}`}
                onClick={() => {
                  call("notes_mark_read", { ids: [n.id] });
                  openAction(n.action);
                }}
              >
                <NoteIcon kind={n.kind} app={n.app} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="note-title">{n.title}</div>
                  <div className="note-body">{n.body}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="note-time">{timeAgo(n.ts)}</div>
                  <div className="tiny muted">{appName(apps, n.app)}</div>
                </div>
              </button>
            ))}
          </section>
        </div>
      ))}
    </div>
  );
}
