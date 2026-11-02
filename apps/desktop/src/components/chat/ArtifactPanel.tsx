// The artifact panel next to the conversation: preview or code, versions, copy, save and open.
// HTML runs in a sandboxed frame served by WorkStudio's own `wsart:` protocol (with its own CSP),
// never inside the app's page.
import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Check, Code, Copy, Download, Eye, ExternalLink, Loader2, X } from "../icons";
import { Markdown } from "../Markdown";
import { call, inTauri } from "../../lib/api";
import { fileNameFor, type Artifact } from "../../lib/artifacts";
import { useT } from "../../lib/i18n";
import { useStore } from "../../lib/store";

function HtmlFrame({ html }: { html: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!inTauri) return;
    let live = true;
    call<string>("artifact_put", { html }).then((key) => live && setSrc(convertFileSrc(key, "wsart")));
    return () => {
      live = false;
    };
  }, [html]);
  if (!inTauri) return <iframe className="artifact-frame" title="artifact" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={html} />;
  if (!src) return <div className="placeholder"><Loader2 className="spin" /></div>;
  return <iframe className="artifact-frame" title="artifact" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src={src} />;
}

function CodeView({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <pre className="artifact-code">
      <code>
        {lines.map((l, i) => (
          <div key={i} className="ln">
            <span className="ln-n">{i + 1}</span>
            <span className="ln-t">{l || " "}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

export function ArtifactPanel({ versions, index, onIndex, onClose }: { versions: Artifact[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const t = useT();
  const toast = useStore((s) => s.toast);
  const a = versions[Math.min(index, versions.length - 1)];
  const previewable = a.type !== "code";
  const [tab, setTab] = useState<"preview" | "code">(previewable ? "preview" : "code");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setTab(a.type !== "code" ? "preview" : "code");
  }, [a.id, a.type]);
  const svgUrl = useMemo(() => (a.type === "svg" ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(a.content)}` : ""), [a.type, a.content]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      toast(t("No pude copiar al portapapeles"), "error");
    }
  };
  const download = async () => {
    const name = fileNameFor(a);
    if (!inTauri) {
      const url = URL.createObjectURL(new Blob([a.content], { type: "text/plain" }));
      const el = document.createElement("a");
      el.href = url;
      el.download = name;
      el.click();
      URL.revokeObjectURL(url);
      return;
    }
    const path = await saveDialog({ defaultPath: name });
    if (!path) return;
    try {
      await call("artifact_save", { path, content: a.content });
      toast(t("Guardado en {path}", { path }), "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };
  const openOut = async () => {
    try {
      await call("artifact_open", { name: fileNameFor(a), content: a.content });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <aside className="artifact-panel" aria-label={t("Artefacto")}>
      <div className="artifact-head">
        <div className="artifact-title">
          <b title={a.title}>{a.title}</b>
          <span className="tiny muted">
            {a.open ? t("Escribiendo…") : a.type === "code" ? a.language || t("Código") : a.type.toUpperCase()}
          </span>
        </div>
        {versions.length > 1 && (
          <select className="ver-select" value={index} onChange={(e) => onIndex(Number(e.target.value))} aria-label={t("Versión")}>
            {versions.map((_, i) => (
              <option key={i} value={i}>
                v{i + 1}
              </option>
            ))}
          </select>
        )}
        {previewable && (
          <div className="seg sm">
            <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>
              <Eye /> {t("Vista")}
            </button>
            <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>
              <Code /> {t("Código")}
            </button>
          </div>
        )}
        <button className="icon-btn sm" title={t("Copiar")} aria-label={t("Copiar")} onClick={copy}>
          {copied ? <Check /> : <Copy />}
        </button>
        <button className="icon-btn sm" title={t("Guardar como…")} aria-label={t("Guardar como…")} onClick={download} disabled={a.open}>
          <Download />
        </button>
        {inTauri && (
          <button className="icon-btn sm" title={t("Abrir afuera")} aria-label={t("Abrir afuera")} onClick={openOut} disabled={a.open}>
            <ExternalLink />
          </button>
        )}
        <button className="icon-btn sm" title={t("Cerrar")} aria-label={t("Cerrar")} onClick={onClose}>
          <X />
        </button>
      </div>
      <div className="artifact-body">
        {tab === "code" || a.type === "code" ? (
          <CodeView text={a.content} />
        ) : a.type === "html" ? (
          a.open ? <CodeView text={a.content} /> : <HtmlFrame html={a.content} />
        ) : a.type === "svg" ? (
          a.open ? <CodeView text={a.content} /> : <div className="artifact-svg"><img src={svgUrl} alt={a.title} /></div>
        ) : (
          <div className="artifact-doc">
            <Markdown text={a.content} />
          </div>
        )}
      </div>
    </aside>
  );
}
