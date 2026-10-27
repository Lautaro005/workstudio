//! Apps like brain keep their UI preferences (theme, language, menu order, graph colors…) in the
//! localStorage of their own desktop window. WorkStudio's embedded view has a separate store, so it
//! opened with the defaults. This reads the app's store (macOS WebKit) and builds a script that copies
//! those values into the embedded view before the page runs.

use std::path::{Path, PathBuf};

/// WebKit's `origin` file holds the scheme, host and a little-endian port for each site.
fn origin_matches(file: &Path, host: &str, port: u16) -> bool {
    let Ok(bytes) = std::fs::read(file) else {
        return false;
    };
    let mut pat = host.as_bytes().to_vec();
    pat.push(1);
    pat.extend_from_slice(&port.to_le_bytes());
    bytes.windows(pat.len()).any(|w| w == pat.as_slice())
}

fn store_dir(store: &str, host: &str, port: u16) -> Option<PathBuf> {
    let base = crate::paths::home()
        .join("Library/WebKit")
        .join(store)
        .join("WebsiteData/Default");
    for a in std::fs::read_dir(&base).ok()?.flatten() {
        for b in std::fs::read_dir(a.path()).ok()?.flatten() {
            let dir = b.path();
            if origin_matches(&dir.join("origin"), host, port) {
                let ls = dir.join("LocalStorage");
                if ls.join("localstorage.sqlite3").exists() {
                    return Some(ls);
                }
            }
        }
    }
    None
}

fn utf16le(hex: &str) -> Option<String> {
    let bytes: Vec<u8> = (0..hex.len() / 2)
        .filter_map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok())
        .collect();
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    String::from_utf16(&units).ok()
}

/// Key/value pairs of the app's own localStorage for `url`.
pub fn read(store: &str, url: &str) -> Vec<(String, String)> {
    if store.is_empty() || !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return Vec::new();
    };
    let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);
    let Some(dir) = store_dir(store, &host, port) else {
        return Vec::new();
    };
    // Copy the database (and its write-ahead log) so the app's own window is never disturbed.
    let tmp = std::env::temp_dir().join(format!("workstudio-ls-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);
    for f in [
        "localstorage.sqlite3",
        "localstorage.sqlite3-wal",
        "localstorage.sqlite3-shm",
    ] {
        let _ = std::fs::copy(dir.join(f), tmp.join(f));
    }
    let out = std::process::Command::new("sqlite3")
        .args([
            "-json",
            &tmp.join("localstorage.sqlite3").to_string_lossy(),
            "SELECT key, hex(value) AS v FROM ItemTable",
        ])
        .output();
    let _ = std::fs::remove_dir_all(&tmp);
    let Ok(out) = out else { return Vec::new() };
    let rows: Vec<serde_json::Value> = serde_json::from_slice(&out.stdout).unwrap_or_default();
    rows.iter()
        .filter_map(|r| {
            let k = r.get("key")?.as_str()?.to_string();
            let v = utf16le(r.get("v")?.as_str()?)?;
            Some((k, v))
        })
        .collect()
}

/// A script for the embedded view. It writes the values again only when the app's own window changed
/// them since the last copy, so changes made inside WorkStudio are kept until then.
pub fn init_script(store: &str, url: &str) -> Option<String> {
    let pairs = read(store, url);
    if pairs.is_empty() {
        return None;
    }
    let mut obj = serde_json::Map::new();
    for (k, v) in &pairs {
        // Timestamps of the app's own update checks are not preferences.
        if k.ends_with("-checked") {
            continue;
        }
        obj.insert(k.clone(), serde_json::Value::String(v.clone()));
    }
    let data = serde_json::Value::Object(obj).to_string();
    let mut h: u64 = 0xcbf29ce484222325;
    for b in data.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let origin = url
        .parse::<tauri::Url>()
        .ok()
        .map(|u| u.origin().ascii_serialization())?;
    Some(format!(
        r#"(function(){{try{{if(location.origin!=={origin:?})return;var d={data};var s="{h:x}";if(localStorage.getItem("__workstudio_import")===s)return;for(var k in d)localStorage.setItem(k,d[k]);localStorage.setItem("__workstudio_import",s);}}catch(e){{}}}})();"#
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_webkit_values() {
        // "dark" in UTF-16LE
        assert_eq!(utf16le("6400610072006B00").as_deref(), Some("dark"));
    }
}

#[cfg(test)]
mod local {
    /// Run by hand on a Mac with brain installed: `cargo test reads_brain -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_brain() {
        let s =
            super::init_script("app.brain.desktop", "http://127.0.0.1:8765/").expect("no script");
        println!("{}", &s[..s.len().min(700)]);
    }
}
