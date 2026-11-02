// One message of the chat, in the style of Claude's: user bubbles on the right with their files,
// answers full width with the model's reasoning (collapsed), the tools it used, Markdown and
// artifact cards; copy / edit / regenerate on hover.
import { useEffect, useState } from "react";
import { ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert, Code, Copy, FileIc, FilePdf, FileText, ImageIc, Lightbulb, Loader2, Pencil, RotateCw, Wrench, Zap, AtSign, Browser, BookOpen } from "../icons";
import { Markdown } from "../Markdown";
import { Glyph } from "../ui";
import { useT } from "../../lib/i18n";
import { call, type Attachment, type ChatMsg } from "../../lib/api";
import { parseParts, type Artifact } from "../../lib/artifacts";

export const GROUP_LOOK: Record<string, [string, string]> = {
  "Claude Code": ["anthropic", "clay"],
  Codex: ["openai", "ink"],
  Gemini: ["gemini", "mustard"],
  Ollama: ["ollama", "ink"],
  OpenCue: ["opencue", "olive"],
};

export const lookOfModel = (id: string): [string, string] => {
  const k = id.split(":")[0];
  const g = { claude: "Claude Code", codex: "Codex", gemini: "Gemini", ollama: "Ollama", opencue: "OpenCue" }[k] ?? "";
  return GROUP_LOOK[g] ?? ["box", "ink"];
};

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function FileGlyph({ kind }: { kind: string }) {
  const I = kind === "image" ? ImageIc : kind === "pdf" ? FilePdf : kind === "text" ? FileText : FileIc;
  return <I className="file-glyph" />;
}

/** A file as a small card; images show a thumbnail. */
export function FileChip({ f, onRemove }: { f: Attachment; onRemove?: () => void }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    if (f.kind !== "image") return;
    let live = true;
    call<string>("files_preview", { path: f.path })
      .then((u) => live && setThumb(u || ""))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [f.path, f.kind]);
  return (
    <div className={`file-chip ${thumb ? "has-thumb" : ""}`} title={f.path}>
      {thumb ? <img src={thumb} alt="" /> : <FileGlyph kind={f.kind} />}
      <div className="file-chip-txt">
        <b>{f.name}</b>
        <span>{(f.name.split(".").pop() ?? "").toUpperCase()} · {fmtSize(f.size)}</span>
      </div>
      {onRemove && (
        <button className="file-chip-x" onClick={onRemove} aria-label="×">
          ×
        </button>
      )}
    </div>
  );
}

