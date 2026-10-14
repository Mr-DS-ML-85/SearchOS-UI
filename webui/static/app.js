/* ============================================================
   SearchOS Web UI — frontend logic
   ============================================================ */
(() => {
  "use strict";

  /* ---------- element refs ---------- */
  const $ = (id) => document.getElementById(id);
  const heroView = $("heroView"), resultsView = $("resultsView");
  const searchInput = $("searchInput"), searchClear = $("searchClear");
  const suggestBox = $("suggestBox");
  const resultList = $("resultList"), skeletonGrid = $("skeletonGrid");
  const emptyState = $("emptyState"), metarow = $("metarow");
  const metaInfo = $("metaInfo"), metaBadges = $("metaBadges");
  const webResults = $("webResults"), imagesView = $("imagesView");
  const imgGrid = $("imgGrid"), imgEmpty = $("imgEmpty");
  const loadMoreWrap = $("loadMoreWrap"), loadMoreBtn = $("loadMoreBtn");
  const domainInput = $("domainInput");
  const img2imgBar = $("img2imgBar"), imageUrlInput = $("imageUrlInput"), imageUrlGo = $("imageUrlGo");
  const readerOverlay = $("readerOverlay"), readerUrl = $("readerUrl"),
        readerBody = $("readerBody"), readerClose = $("readerClose");
  const toast = $("toast");
  const statusDot = $("statusDot"), statusText = $("statusText");

  /* ---------- state ---------- */
  const state = {
    view: "web",            // "web" | "images"
    query: "",
    source: "all",
    timeRange: "all",
    domains: [],
    cursor: null,
    loading: false,
    lastSearchSig: "",
    imageUrl: "",
  };

  const PAGE_SIZE = 10;
  let toastTimer = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const apiUrl = (path, params) => {
    const usp = new URLSearchParams();
    for (const [k, v] of params) if (v !== undefined && v !== null && v !== "") usp.append(k, v);
    const qs = usp.toString();
    return `/api${path}${qs ? `?${qs}` : ""}`;
  };

  async function apiGet(path, params) {
    const resp = await fetch(apiUrl(path, params));
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = body.message || body.error || `HTTP ${resp.status}`;
      const err = new Error(msg);
      err.code = body.error;
      err.status = resp.status;
      throw err;
    }
    return body;
  }

  function showToast(msg, ms = 2600) {
    toast.textContent = msg;
    toast.hidden = false;
    toast.classList.remove("hide");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => { toast.hidden = true; }, 260);
    }, ms);
  }

  const SOURCE_LABEL = {
    local: "local", vector: "vector", web: "web", searxng: "searxng",
    tavily: "tavily", exa: "exa", jina: "jina", federated: "federated",
    google: "google", federated_web: "fed-web",
  };

  /* ---------- health ---------- */
  async function checkHealth() {
    try {
      const h = await apiGet("/health", []);
      const ok = h.status === "ok";
      const modelsOk = h.services?.models === "ok";
      statusDot.className = "status-dot " + (ok && modelsOk ? "ok" : "");
      statusText.textContent = ok
        ? (modelsOk ? "all systems go" : "warming up")
        : "degraded";
    } catch {
      statusDot.className = "status-dot down";
      statusText.textContent = "offline";
    }
  }

  /* ---------- URL sync ---------- */
  function syncUrl(push = true) {
    const usp = new URLSearchParams();
    if (state.query) usp.set("q", state.query);
    if (state.view !== "web") usp.set("view", state.view);
    if (state.source !== "all") usp.set("source", state.source);
    if (state.timeRange !== "all") usp.set("time", state.timeRange);
    if (state.domains.length) usp.set("domains", state.domains.join(","));
    const url = `${location.pathname}${usp.toString() ? `?${usp}` : ""}`;
    if (push) history.pushState({}, "", url); else history.replaceState({}, "", url);
  }

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.query = p.get("q") || "";
    state.view = p.get("view") === "images" ? "images" : "web";
    state.source = p.get("source") || "all";
    state.timeRange = p.get("time") || "all";
    state.domains = (p.get("domains") || "").split(",").map((s) => s.trim()).filter(Boolean);
    state.cursor = null;
    searchInput.value = state.query;
    searchClear.classList.toggle("visible", !!state.query);
    syncFiltersUi();
    syncTabs();
    if (state.query) {
      showResultsView();
      runSearch(true);
    } else {
      showHero();
    }
  }

  /* ---------- views ---------- */
  function showHero() {
    heroView.hidden = false;
    resultsView.hidden = true;
  }

  function showResultsView() {
    heroView.hidden = true;
    resultsView.hidden = false;
  }

  function syncTabs() {
    document.querySelectorAll(".tab").forEach((t) => {
      const active = t.dataset.view === state.view;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active);
    });
    webResults.hidden = state.view !== "web";
    imagesView.hidden = state.view !== "images";
    img2imgBar.hidden = state.view !== "images";
  }

  /* ---------- filters UI ---------- */
  function syncFiltersUi() {
    document.querySelectorAll("#sourceFilters .fbtn").forEach((b) =>
      b.classList.toggle("active", b.dataset.source === state.source));
    document.querySelectorAll("#timeFilters .fbtn").forEach((b) =>
      b.classList.toggle("active", b.dataset.time === state.timeRange));
    if (document.activeElement !== domainInput) domainInput.value = state.domains.join(", ");
  }

  /* ---------- search execution ---------- */
  function showSkeletons() {
    resultList.innerHTML = "";
    emptyState.hidden = true;
    metarow.hidden = true;
    loadMoreWrap.hidden = true;
    skeletonGrid.innerHTML = "";
    for (let i = 0; i < 6; i++) {
      const d = document.createElement("div");
      d.className = "skel";
      d.innerHTML = `
        <div class="skel-line w40"></div>
        <div class="skel-line h18"></div>
        <div class="skel-line w90"></div>
        <div class="skel-line w70"></div>
        <div class="skel-line w55"></div>`;
      skeletonGrid.appendChild(d);
    }
  }

  function hideSkeletons() { skeletonGrid.innerHTML = ""; }

  function webParams() {
    const params = [
      ["q", state.query],
      ["sources", state.source],
      ["num_results", String(PAGE_SIZE)],
      ["time_range", state.timeRange],
    ];
    state.domains.forEach((d) => params.push(["domains", d]));
    if (state.cursor) params.push(["cursor", state.cursor]);
    return params;
  }

  function imageParams() {
    // The images endpoint takes: q | image_url, limit, source, domains.
    const params = [["limit", String(PAGE_SIZE * 2)]];
    if (state.imageUrl) params.push(["image_url", state.imageUrl]);
    else params.push(["q", state.query]);
    state.domains.forEach((d) => params.push(["domains", d]));
    return params;
  }

  async function runSearch(reset) {
    if (!state.query.trim() && !state.imageUrl) { showHero(); return; }
    if (state.loading) return;
    state.loading = true;

    if (reset) {
      state.cursor = null;
      state.lastSearchSig = "";
      if (state.view === "web") showSkeletons();
      else { imgGrid.innerHTML = ""; imgEmpty.hidden = true; }
    }
    loadMoreBtn.disabled = true;

    const sig = JSON.stringify([state.query, state.imageUrl, state.source, state.timeRange, state.domains, state.cursor]);
    state.lastSearchSig = sig;

    try {
      if (state.view === "web") {
        const data = await apiGet("/search", webParams());
        if (state.lastSearchSig !== sig) return;
        hideSkeletons();
        if (reset) resultList.innerHTML = "";
        if (data.results?.length) renderResults(data);
        else if (reset) showEmpty();
        renderMeta(data);
        state.cursor = data.has_more ? data.next_cursor : null;
        loadMoreWrap.hidden = !data.has_more;
      } else {
        const data = await apiGet("/images", imageParams());
        if (state.lastSearchSig !== sig) return;
        renderImages(data);
      }
    } catch (err) {
      hideSkeletons();
      if (state.view === "web") {
        resultList.innerHTML = "";
        showEmpty();
        renderMetaError(err);
      } else {
        imgGrid.innerHTML = "";
        imgEmpty.hidden = false;
        imgEmpty.querySelector("p").textContent =
          err.code === "gateway_unreachable"
            ? "Gateway unreachable — is SearchOS running?"
            : err.message;
      }
      showToast(err.message, 3600);
    } finally {
      state.loading = false;
      loadMoreBtn.disabled = false;
    }
  }

  function showEmpty() {
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent =
      "Try different keywords, remove filters, or check your spelling.";
  }

  /* ---------- meta row ---------- */
  function renderMeta(data) {
    metarow.hidden = false;
    const parts = [];
    parts.push(`<strong>${data.total ?? data.results?.length ?? 0}</strong> results`);
    if (data.took_ms != null) parts.push(`in ${(data.took_ms / 1000).toFixed(2)}s`);
    if (data.semantic_cache_hit) parts.push(`semantic cache · ${Math.round((data.semantic_cache_similarity ?? 0) * 100)}% match`);
    else if (data.cache_hit) parts.push("cached");
    metaInfo.innerHTML = parts.join(" · ");

    metaBadges.innerHTML = "";
    const addBadge = (cls, text) => {
      const s = document.createElement("span");
      s.className = `badge ${cls}`;
      s.textContent = text;
      metaBadges.appendChild(s);
    };

    // per-provider health: ok / degraded / empty
    const degraded = new Set(data.degraded || []);
    const empty = new Set(data.empty_providers || []);
    const lat = data.provider_latency_ms || {};
    if (data.providers?.length) {
      data.providers.forEach((p) => {
        const name = SOURCE_LABEL[p] || p;
        if (degraded.has(p)) addBadge("warn", `${name} degraded`);
        else if (empty.has(p)) addBadge("info", `${name} empty`);
        else {
          const ms = lat[p];
          addBadge("ok", `${name}${ms != null ? ` ${Math.round(ms)}ms` : ""}`);
        }
      });
    }
    if (data.low_confidence) addBadge("warn", "low confidence");
  }

  function renderMetaError(err) {
    metarow.hidden = false;
    metaInfo.textContent = err.message;
    metaBadges.innerHTML = "";
  }

  /* ---------- web results ---------- */
  function highlight(snippet, query) {
    let out = esc(snippet);
    const terms = query.split(/\s+/).filter((t) => t.length > 2 && !t.startsWith("-")).slice(0, 8);
    for (const t of terms) {
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
      out = out.replace(re, "<mark>$1</mark>");
    }
    return out;
  }

  function renderResults(data) {
    emptyState.hidden = true;
    data.results.forEach((r, i) => {
      const card = document.createElement("a");
      card.className = "result-card";
      card.href = r.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.style.animationDelay = `${Math.min(i * 45, 400)}ms`;

      const score = r.score != null ? r.score.toFixed(1) : "";

      card.innerHTML = `
        <div class="rc-top">
          <div class="rc-favicon">${esc((r.domain || "?").charAt(0).toUpperCase())}</div>
          <span class="rc-domain">${esc(r.domain || "")}</span>
          <span class="rc-url">${esc(r.url)}</span>
          ${score ? `<span class="rc-score" title="relevance score">${score}</span>` : ""}
        </div>
        <div class="rc-title">${esc(r.title)}</div>
        <div class="rc-snippet">${highlight(r.snippet || "", data.query || state.query)}</div>
        <div class="rc-actions">
          <button class="rc-action" data-read="${esc(r.url)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
            Read
          </button>
          <button class="rc-action" data-copy="${esc(r.url)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            Copy
          </button>
        </div>`;
      resultList.appendChild(card);
    });
  }

  /* ---------- image results ---------- */
  function renderImages(data) {
    const images = data.images || [];
    imgGrid.innerHTML = "";
    imgEmpty.hidden = images.length > 0;
    if (!images.length) {
      imgEmpty.querySelector("p").textContent =
        data.below_min_score > 0
          ? `${data.below_min_score} match${data.below_min_score > 1 ? "es" : ""} below the similarity floor.`
          : "Nothing in the index depicts that. Try different words.";
      return;
    }
    images.forEach((img, i) => {
      const card = document.createElement("div");
      card.className = "img-card";
      card.style.animationDelay = `${Math.min(i * 50, 400)}ms`;
      card.innerHTML = `
        <img class="img-thumb" loading="lazy" src="${esc(img.url)}" alt="${esc(img.alt_text || "image")}" />
        <div class="img-meta">
          <div class="img-alt">${esc(img.alt_text || "(no caption)")}</div>
          <div class="img-src">${esc(img.source_url || "")}</div>
          <div class="img-score">score ${img.score != null ? img.score.toFixed(3) : "?"}</div>
        </div>`;
      imgGrid.appendChild(card);
    });
  }

  /* ---------- reader modal ---------- */
  async function openReader(url) {
    readerOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    readerUrl.textContent = url;
    readerBody.innerHTML = `<div class="reader-loading"><div class="spinner"></div>Fetching page…</div>`;
    readerClose.focus();
    try {
      const data = await apiGet("/read", [["url", url]]);
      const text = typeof data === "string" ? data : (data.content || data.text || data.message || "");
      const title = (typeof data === "object" && data.title) ? `<h1>${esc(data.title)}</h1>` : "";
      const paragraphs = text
        .split(/\n{2,}/)
        .filter((b) => b.trim())
        .map((block) => `<p>${block.trim().replace(/\n/g, "<br>")}</p>`)
        .join("");
      readerBody.innerHTML = title + paragraphs;
    } catch (err) {
      readerBody.innerHTML = `<div class="reader-loading">Could not read this page.<br><br>${esc(err.message)}</div>`;
    }
  }

  function closeReader() {
    readerOverlay.hidden = true;
    document.body.style.overflow = "";
  }

  /* ---------- suggestions ---------- */
  let suggestTimer = null, activeSuggestIdx = -1;

  async function fetchSuggestions() {
    const q = searchInput.value.trim();
    if (q.length < 2) { suggestBox.classList.remove("open"); return; }
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      try {
        const items = await apiGet("/suggest", [["q", q], ["limit", "6"]]);
        const list = Array.isArray(items) ? items : [];
        activeSuggestIdx = -1;
        suggestBox.innerHTML = "";
        if (!list.length) {
          suggestBox.innerHTML = `<div class="suggest-empty">No suggestions</div>`;
        } else {
          list.forEach((it, idx) => {
            const div = document.createElement("div");
            div.className = "suggest-item";
            div.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg><span>${esc(it.text)}</span>`;
            div.addEventListener("mousedown", (e) => {
              e.preventDefault();
              searchInput.value = it.text;
              doSearch(it.text);
            });
            suggestBox.appendChild(div);
          });
        }
        suggestBox.classList.add("open");
      } catch {
        suggestBox.classList.remove("open");
      }
    }, 180);
  }

  function moveSuggestion(dir) {
    const items = suggestBox.querySelectorAll(".suggest-item");
    if (!items.length) return;
    activeSuggestIdx = (activeSuggestIdx + dir + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("active", i === activeSuggestIdx));
  }

  function applySuggestion() {
    const el = suggestBox.querySelector(".suggest-item.active") || suggestBox.querySelector(".suggest-item");
    if (el) {
      const text = el.textContent.trim();
      searchInput.value = text;
      doSearch(text);
    }
  }

  /* ---------- search trigger ---------- */
  function doSearch(q) {
    const query = (q ?? searchInput.value).trim();
    if (!query) return;
    state.query = query;
    state.imageUrl = "";
    state.cursor = null;
    searchInput.value = query;
    searchClear.classList.add("visible");
    suggestBox.classList.remove("open");
    syncUrl();
    showResultsView();
    runSearch(true);
  }

  /* ---------- events ---------- */
  $("searchGo").addEventListener("click", () => doSearch());

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestBox.classList.contains("open") && activeSuggestIdx >= 0) applySuggestion();
      else doSearch();
    } else if (e.key === "ArrowDown") { e.preventDefault(); moveSuggestion(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSuggestion(-1); }
    else if (e.key === "Escape") suggestBox.classList.remove("open");
  });
  searchInput.addEventListener("input", () => {
    searchClear.classList.toggle("visible", !!searchInput.value);
    fetchSuggestions();
  });
  searchInput.addEventListener("blur", () => setTimeout(() => suggestBox.classList.remove("open"), 150));
  searchInput.addEventListener("focus", () => { if (searchInput.value.trim().length >= 2) fetchSuggestions(); });
  searchClear.addEventListener("click", () => {
    searchInput.value = "";
    searchClear.classList.remove("visible");
    searchInput.focus();
    if (!state.query) { showHero(); syncUrl(false); }
  });

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      if (state.view === t.dataset.view) return;
      state.view = t.dataset.view;
      state.cursor = null;
      syncTabs();
      syncUrl();
      if (state.query.trim() || state.imageUrl) runSearch(true);
    }));

  document.querySelectorAll("#sourceFilters .fbtn").forEach((b) =>
    b.addEventListener("click", () => {
      state.source = b.dataset.source;
      state.cursor = null;
      syncFiltersUi();
      syncUrl();
      if (state.query.trim()) runSearch(true);
    }));

  document.querySelectorAll("#timeFilters .fbtn").forEach((b) =>
    b.addEventListener("click", () => {
      state.timeRange = b.dataset.time;
      state.cursor = null;
      syncFiltersUi();
      syncUrl();
      if (state.query.trim()) runSearch(true);
    }));

  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      state.domains = domainInput.value.split(",").map((s) => s.trim().replace(/^https?:\/\//, "")).filter(Boolean);
      state.cursor = null;
      domainInput.blur();
      syncUrl();
      if (state.query.trim()) runSearch(true);
    } else if (e.key === "Escape") { domainInput.blur(); }
  });
  domainInput.addEventListener("blur", () => syncFiltersUi());

  /* image-to-image */
  async function searchByImageUrl() {
    const url = imageUrlInput.value.trim();
    if (!url) return;
    state.imageUrl = url;
    state.query = "";
    searchInput.value = "";
    searchClear.classList.remove("visible");
    state.view = "images";
    syncTabs();
    showResultsView();
    runSearch(true);
  }
  imageUrlGo.addEventListener("click", searchByImageUrl);
  imageUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchByImageUrl(); }
  });

  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => doSearch(c.dataset.q)));

  $("brand").addEventListener("click", (e) => {
    e.preventDefault();
    state.query = ""; state.imageUrl = ""; state.cursor = null;
    searchInput.value = "";
    searchClear.classList.remove("visible");
    resultList.innerHTML = "";
    imgGrid.innerHTML = "";
    syncUrl();
    showHero();
    searchInput.focus();
  });

  resultList.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      e.preventDefault();
      navigator.clipboard.writeText(copyBtn.dataset.copy).then(() => showToast("Link copied"));
      return;
    }
    const readBtn = e.target.closest("[data-read]");
    if (readBtn) {
      e.preventDefault();
      openReader(readBtn.dataset.read);
    }
  });

  loadMoreBtn.addEventListener("click", () => runSearch(false));

  readerClose.addEventListener("click", closeReader);
  readerOverlay.addEventListener("click", (e) => { if (e.target === readerOverlay) closeReader(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !readerOverlay.hidden) closeReader();
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      searchInput.focus();
    }
  });

  window.addEventListener("popstate", readUrl);

  /* ---------- boot ---------- */
  readUrl();
  syncTabs();
  checkHealth();
  setInterval(checkHealth, 60000);
})();
