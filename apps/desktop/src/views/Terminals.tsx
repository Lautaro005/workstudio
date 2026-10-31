import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, Columns3, Download, FolderOpen, LayoutGrid, Maximize2, Minimize2, Plug, Plus, RefreshCw, RotateCw, Rows3, Wrench, X, Loader2 } from "../components/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { call, here, inTauri, on, type CliStatus } from "../lib/api";
import { MAX_PANES, PROFILES, useStore, type Pane } from "../lib/store";
import { Glyph, termLook, usePopover } from "../components/ui";
import { openUrl } from "../lib/open";
import { tt, useT } from "../lib/i18n";

// One listener for all panes; each pane registers its writer by id.
const writers = new Map<string, (b: Uint8Array) => void>();
const exits = new Map<string, (code: number | null) => void>();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  on<{ id: string; data: string }>("pty-data", ({ id, data }) => {
    const w = writers.get(id);
    if (!w) return;
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    w(bytes);
  });
  on<{ id: string; code: number | null }>("pty-exit", ({ id, code }) => exits.get(id)?.(code));
}

const THEME: ITheme = {
  background: "#1c1917",
  foreground: "#ede6da",
  cursor: "#e2652e",
  cursorAccent: "#1c1917",
  selectionBackground: "#5a3a2a",
  black: "#2a2521",
  red: "#e2652e",
  green: "#9cbf64",
  yellow: "#e3a92f",
  blue: "#8fa9c7",
  magenta: "#c79bb4",
  cyan: "#8fbcae",
  white: "#d8cfc2",
  brightBlack: "#6f675f",
  brightRed: "#f08657",
  brightGreen: "#b5d189",
  brightYellow: "#f0c868",
  brightBlue: "#aec3db",
  brightMagenta: "#dbb6ca",
  brightCyan: "#acd3c6",
  brightWhite: "#faf7f2",
};

function TerminalPane({ pane, active, onFocus, maximized, onMax, hidden }: { pane: Pane; active: boolean; onFocus: () => void; maximized: boolean; onMax: () => void; hidden: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const closePane = useStore((s) => s.closePane);
  const restartPane = useStore((s) => s.restartPane);
  const patchPane = useStore((s) => s.patchPane);
  const fontSize = useStore((s) => s.settings?.terminal_font_size ?? 13);
  const look = termLook(pane.profile);
  const t = useT();

  useEffect(() => {
    wire();
    const el = box.current!;
    const term = new XTerm({
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace',
      fontSize,
      lineHeight: 1.22,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 8000,
      theme: THEME,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, uri) => openUrl(uri)));
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }
    writers.set(pane.id, (b) => term.write(b));
    exits.set(pane.id, (code) => {
      term.write(`\r\n\x1b[2m[${tt("proceso terminado")}${code != null ? ` · ${tt("código")} ${code}` : ""}]\x1b[0m\r\n`);
      patchPane(pane.id, { exited: true });
      // Shells that don't print the end mark still refresh versions when they close.
      useStore.getState().commandDone(pane.id, null);
    });
    // Installs and updates end with OSC 777 "ws-done;<code>" (see runCommand).
    const osc = term.parser.registerOscHandler(777, (data) => {
      if (data.startsWith("ws-done;")) useStore.getState().commandDone(pane.id, Number(data.slice(8)) || 0);
      return true;
    });
    const sub = term.onData((d) => call("pty_write", { id: pane.id, data: d }));
    call("pty_spawn", {
      opts: { id: pane.id, cwd: pane.cwd, initial: pane.initial, cols: term.cols, rows: term.rows, env: {} },
    }).catch((e) => term.write(`\x1b[31m${String(e)}\x1b[0m\r\n`));

    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          fit.fit();
          call("pty_resize", { id: pane.id, cols: term.cols, rows: term.rows });
        } catch {
          /* hidden */
        }
      }, 40);
    });
    ro.observe(el);
    const focusIn = () => onFocus();
    el.addEventListener("mousedown", focusIn);
    (el as HTMLDivElement & { _term?: XTerm })._term = term;
    return () => {
      ro.disconnect();
      sub.dispose();
      osc.dispose();
      el.removeEventListener("mousedown", focusIn);
      writers.delete(pane.id);
      exits.delete(pane.id);
      call("pty_kill", { id: pane.id });
      term.dispose();
    };
    // Re-spawn only when the pane restarts.
  }, [pane.id, pane.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = (box.current as (HTMLDivElement & { _term?: XTerm }) | null)?._term;
    if (t) t.options.fontSize = fontSize;
  }, [fontSize]);

  useEffect(() => {
    if (active) (box.current as (HTMLDivElement & { _term?: XTerm }) | null)?._term?.focus();
  }, [active]);
  return (
    <div className={`pane ${active ? "active" : ""}`} onMouseDown={onFocus} style={hidden ? { display: "none" } : undefined}>
      <div className="pane-head" onDoubleClick={onMax}>
        <span className={`pglyph glyph ${look.color}`}>
          <Glyph icon={look.icon} color={look.color} className="xs" />
        </span>
        <span>{pane.title}</span>
        <span className="cwd">{pane.cwd.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}</span>
        <span className="spacer" />
        {pane.mcp ? (
          <span className="mcp-badge" title={t("Servidor MCP de WorkStudio cargado")}>
            <Plug /> MCP {pane.mcp}
          </span>
        ) : null}
        <button className="icon-btn" title={t("Reiniciar")} onClick={() => restartPane(pane.id)}>
          <RotateCw />
        </button>
        <button className="icon-btn" title={maximized ? t("Volver a la grilla") : t("Maximizar")} onClick={onMax}>
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </button>
        <button className="icon-btn" title={t("Cerrar")} onClick={() => closePane(pane.id)}>
          <X />
        </button>
      </div>
      <div className="pane-body" ref={box} />
      {pane.exited && (
        <div className="pane-exit">
          {t("Terminó")}
          <button className="btn sm" onClick={() => restartPane(pane.id)}>
            <RotateCw /> {t("Reabrir")}
          </button>
        </div>
      )}
    </div>
  );
}