export function ToolList({ tools, live }: { tools: { name: string; detail?: string; done?: boolean; ok?: boolean }[]; live?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const running = live && tools.some((x) => !x.done);
  const last = tools[tools.length - 1];
  const label = (x: { name: string }) => {
    const [app, ...rest] = x.name.split("__");
    return rest.length ? `${app} · ${rest.join("__").replace(/_/g, " ")}` : x.name;
  };
  return (
    <div className={`tool-use ${open ? "open" : ""}`}>
      <button className="tool-sum" onClick={() => setOpen(!open)} aria-expanded={open}>
        {running ? <Loader2 className="spin" /> : <Wrench />}
        <span>
          {running ? `${label(last)}${last.detail ? ` — ${last.detail}` : ""}` : tools.length === 1 ? t("Usó 1 herramienta") : t("Usó {n} herramientas", { n: tools.length })}
        </span>
        {open ? <ChevronDown /> : <ChevronRight />}
      </button>
      {open && (
        <ul>
          {tools.map((x, i) => (
            <li key={i} className={x.ok === false ? "bad" : ""}>
              {live && !x.done ? <Loader2 className="spin" /> : x.ok === false ? <CircleAlert /> : <Check />}
              <b>{label(x)}</b>
              {x.detail && <span className="mono">{x.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Thinking({ text, live }: { text: string; live?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className={`thinking ${open ? "open" : ""}`}>
      <button className="tool-sum" onClick={() => setOpen(!open)} aria-expanded={open}>
        {live ? <Loader2 className="spin" /> : <Lightbulb />}
        <span>{live ? t("Pensando…") : t("Razonamiento")}</span>
        {open ? <ChevronDown /> : <ChevronRight />}
      </button>
      {open && <div className="thinking-body">{text.trim()}</div>}
    </div>
  );
}

export function ArtifactCard({ a, version, onOpen, active }: { a: Artifact; version: number; onOpen: () => void; active: boolean }) {
  const t = useT();
  const I = a.type === "html" ? Browser : a.type === "markdown" ? BookOpen : a.type === "svg" ? ImageIc : Code;
  const kind = a.type === "html" ? t("Página") : a.type === "markdown" ? t("Documento") : a.type === "svg" ? t("Imagen") : a.language || t("Código");
  return (
    <button className={`artifact-card ${active ? "on" : ""}`} onClick={onOpen}>
      <span className="artifact-ic">{a.open ? <Loader2 className="spin" /> : <I />}</span>
      <span className="artifact-txt">
        <b>{a.title}</b>
        <span>
          {a.open ? t("Escribiendo…") : t("Abrir")} · {kind}
          {version > 1 ? ` · v${version}` : ""}
        </span>
      </span>
    </button>
  );
}

/** Text and artifact cards of an answer. `versions` maps "id" → how many versions came before + 1. */
export function AnswerBody({ text, onArtifact, activeArtifact, versionOf }: { text: string; onArtifact: (a: Artifact) => void; activeArtifact?: string; versionOf: (a: Artifact) => number }) {
  const parts = parseParts(text);
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          p.text.trim() ? <Markdown key={i} text={p.text} /> : null
        ) : (
          <ArtifactCard key={i} a={p.artifact} version={versionOf(p.artifact)} active={activeArtifact === `${p.artifact.id}#${versionOf(p.artifact)}`} onOpen={() => onArtifact(p.artifact)} />
        ),
      )}
    </>
  );
}

function CopyBtn({ text }: { text: string }) {
  const t = useT();
  const [ok, setOk] = useState(false);
  return (
    <button
      className="icon-btn sm"
      title={t("Copiar")}
      aria-label={t("Copiar")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1300);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? <Check /> : <Copy />}
    </button>
  );
}

export function UserMessage({ m, onEdit, busy }: { m: ChatMsg; onEdit?: (text: string) => void; busy: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  return (
    <div className="msg user">
      {!!m.files?.length && (
        <div className="msg-files">
          {m.files.map((f, i) => (
            <FileChip key={i} f={f} />
          ))}
        </div>
      )}
      {(!!m.agent || !!m.skills?.length) && (
        <div className="msg-tags">
          {m.agent && (
            <span className="tag-chip olive">
              <AtSign /> {m.agent}
            </span>
          )}
          {m.skills?.map((s) => (
            <span key={s} className="tag-chip mustard">
              <Zap /> {s}
            </span>
          ))}
        </div>
      )}
      {editing ? (
        <div className="edit-box">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={Math.min(10, draft.split("\n").length + 1)} />
          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn sm ghost" onClick={() => (setEditing(false), setDraft(m.text))}>
              {t("Cancelar")}
            </button>
            <button className="btn sm primary" disabled={!draft.trim() || busy} onClick={() => (setEditing(false), onEdit?.(draft))}>
              <ArrowUp /> {t("Enviar")}
            </button>
          </div>
        </div>
      ) : (
        m.text && <div className="bubble">{m.text}</div>
      )}
      {!editing && (
        <div className="msg-actions">
          <CopyBtn text={m.text} />
          {onEdit && !busy && (
            <button className="icon-btn sm" title={t("Editar")} aria-label={t("Editar")} onClick={() => setEditing(true)}>
              <Pencil />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function BotMessage({
  m,
  name,
  onRegenerate,
  onArtifact,
  activeArtifact,
  versionOf,
}: {
  m: ChatMsg;
  name: string;
  onRegenerate?: () => void;
  onArtifact: (a: Artifact) => void;
  activeArtifact?: string;
  versionOf: (a: Artifact) => number;
}) {
  const t = useT();
  const look = lookOfModel(m.model);
  return (
    <div className={`msg bot ${m.error ? "error" : ""}`}>
      <div className="msg-meta">
        <Glyph icon={look[0]} color={look[1]} className="xs" />
        {m.agent ? t("Agente {name}", { name: m.agent }) : name}
        {m.error && (
          <span className="chip clay">
            <CircleAlert /> {t("Error")}
          </span>
        )}
      </div>
      <Thinking text={m.thinking ?? ""} />
      <ToolList tools={m.tools} />
      <AnswerBody text={m.text} onArtifact={onArtifact} activeArtifact={activeArtifact} versionOf={versionOf} />
      <div className="msg-actions">
        <CopyBtn text={m.text} />
        {onRegenerate && (
          <button className="icon-btn sm" title={t("Regenerar")} aria-label={t("Regenerar")} onClick={onRegenerate}>
            <RotateCw />
          </button>
        )}
      </div>
    </div>
  );
}
