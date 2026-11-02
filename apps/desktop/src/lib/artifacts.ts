// Artifacts: substantial content the model writes inside <artifact id="…" type="…" title="…"> tags.
// A message is split into Markdown parts and artifact parts; an artifact still streaming in is "open".

export type ArtifactType = "html" | "svg" | "markdown" | "code" | string;

export type Artifact = {
  /** Stable id the model picks; writing it again makes a new version. */
  id: string;
  type: ArtifactType;
  title: string;
  language: string;
  content: string;
  /** Still being written. */
  open: boolean;
};

export type Part = { kind: "text"; text: string } | { kind: "artifact"; artifact: Artifact };

const attr = (tag: string, name: string) => {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag) ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? m[1] : "";
};

/** Normalises the type the model wrote ("text/html", "application/vnd.ant.code", "image/svg+xml"…). */
export function normType(t: string, language: string): ArtifactType {
  const x = t.toLowerCase();
  if (x.includes("html")) return "html";
  if (x.includes("svg")) return "svg";
  if (x.includes("markdown") || x === "md" || x === "text/plain" || x === "document") return "markdown";
  if (x.includes("code") || language) return "code";
  return x || "markdown";
}

export function parseParts(text: string): Part[] {
  const out: Part[] = [];
  const re = /<artifact\b([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    const tag = m[1];
    const start = m.index + m[0].length;
    const end = text.indexOf("</artifact>", start);
    let body = end >= 0 ? text.slice(start, end) : text.slice(start);
    // Some models wrap the content in a code fence anyway.
    body = body.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
    const fenced = /^```[\w+-]*\n([\s\S]*?)\n?```$/.exec(body.trim());
    if (fenced) body = fenced[1];
    const language = attr(tag, "language");
    out.push({
      kind: "artifact",
      artifact: {
        id: attr(tag, "id") || attr(tag, "identifier") || `artifact-${out.length}`,
        type: normType(attr(tag, "type"), language),
        title: attr(tag, "title") || "Artifact",
        language,
        content: body,
        open: end < 0,
      },
    });
    if (end < 0) {
      last = text.length;
      break;
    }
    last = end + "</artifact>".length;
    re.lastIndex = last;
  }
  if (last < text.length) {
    // Hide a tag that is still being typed ("<arti…") at the very end.
    const rest = text.slice(last).replace(/<a(r(t(i(f(a(c(t)?)?)?)?)?)?)?$/, "");
    if (rest) out.push({ kind: "text", text: rest });
  }
  return out;
}

/** Every version of every artifact in a conversation, in order. */
export function collectArtifacts(texts: string[]): Map<string, Artifact[]> {
  const map = new Map<string, Artifact[]>();
  for (const t of texts) {
    for (const p of parseParts(t)) {
      if (p.kind !== "artifact") continue;
      const list = map.get(p.artifact.id) ?? [];
      list.push(p.artifact);
      map.set(p.artifact.id, list);
    }
  }
  return map;
}

export const extFor = (a: Artifact) => {
  if (a.type === "html") return "html";
  if (a.type === "svg") return "svg";
  if (a.type === "markdown") return "md";
  const map: Record<string, string> = { python: "py", javascript: "js", typescript: "ts", rust: "rs", ruby: "rb", shell: "sh", bash: "sh", tsx: "tsx", jsx: "jsx", json: "json", yaml: "yml", go: "go", java: "java", kotlin: "kt", swift: "swift", csharp: "cs", cpp: "cpp", c: "c", sql: "sql", css: "css", html: "html" };
  return map[a.language.toLowerCase()] ?? (a.language || "txt");
};

export const fileNameFor = (a: Artifact) => `${a.id.replace(/[^\w-]+/g, "-") || "artifact"}.${extFor(a)}`;
