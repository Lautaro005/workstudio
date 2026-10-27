import { useEffect, useMemo, useState } from "react";
import {
  Bell, ChevronsLeft, ChevronsRight, Grid3x3, House, LayoutGrid, Plug, RefreshCw, Search, Settings as Cog, SquareTerminal, Activity, ArrowUpCircle, Play, Square, CheckCheck, Trash2, MessageSquare,
} from "lucide-react";
import { call } from "../lib/api";
import { appName, PROFILES, useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { Dot, Glyph, Logo, NoteIcon, timeAgo, useOverlay, usePopover, termLook } from "./ui";

/** Labels are Spanish source strings (see lib/i18n.ts). */
export const ROUTES: Record<string, { label: string; icon: typeof House }> = {
  home: { label: "Inicio", icon: House },
  apps: { label: "Apps", icon: LayoutGrid },
  chat: { label: "Chat", icon: MessageSquare },
  terminals: { label: "Terminales", icon: SquareTerminal },
  mcp: { label: "MCP", icon: Plug },
  activity: { label: "Actividad", icon: Activity },
  updates: { label: "Actualizaciones", icon: ArrowUpCircle },
  settings: { label: "Ajustes", icon: Cog },
};

/** ⌘1…⌘8 follow this order. */
export const ROUTE_ORDER = ["home", "apps", "chat", "terminals", "mcp", "activity", "updates", "settings"];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { route, go, apps, statuses, notes, updates, panes, settings, busy, chatLive } = useStore();
  const t = useT();
  const unread = notes.filter((n) => !n.read).length;
  const avail = updates.filter((u) => u.available).length;
  const answering = Object.keys(chatLive).length;
  const item = (key: string, badge?: number, soft?: boolean) => {
    const R = ROUTES[key];
    const I = R.icon;
    return (
      <button key={key} className={`nav-item ${route === key ? "active" : ""}`} onClick={() => go(key)} title={t(R.label)}>
        <I />
        <span className="nav-label">{t(R.label)}</span>
        {badge ? <span className={`nav-badge ${soft ? "soft" : ""}`}>{badge}</span> : null}
      </button>
    );
  };
  const name = settings?.user_name || t("Vos");
  return (
    <aside className="sidebar">
      <div className="drag" data-tauri-drag-region />
      <div className="brand">
        <Logo />
        <div className="brand-text">
          <div className="brand-name">
            AI <em>Work</em>Studio
          </div>
          <div className="brand-sub">{t("Tu estudio local de IA")}</div>
        </div>
      </div>
      <nav className="nav">
        {item("home")}
        {item("apps")}
        {item("chat", answering, true)}
        {item("terminals", panes.length, true)}
        {item("mcp")}
        <div className="nav-section">{t("Tus apps")}</div>
        {apps.map((a) => {
          const st = statuses[a.id];
          const state = busy[a.id] ? "busy" : st?.running ? "on" : st?.installed ? "idle" : "off";
          return (
            <button key={a.id} className={`nav-item nav-app ${route === `app:${a.id}` ? "active" : ""}`} onClick={() => go(`app:${a.id}`)} title={a.name}>
              <Glyph icon={a.icon} color={a.color} />
              <span className="nav-label">{a.name}</span>
              <Dot state={state as "on"} />
            </button>
          );
        })}
        <div className="nav-section">{t("Sistema")}</div>
        {item("activity", unread)}
        {item("updates", avail)}
        {item("settings")}
      </nav>
      <div className="me">
        <div className="avatar" title={name}>
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="me-text">
          <b>{name}</b>
          <span className="muted">{t("Local · {n} activas", { n: Object.values(statuses).filter((s) => s.running).length })}</span>
        </div>
        <button className="icon-btn sm me-toggle" onClick={onToggle} title={collapsed ? t("Expandir") : t("Contraer")} aria-label={collapsed ? t("Expandir") : t("Contraer")}>
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
        </button>
      </div>
    </aside>
  );
}