type Layout = "auto" | "cols" | "rows";

function gridFor(n: number, layout: Layout): React.CSSProperties {
  if (n <= 1) return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
  if (layout === "cols") return { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: "1fr" };
  if (layout === "rows") return { gridTemplateColumns: "1fr", gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` };
  const cols = n <= 2 ? 2 : n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
}

function NewMenu({ onPick, cli }: { onPick: (p: string) => void; cli: Record<string, boolean> }) {
  const pop = usePopover();
  const groups = ["Agentes", "Apps", "Sistema"] as const;
  const clis = useStore((s) => s.clis);
  const t = useT();
  const ok = (bin?: string) => {
    if (!bin) return true;
    const c = clis.find((x) => x.bin === bin);
    return !c || cli[c.id] !== false;
  };
  return (
    <div ref={pop.ref} style={{ position: "relative" }}>
      <button className="btn primary sm" onClick={() => pop.setOpen(!pop.open)}>
        <Plus /> {t("Nueva terminal")} <ChevronDown />
      </button>
      {pop.open && (
        <div className="popover menu" style={{ top: 34, left: 0, width: 300 }}>
          {groups.map((g) => (
            <div key={g}>
              <div className="menu-label">{t(g)}</div>
              {PROFILES.filter((p) => p.group === g).map((p) => {
                const look = termLook(p.id);
                return (
                  <button key={p.id} className="menu-item" onClick={() => (pop.setOpen(false), onPick(p.id))} style={ok(p.bin) ? undefined : { opacity: 0.5 }}>
                    <Glyph icon={look.icon} color={look.color} className="xs" />
                    <span>
                      {p.name}
                      <span className="tiny muted" style={{ display: "block" }}>
                        {ok(p.bin) ? t(p.hint) : t("No instalado")}
                      </span>
                    </span>
                    {p.mcp !== "none" && <Plug size={13} style={{ marginLeft: "auto", color: "var(--olive)" }} />}
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

function CliDrawer({ onClose, statuses, reload, loading }: { onClose: () => void; statuses: CliStatus[]; reload: () => void; loading: boolean }) {
  const { clis, updates, runCommand, busy } = useStore();
  const t = useT();
  return (
    <div className="drawer">
      <div className="drawer-head">
        <Wrench size={18} />
        <h3>CLIs</h3>
        <span className="spacer" />
        <button className="icon-btn sm" onClick={reload} title={t("Volver a revisar")}>
          {loading ? <Loader2 className="spin" /> : <RefreshCw />}
        </button>
        <button className="icon-btn sm" onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="drawer-body">
        <p className="small muted" style={{ padding: "6px 12px 10px" }}>
          {t("Instalá o actualizá los comandos que usan tus terminales. Cada acción corre en una terminal nueva para que veas lo que pasa.")}
        </p>
        {clis.map((c) => {
          const s = statuses.find((x) => x.id === c.id);
          const u = updates.find((x) => x.id === c.id || x.id === c.app);
          const look = termLook(c.id.replace("-cli", ""));
          const cmd = s?.installed ? here(c.update) : here(c.install);
          return (
            <div key={c.id} className="cli-row">
              <Glyph icon={look.icon} color={look.color} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 13.5 }}>{c.name}</b>
                <div className="tiny muted mono">
                  {s?.installed ? `${c.bin} ${s.version ?? ""}` : t("no instalado")}
                  {u?.available && u.latest && <span style={{ color: "var(--clay)", fontWeight: 700 }}> → {u.latest}</span>}
                </div>
              </div>
              {busy[`run:${c.id}`] ? (
                <button className="btn sm" disabled>
                  <Loader2 className="spin" /> {t(s?.installed ? "Actualizando…" : "Instalando…")}
                </button>
              ) : cmd && (!s?.installed || u?.available) ? (
                <button className={`btn sm ${u?.available ? "primary" : ""}`} onClick={() => runCommand(t(s?.installed ? "Actualizar {name}" : "Instalar {name}", { name: c.name }), cmd, "~", c.id)}>
                  {s?.installed ? <RefreshCw /> : <Download />}
                  {s?.installed ? t("Actualizar") : t("Instalar")}
                </button>
              ) : (
                <span className="tiny muted">—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Terminals({ visible }: { visible: boolean }) {
  const { panes, addPane, focusPane, setFocus } = useStore();
  const t = useT();
  const [active, setActive] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("auto");
  const [drawer, setDrawer] = useState(false);
  const [cliStatus, setCliStatus] = useState<CliStatus[]>([]);
  const [loadingCli, setLoadingCli] = useState(false);
  const cliOk = useMemo(() => Object.fromEntries(cliStatus.map((c) => [c.id, c.installed])), [cliStatus]);

  const loadCli = () => {
    setLoadingCli(true);
    call<CliStatus[]>("clis_status")
      .then(setCliStatus)
      .finally(() => setLoadingCli(false));
  };
  const versionTick = useStore((s) => s.versionTick);
  useEffect(() => {
    if (visible) loadCli();
  }, [visible, versionTick]);
  useEffect(() => {
    if (panes.length && !panes.find((p) => p.id === active)) setActive(panes[panes.length - 1].id);
  }, [panes, active]);

  const pick = async (profile: string, cwd?: string) => {
    const id = await addPane(profile, cwd ? { cwd } : {});
    if (id) setActive(id);
  };
  const pickFolder = async () => {
    if (!inTauri) return pick("shell");
    const dir = await openDialog({ directory: true, title: t("Elegí la carpeta de la terminal") });
    if (typeof dir === "string") pick("shell", dir);
  };

  // ⌘T opens a shell; ⌘W closes the active pane; ⌘1-6 focuses a pane.
  useEffect(() => {
    if (!visible) return;
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        pick("shell");
      } else if (/^[1-6]$/.test(e.key) && e.altKey) {
        const p = panes[Number(e.key) - 1];
        if (p) (e.preventDefault(), setActive(p.id));
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = focusPane ? panes.filter((p) => p.id === focusPane) : panes;
  return (
    <div className="term-view" style={{ display: visible ? "flex" : "none", position: "relative" }}>
      <div className="term-toolbar">
        <NewMenu onPick={pick} cli={cliOk} />
        <button className="btn sm" onClick={pickFolder} title={t("Terminal en una carpeta")}>
          <FolderOpen /> {t("En carpeta…")}
        </button>
        <span className="term-count">
          {panes.length}/{MAX_PANES}
        </span>
        <span className="spacer" />
        <div className="seg">
          <button className={layout === "auto" ? "on" : ""} onClick={() => setLayout("auto")} title={t("Grilla")}>
            <LayoutGrid />
          </button>
          <button className={layout === "cols" ? "on" : ""} onClick={() => setLayout("cols")} title={t("Columnas")}>
            <Columns3 />
          </button>
          <button className={layout === "rows" ? "on" : ""} onClick={() => setLayout("rows")} title={t("Filas")}>
            <Rows3 />
          </button>
        </div>
        <button className={`btn sm ${drawer ? "" : "ghost"}`} onClick={() => setDrawer(!drawer)}>
          <Wrench /> CLIs
        </button>
      </div>

      {panes.length === 0 ? (
        <div className="term-empty">
          <div style={{ textAlign: "center" }}>
            <h2 className="display" style={{ fontSize: 28, fontWeight: 540 }}>
              {t("Hasta seis terminales, una pantalla.")}
            </h2>
            <p className="muted" style={{ margin: "8px auto 24px", maxWidth: 520 }}>
              {t("Los agentes arrancan en ~/.workstudio/workspace con el servidor MCP de WorkStudio ya cargado: brain, Lumina y OpenCue en uno.")}
            </p>
            <div className="profile-grid">
              {PROFILES.map((p) => {
                const look = termLook(p.id);
                const c = useStore.getState().clis.find((x) => x.bin === p.bin);
                const missing = !!c && cliOk[c.id] === false;
                return (
                  <button key={p.id} className={`profile-card ${missing ? "missing" : ""}`} onClick={() => pick(p.id)}>
                    <Glyph icon={look.icon} color={look.color} />
                    <b>{p.name}</b>
                    <small>{missing ? t("No instalado · instalalo desde CLIs") : t(p.hint)}</small>
                    {p.mcp !== "none" && (
                      <span className="chip olive" style={{ alignSelf: "flex-start" }}>
                        <Plug /> MCP
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="term-grid" style={gridFor(shown.length, layout)}>
          {panes.map((p) => (
            <TerminalPane
              key={p.id}
              pane={p}
              hidden={!shown.includes(p)}
              active={active === p.id}
              onFocus={() => setActive(p.id)}
              maximized={focusPane === p.id}
              onMax={() => setFocus(focusPane === p.id ? null : p.id)}
            />
          ))}
        </div>
      )}
      {drawer && <CliDrawer onClose={() => setDrawer(false)} statuses={cliStatus} reload={loadCli} loading={loadingCli} />}
    </div>
  );
}

