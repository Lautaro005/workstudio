// Shared by every page: language switch (es/en), install boxes, latest release, nav border, reveal.
(() => {
  const root = document.documentElement;
  const saved = (() => { try { return localStorage.getItem("ws-lang"); } catch { return null; } })();
  const fromUrl = new URLSearchParams(location.search).get("lang");
  let lang = fromUrl || saved || ((navigator.language || "es").toLowerCase().startsWith("es") ? "es" : "en");
  if (lang !== "es" && lang !== "en") lang = "es";

  const T = {
    es: { copy: "Copiar", copied: "¡Copiado!", unix: (all) => `Instala la app (en macOS, en /Applications) y el comando workstudio${all ? ", más brain, Lumina y OpenCue" : ""}.`, win: (all) => `En PowerShell. Instala la app para tu usuario y el comando workstudio${all ? ", más brain, Lumina y OpenCue" : ""}.`, download: (ext, tag) => `Descargar ${ext} · ${tag}`, latest: (tag) => `Última versión: ${tag}` },
    en: { copy: "Copy", copied: "Copied!", unix: (all) => `Installs the app (on macOS, in /Applications) and the workstudio command${all ? ", plus brain, Lumina and OpenCue" : ""}.`, win: (all) => `In PowerShell. Installs the app for your user and the workstudio command${all ? ", plus brain, Lumina and OpenCue" : ""}.`, download: (ext, tag) => `Download ${ext} · ${tag}`, latest: (tag) => `Latest version: ${tag}` },
  };
  const listeners = [];
  const setLang = (l) => {
    lang = l;
    root.lang = l;
    try { localStorage.setItem("ws-lang", l); } catch {}
    document.querySelectorAll("[data-set-lang]").forEach((b) => b.classList.toggle("on", b.dataset.setLang === l));
    const title = document.querySelector(`meta[name="title-${l}"]`);
    if (title) document.title = title.content;
    listeners.forEach((f) => f());
  };
  document.querySelectorAll("[data-set-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.setLang)));

  // Install boxes
  const RAW = "https://raw.githubusercontent.com/Lautaro005/workstudio/main";
  const isWin = /Windows/i.test(navigator.userAgent);
  const cmds = {
    unix: (all) => `curl -fsSL ${RAW}/install.sh | sh${all ? " -s -- --all" : ""}`,
    win: (all) => `${all ? '$env:WORKSTUDIO_WITH="brain,lumina,opencue"; ' : ""}irm ${RAW}/install.ps1 | iex`,
  };
  document.querySelectorAll("[data-install]").forEach((box) => {
    let os = isWin ? "win" : "unix";
    const all = box.querySelector("[data-all]");
    const copy = box.querySelector("[data-copy]");
    const render = () => {
      box.querySelectorAll("[data-os]").forEach((b) => b.classList.toggle("on", b.dataset.os === os));
      box.querySelector("[data-cmd]").textContent = cmds[os](all.checked);
      box.querySelector("[data-note]").textContent = T[lang][os](all.checked);
      box.querySelector(".p").textContent = os === "win" ? ">" : "$";
      copy.textContent = T[lang].copy;
    };
    box.querySelectorAll("[data-os]").forEach((b) => b.addEventListener("click", () => { os = b.dataset.os; render(); }));
    all.addEventListener("change", render);
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(cmds[os](all.checked)); copy.textContent = T[lang].copied; setTimeout(() => (copy.textContent = T[lang].copy), 1500); } catch {}
    });
    listeners.push(render);
  });

  // Latest release: point the download link at the right file.
  const dl = document.querySelector("[data-download]");
  const ver = document.querySelector("[data-version]");
  if (dl || ver) {
    let rel = null, asset = null;
    const paint = () => {
      if (!rel) return;
      if (dl && asset) { dl.href = asset.browser_download_url; dl.textContent = T[lang].download(asset.name.split(".").pop().toUpperCase(), rel.tag_name); }
      if (ver) ver.textContent = T[lang].latest(rel.tag_name);
    };
    fetch("https://api.github.com/repos/Lautaro005/workstudio/releases/latest").then((r) => (r.ok ? r.json() : null)).then((r) => {
      if (!r) return;
      rel = r;
      const ua = navigator.userAgent;
      const pick = (re) => r.assets.find((a) => re.test(a.name));
      asset = /Windows/i.test(ua) ? pick(/x64-setup\.exe$/) : /Mac/i.test(ua) ? pick(/universal\.dmg$/) || pick(/\.dmg$/) : pick(/amd64\.AppImage$/);
      paint();
    }).catch(() => {});
    listeners.push(paint);
  }

  const nav = document.querySelector("nav.top");
  const onScroll = () => nav && nav.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.1 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  } else document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));

  // Docs table of contents: highlight the section in view.
  const toc = document.querySelectorAll(".toc a[href^='#']");
  if (toc.length && "IntersectionObserver" in window) {
    const map = new Map([...toc].map((a) => [a.getAttribute("href").slice(1), a]));
    const so = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { toc.forEach((a) => a.classList.remove("on")); map.get(e.target.id)?.classList.add("on"); }
    }), { rootMargin: "-20% 0px -70% 0px" });
    map.forEach((_, id) => { const el = document.getElementById(id); if (el) so.observe(el); });
  }

  const today = document.querySelector("[data-today]");
  if (today) listeners.push(() => (today.textContent = new Date().toLocaleDateString(lang === "es" ? "es-AR" : "en-US", { weekday: "long", day: "numeric", month: "long" })));

  setLang(lang);
  window.wsLang = () => lang;
  window.wsOnLang = (f) => listeners.push(f);
})();
