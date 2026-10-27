//! WorkStudio's own web tools: search (DuckDuckGo, with Wikipedia as a fallback) and reading a page
//! as plain text. They run inside the app, so they need no API key and no other program.

use serde_json::{json, Value};
use std::time::Duration;

pub fn tool_defs() -> Vec<Value> {
    vec![
        json!({
            "name": "web__search",
            "description": "[web] Search the web. Returns titles, URLs and snippets. Use web__fetch to read a result.",
            "inputSchema": {"type": "object", "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 20}
            }, "required": ["query"]}
        }),
        json!({
            "name": "web__fetch",
            "description": "[web] Download a web page and return its readable text. Use offset to read further in long pages.",
            "inputSchema": {"type": "object", "properties": {
                "url": {"type": "string"},
                "offset": {"type": "integer", "minimum": 0}
            }, "required": ["url"]}
        }),
    ]
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(6))
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .redirects(5)
        .build()
}

pub fn encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn entities(s: &str) -> String {
    let mut t = s
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    // Numeric entities.
    while let Some(i) = t.find("&#") {
        let Some(j) = t[i..].find(';') else { break };
        let code = &t[i + 2..i + j];
        let ch = if let Some(h) = code.strip_prefix('x').or_else(|| code.strip_prefix('X')) {
            u32::from_str_radix(h, 16).ok()
        } else {
            code.parse().ok()
        }
        .and_then(char::from_u32);
        match ch {
            Some(c) => t.replace_range(i..i + j + 1, &c.to_string()),
            None => break,
        }
    }
    t.replace("&amp;", "&")
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    entities(&out)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

struct Hit {
    title: String,
    url: String,
    snippet: String,
}

fn ddg(query: &str, max: usize) -> anyhow::Result<Vec<Hit>> {
    let html = agent()
        .get(&format!(
            "https://html.duckduckgo.com/html/?q={}",
            encode(query)
        ))
        .call()?
        .into_string()?;
    let mut hits = Vec::new();
    for block in html.split("class=\"result__a\"").skip(1) {
        let Some(h) = block.find("href=\"") else {
            continue;
        };
        let rest = &block[h + 6..];
        let Some(end) = rest.find('"') else { continue };
        let mut url = entities(&rest[..end]);
        if let Some(i) = url.find("uddg=") {
            let u = &url[i + 5..];
            url = decode(u.split('&').next().unwrap_or(u));
        }
        if url.starts_with("//") {
            url = format!("https:{url}");
        }
        if url.contains("duckduckgo.com/y.js") {
            continue; // ads
        }
        let title = rest[end..]
            .split_once('>')
            .and_then(|(_, t)| t.split_once("</a>"))
            .map(|(t, _)| strip_tags(t))
            .unwrap_or_default();
        let snippet = block
            .split_once("result__snippet")
            .and_then(|(_, t)| t.split_once('>'))
            .and_then(|(_, t)| t.split_once("</a>"))
            .map(|(t, _)| strip_tags(t))
            .unwrap_or_default();
        hits.push(Hit {
            title,
            url,
            snippet,
        });
        if hits.len() >= max {
            break;
        }
    }
    Ok(hits)
}

fn wikipedia(query: &str, max: usize) -> anyhow::Result<Vec<Hit>> {
    let lang = if crate::settings::english() {
        "en"
    } else {
        "es"
    };
    let v: Value = agent()
        .get(&format!(
            "https://{lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit={max}&srsearch={}",
            encode(query)
        ))
        .call()?
        .into_json()?;
    Ok(v["query"]["search"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|r| {
            let title = r["title"].as_str().unwrap_or("").to_string();
            Hit {
                url: format!(
                    "https://{lang}.wikipedia.org/wiki/{}",
                    title.replace(' ', "_")
                ),
                snippet: strip_tags(r["snippet"].as_str().unwrap_or("")),
                title,
            }
        })
        .collect())
}

pub fn search(query: &str, max: usize) -> anyhow::Result<String> {
    anyhow::ensure!(!query.trim().is_empty(), "Empty query");
    let max = max.clamp(1, 20);
    let mut hits = ddg(query, max).unwrap_or_default();
    if hits.is_empty() {
        hits = wikipedia(query, max)?;
    }
    if hits.is_empty() {
        return Ok(format!("No results for «{query}»."));
    }
    Ok(hits
        .iter()
        .enumerate()
        .map(|(i, h)| format!("{}. {}\n   {}\n   {}", i + 1, h.title, h.url, h.snippet))
        .collect::<Vec<_>>()
        .join("\n\n"))
}

/// The readable text of an HTML page: no scripts, styles or tags; one line per block.
pub fn readable(html: &str) -> String {
    let mut s = html.to_string();
    for tag in [
        "script", "style", "noscript", "svg", "head", "nav", "footer",
    ] {
        loop {
            let lower = s.to_ascii_lowercase();
            let Some(a) = lower.find(&format!("<{tag}")) else {
                break;
            };
            let close = format!("</{tag}>");
            let b = lower[a..]
                .find(&close)
                .map(|b| a + b + close.len())
                .unwrap_or(s.len());
            s.replace_range(a..b, " ");
        }
    }
    let mut out = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    for c in s.chars() {
        if in_tag {
            if c == '>' {
                in_tag = false;
                let name = tag
                    .trim_start_matches('/')
                    .split(|c: char| c.is_whitespace())
                    .next()
                    .unwrap_or("")
                    .to_lowercase();
                if matches!(
                    name.as_str(),
                    "p" | "div"
                        | "br"
                        | "li"
                        | "h1"
                        | "h2"
                        | "h3"
                        | "h4"
                        | "h5"
                        | "h6"
                        | "tr"
                        | "section"
                        | "article"
                        | "blockquote"
                        | "pre"
                ) {
                    out.push('\n');
                }
                if name == "li" && !tag.starts_with('/') {
                    out.push_str("- ");
                }
                tag.clear();
            } else {
                tag.push(c);
            }
        } else if c == '<' {
            in_tag = true;
        } else {
            out.push(c);
        }
    }
    entities(&out)
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn fetch(url: &str, offset: usize) -> anyhow::Result<String> {
    anyhow::ensure!(
        url.starts_with("http://") || url.starts_with("https://"),
        "Use an http(s) URL"
    );
    let res = agent().get(url).call()?;
    let kind = res.content_type().to_string();
    let body = res.into_string()?;
    let text = if kind.contains("html") || body.trim_start().starts_with('<') {
        readable(&body)
    } else {
        body
    };
    let chars: Vec<char> = text.chars().collect();
    const CHUNK: usize = 12_000;
    let start = offset.min(chars.len());
    let end = (start + CHUNK).min(chars.len());
    let mut out: String = chars[start..end].iter().collect();
    if end < chars.len() {
        out.push_str(&format!(
            "\n\n[{} of {} characters shown. Call web__fetch with offset {end} to read more.]",
            end - start,
            chars.len()
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_from_html() {
        let t = readable("<html><head><title>x</title></head><body><script>var a=1</script><h1>Hola &amp; chau</h1><p>uno<br>dos</p><ul><li>a</li></ul></body></html>");
        assert_eq!(t, "Hola & chau\nuno\ndos\n- a");
    }
    #[test]
    fn url_codec() {
        assert_eq!(encode("a b/ñ"), "a+b%2F%C3%B1");
        assert_eq!(decode("https%3A%2F%2Fx.com%2F%C3%B1"), "https://x.com/ñ");
    }
}