function Launcher() {
  const { apps, statuses, go } = useStore();
  const t = useT();
  const pop = usePopover();
  return (
    <div ref={pop.ref}>
      <button className={`icon-btn ${pop.open ? "on" : ""}`} onClick={() => pop.setOpen(!pop.open)} title="Apps">
        <Grid3x3 />
      </button>
      {pop.open && (
        <div className="popover launcher">
          <div className="launcher-grid">
            {apps.map((a) => {
              const st = statuses[a.id];
              return (
                <button
                  key={a.id}
                  className="launcher-item"
                  onClick={() => {
                    pop.setOpen(false);
                    go(`app:${a.id}`);
                  }}
                >
                  <Glyph icon={a.icon} color={a.color} />
                  {st?.running && <span className="dot on" />}
                  {a.name}
                </button>
              );
            })}
            {(["chat", "terminals", "mcp"] as const).map((r) => {
              const R = ROUTES[r];
              const I = R.icon;
              return (
                <button key={r} className="launcher-item" onClick={() => (pop.setOpen(false), go(r))}>
                  <span className="glyph ink">
                    <I />
                  </span>
                  {t(R.label)}
                </button>
              );
            })}
          </div>
          <div className="launcher-foot">
            <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => (pop.setOpen(false), go("apps"))}>
              {t("Todas las apps")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function openAction(action: string) {
  const { go } = useStore.getState();
  if (!action) return;
  go(action);
}

function Inbox() {
  const { notes, apps } = useStore();
  const t = useT();
  const pop = usePopover();
  const unread = notes.filter((n) => !n.read).length;
  const list = [...notes].sort((a, b) => b.ts - a.ts).slice(0, 30);
  return (
    <div ref={pop.ref}>
      <button className={`icon-btn ${pop.open ? "on" : ""}`} onClick={() => pop.setOpen(!pop.open)} title={t("Notificaciones")}>
        <Bell />
        {unread > 0 && <span className="pip">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {pop.open && (
        <div className="popover inbox">
          <div className="inbox-head">
            <h3>{t("Notificaciones")}</h3>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={() => call("notes_mark_read", { ids: [] })} disabled={!unread}>
              <CheckCheck /> {t("Marcar leídas")}
            </button>
          </div>
          <div className="inbox-list">
            {list.length === 0 && <div className="empty small">{t("Nada nuevo por ahora.")}</div>}
            {list.map((n) => (
              <button
                key={n.id}
                className={`note ${n.read ? "" : "unread"}`}
                onClick={() => {
                  call("notes_mark_read", { ids: [n.id] });
                  pop.setOpen(false);
                  openAction(n.action);
                }}
              >
                <NoteIcon kind={n.kind} app={n.app} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="note-title">{n.title}</div>
                  <div className="note-body">{n.body || appName(apps, n.app)}</div>
                </div>
                <span className="note-time">{timeAgo(n.ts)}</span>
              </button>
            ))}
          </div>
          <div className="launcher-foot" style={{ margin: 0, padding: 8 }}>
            <button className="btn sm ghost" style={{ flex: 1 }} onClick={() => (pop.setOpen(false), openAction("activity"))}>
              {t("Ver toda la actividad")}
            </button>
            <button className="btn sm ghost" onClick={() => call("notes_clear")} title={t("Borrar todas")}>
              <Trash2 />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Cmd = { id: string; label: string; hint?: string; icon: React.JSX.Element; run: () => void };

export function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const st = useStore();
  const t = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useOverlay(open);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);
  const lang = st.settings?.language;
  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    for (const [k, r] of Object.entries(ROUTES)) {
      const I = r.icon;
      out.push({ id: `go:${k}`, label: t("Ir a {name}", { name: t(r.label) }), icon: <I />, run: () => st.go(k) });
    }
    for (const a of st.apps) {
      const s = st.statuses[a.id];
      out.push({ id: `open:${a.id}`, label: t("Abrir {name}", { name: a.name }), icon: <Glyph icon={a.icon} color={a.color} className="xs" />, run: () => st.go(`app:${a.id}`) });
      if (s?.installed && !s.running) out.push({ id: `start:${a.id}`, label: t("Iniciar {name}", { name: a.name }), icon: <Play />, run: () => st.start(a.id) });
      if (s?.running) out.push({ id: `stop:${a.id}`, label: t("Detener {name}", { name: a.name }), icon: <Square />, run: () => st.stop(a.id) });
    }
    for (const p of PROFILES) {
      const look = termLook(p.id);
      out.push({
        id: `term:${p.id}`,
        label: t("Nueva terminal: {name}", { name: p.name }),
        hint: t(p.hint),
        icon: <Glyph icon={look.icon} color={look.color} className="xs" />,
        run: async () => {
          if (await st.addPane(p.id)) st.go("terminals");
        },
      });
    }
    out.push({ id: "chat", label: t("Nuevo chat"), icon: <MessageSquare />, run: () => (st.go("chat"), setTimeout(() => window.dispatchEvent(new Event("ws-new-chat")), 30)) });
    out.push({ id: "upd", label: t("Buscar actualizaciones"), icon: <RefreshCw />, run: () => (st.go("updates"), st.checkUpdates(true)) });
    return out;
  }, [st.apps, st.statuses, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = cmds.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(w))).slice(0, 12);
  if (!open) return null;
  const run = (c?: Cmd) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette">
        <div className="palette-input">
          <Search />
          <input
            autoFocus
            placeholder={t("Buscá una app, una vista o una acción…")}
            value={q}
            onChange={(e) => (setQ(e.target.value), setSel(0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, list.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
              if (e.key === "Enter") run(list[sel]);
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list">
          {list.length === 0 && <div className="empty small">{t("Nada coincide con «{q}».", { q })}</div>}
          {list.map((c, i) => (
            <button key={c.id} className={`menu-item ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              {c.icon}
              {c.label}
              {c.hint && <span className="muted">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Topbar({ onPalette }: { onPalette: () => void }) {
  const { route, apps, updates, go } = useStore();
  const t = useT();
  const avail = updates.filter((u) => u.available).length;
  let title = ROUTES[route] ? t(ROUTES[route].label) : "";
  if (route.startsWith("app:")) title = appName(apps, route.slice(4));
  const mac = navigator.userAgent.includes("Mac");
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="crumb" data-tauri-drag-region>
        <span className="muted" data-tauri-drag-region>
          WorkStudio
        </span>
        <span className="sep">/</span>
        <span data-tauri-drag-region>{title}</span>
      </div>
      <button className="search-pill" onClick={onPalette}>
        <Search /> {t("Buscar o ejecutar…")} <kbd>{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      {avail > 0 && (
        <button className="update-pill" onClick={() => go("updates")}>
          <ArrowUpCircle /> {avail === 1 ? t("1 actualización") : t("{n} actualizaciones", { n: avail })}
        </button>
      )}
      <Launcher />
      <Inbox />
    </header>
  );
}
