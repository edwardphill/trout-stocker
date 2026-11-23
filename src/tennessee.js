/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Today in the state on screen: Tennessee's trout country runs on Central and Eastern time, so Central is the safe
// choice (a stocking "today" in Knoxville is still today in Nashville); Georgia is Eastern.
const tz = () => (SK.state === "GA" ? "America/New_York" : "America/Chicago");
function todayStr() {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz(), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch (e) { return ymd(new Date()); }
}
function parseD(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function ymd(dt) { return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0"); }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); }
const fmtD = (s, o) => parseD(s).toLocaleDateString("en-US", o);

let toastT = 0;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 3400);
}

/* ---------- pan and zoom (shared by both maps) ---------- */
function makePanZoom(svg, zg, W, H, opts = {}) {
  const maxK = opts.maxK || 16, ptr = new Map();
  let drag = null, anim = 0;
  const pz = { Z: { k: 1, x: 0, y: 0 }, ppu: 0, W, H };
  const clamp = (z) => { const k = Math.max(1, Math.min(maxK, z.k)); return { k, x: Math.min(0, Math.max(W - W * k, z.x)), y: Math.min(0, Math.max(H - H * k, z.y)) }; };
  const toView = (cx, cy) => { const r = svg.getBoundingClientRect(); return [(cx - r.left) * W / r.width, (cy - r.top) * H / r.height]; };
  pz.apply = () => {
    const { k, x, y } = pz.Z;
    zg.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})`);
    svg.classList.toggle("zoomed", k > 1.01);
    const w = svg.getBoundingClientRect().width;
    if (w) pz.ppu = w / W;
    if (opts.onZoom) opts.onZoom(pz);
  };
  pz.unit = () => (pz.ppu ? 1 / (pz.ppu * pz.Z.k) : 0);       // one screen pixel, in map units
  pz.screenOf = (px, py) => { const r = svg.getBoundingClientRect(), s = r.width / W, { k, x, y } = pz.Z; return [r.left + (px * k + x) * s, r.top + (py * k + y) * s]; };
  pz.set = (z) => { cancelAnimationFrame(anim); pz.Z = clamp(z); pz.apply(); };
  pz.zoomAt = (f, px, py) => { const { k, x, y } = pz.Z, nk = Math.max(1, Math.min(maxK, k * f)); pz.set({ k: nk, x: px - (px - x) * (nk / k), y: py - (py - y) * (nk / k) }); };
  pz.animateTo = (t) => {
    t = clamp(t);
    cancelAnimationFrame(anim);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { pz.Z = t; pz.apply(); return; }
    const a = { ...pz.Z }, ca = [(W / 2 - a.x) / a.k, (H / 2 - a.y) / a.k], cb = [(W / 2 - t.x) / t.k, (H / 2 - t.y) / t.k];
    const t0 = performance.now(), dur = 460;
    const step = (now) => {
      let p = Math.min(1, (now - t0) / dur);
      p = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const k = a.k * Math.pow(t.k / a.k, p), cx = ca[0] + (cb[0] - ca[0]) * p, cy = ca[1] + (cb[1] - ca[1]) * p;
      pz.Z = p >= 1 ? t : clamp({ k, x: W / 2 - cx * k, y: H / 2 - cy * k });
      pz.apply();
      if (p < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  };
  pz.centerOn = (px, py, k) => pz.animateTo({ k, x: W / 2 - px * k, y: H / 2 - py * k });
  pz.zoomStep = (f) => { const { k, x, y } = pz.Z; pz.centerOn((W / 2 - x) / k, (H / 2 - y) / k, k * f); };
  pz.fit = (x0, y0, x1, y1, fitMax = 9, pad = 10) => {
    const k = Math.max(1, Math.min(fitMax, W / (x1 - x0 + pad * 2), H / (y1 - y0 + pad * 2)));
    pz.centerOn((x0 + x1) / 2, (y0 + y1) / 2, k);
  };
  const mid = (p, q) => toView((p.x + q.x) / 2, (p.y + q.y) / 2);
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(anim);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 1) drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, z: { ...pz.Z } };
    else if (ptr.size === 2) {
      const [p, q] = [...ptr.values()];
      drag = { pinch: true, d0: Math.max(10, Math.hypot(p.x - q.x, p.y - q.y)), m0: mid(p, q), z: { ...pz.Z }, moved: true };
      if (opts.onLeave) opts.onLeave();
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!ptr.has(e.pointerId)) { if (e.pointerType === "mouse" && opts.onHover) opts.onHover(e); return; }
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag;
    if (!d) return;
    if (d.pinch) {
      if (ptr.size < 2) return;
      const [p, q] = [...ptr.values()], m = mid(p, q);
      const k = Math.max(1, Math.min(maxK, d.z.k * Math.hypot(p.x - q.x, p.y - q.y) / d.d0));
      const mp = [(d.m0[0] - d.z.x) / d.z.k, (d.m0[1] - d.z.y) / d.z.k];
      pz.Z = clamp({ k, x: m[0] - mp[0] * k, y: m[1] - mp[1] * k });
      pz.apply();
      return;
    }
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 6) return;
      d.moved = true;
      if (opts.onLeave) opts.onLeave();
      if (pz.Z.k > 1.01) { try { svg.setPointerCapture(e.pointerId); } catch (_) {} svg.classList.add("dragging"); }
    }
    if (d.z.k > 1.01) {
      const s = W / svg.getBoundingClientRect().width;
      pz.Z = clamp({ k: d.z.k, x: d.z.x + dx * s, y: d.z.y + dy * s });
      pz.apply();
    }
  });
  const end = (e) => {
    if (!ptr.has(e.pointerId)) return;
    ptr.delete(e.pointerId);
    const d = drag;
    if (e.type === "pointerup" && d && !d.pinch && !d.moved && d.id === e.pointerId && opts.onTap) opts.onTap(e);
    if (!ptr.size) { drag = null; svg.classList.remove("dragging"); }
    else if (d && d.pinch) { const [id, p] = [...ptr.entries()][0]; drag = { id, sx: p.x, sy: p.y, moved: true, z: { ...pz.Z } }; }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && opts.onLeave) opts.onLeave(); });
  svg.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && pz.Z.k <= 1.001) return;
    e.preventDefault();
    const [px, py] = toView(e.clientX, e.clientY);
    pz.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025) * (e.deltaMode === 1 ? 16 : 1)), px, py);
  }, { passive: false });
  return pz;
}

function setHTML(el, html) { if (el && el._html !== html) { el.innerHTML = html; el._html = html; } }

const RAD = Math.PI / 180;

// Which tailwater's generation schedule goes with a trip or a water (data/generation.json).
function generationFor(text) {
  const t = String(text || "");
  return (window.GENERATION || []).find((g) => { try { return new RegExp(g.match, "i").test(t); } catch (e) { return false; } }) || null;
}
const genButton = (g) => g ? `<a class="btn ghost small" href="${esc(g.url)}" target="_blank" rel="noopener" title="${esc(g.note || "")}">${esc(g.dam)} generation</a>` : "";

/* ---------- Tennessee ---------- */
// TWRA's trout stocking schedule (data/stocking-tn.json, loaded as /stocking-tn.js): a state map with every
// stocked water, filters, and a list sorted by the next stocking.
const SK = {
  me: null, data: null, loading: null, built: false, narrow: null, pz: null, svg: null, proj: null, pins: [], cities: [], tcol: {},
  when: "upcoming", sort: "soon", q: "", regions: new Set(), types: new Set(), sel: null, state: null,
};
// Which state shows: the address (/georgia, /tennessee) decides on arrival, then the switch.
function skState() {
  if (!SK.state) SK.state = /^\/(georgia|ga)\/?$/i.test(location.pathname) || /^#?ga$/i.test(location.hash.slice(1)) ? "GA" : "TN";
  return SK.state;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const evEnd = (e) => (e[1] === "week" ? addDays(e[0], 5) : e[0]);   // "week of" a Sunday: within five days
const dayGap = (a, b) => Math.round((parseD(a) - parseD(b)) / 864e5);
function loadStocking() {
  if (window.STOCKING) return Promise.resolve();
  if (!SK.loading) SK.loading = new Promise((res, rej) => {
    const el = document.createElement("script");
    el.src = "/stocking-tn.js";
    el.onload = () => (window.STOCKING ? res() : rej(new Error("empty")));
    el.onerror = () => { SK.loading = null; el.remove(); rej(new Error("load")); };
    document.head.appendChild(el);
  });
  return SK.loading;
}
async function ensureStocking() {
  if (SK.data) return true;
  try { await loadStocking(); }
  catch (e) {
    const m = $("#sk-map-msg");
    if (m) m.innerHTML = `The schedule didn't load. <button class="linkbtn" type="button" data-act="sk-retry">Try again</button>`;
    return false;
  }
  const D = window.STOCKING;
  const order = ["Tailwater", "Delayed Harvest", "Reservoir", "Weekly", "Seasonal", "Winter"];
  D.waters.forEach((L, i) => {
    L.id = i;
    L.water = (L.name.includes(" / ") ? L.name.split(" / ").pop() : L.name).replace(/\s*\(.*?\)\s*/g, " ").trim();
    L.primary = order.find((t) => L.types.includes(t)) || L.types[0];
    L.ev.sort((a, b) => a[0].localeCompare(b[0]));
  });
  SK.tcol = Object.fromEntries(D.types.map((t) => [t[0], t[2]]));
  SK.data = D;
  $("#sk-regions").innerHTML = Object.entries(D.regions).map(([k, v]) => `<button class="chip" type="button" data-skr="${k}" aria-pressed="false">${esc(v)}</button>`).join("");
  $("#sk-types").innerHTML = D.types.map(([k, lab, col]) => `<button class="chip" type="button" data-skt="${esc(k)}" aria-pressed="false"><span class="sk-dot" style="background:${col}"></span>${esc(lab)}</button>`).join("");
  $("#sk-legend").innerHTML = D.types.map(([, lab, col]) => `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="${col}" stroke="#FFFFFF" stroke-width="1.5"/></svg>${esc(lab)}</span>`).join("")
    + `<span><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="#B3382C" stroke-width="1.6"/></svg>Stocked within 7 days</span>`;
  $("#sk-note").innerHTML = `Pins are approximate. "Week of" dates are Sundays; the truck comes within five days. Weather and water levels move stockings, so <a href="${esc(D.source)}" target="_blank" rel="noopener">check ${esc(D.agency)}</a> before you drive.`;
  return true;
}
// Where distances are measured from: the spot the visitor shared with "Nearest". It stays on this device.
const homeLL = () => SK.me;
function milesFromClub(L) {
  const c = homeLL(); if (!c) return null;
  const r = 3958.8, p1 = c.lat * RAD, p2 = L.lat * RAD, dp = (L.lat - c.lat) * RAD, dl = (L.lon - c.lon) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}
// The stockings of L that fall in the chosen window (and type filter); month-only waters count
// when one of their months does.
function skWindow(L, t0) {
  const ev = L.ev.filter((e) => !SK.types.size || SK.types.has(e[2]));
  const mons = L.months.filter((m) => !SK.types.size || SK.types.has(m[0]));
  if (SK.when === "all") return { ok: ev.length > 0 || mons.length > 0 || !SK.types.size, ev };
  const end = SK.when === "upcoming" ? addDays(t0, 400) : addDays(t0, +SK.when);
  const inw = ev.filter((e) => evEnd(e) >= t0 && e[0] <= end);
  let mon = false;
  if (mons.length) {
    const a = parseD(t0);
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); ymd(d) <= end && !mon; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      mon = mons.some((m) => m[1].includes(d.getMonth() + 1));
    }
  }
  return { ok: inw.length > 0 || mon, ev: inw };
}
const skNext = (L, t0, ev = L.ev) => ev.find((e) => evEnd(e) >= t0) || null;
const skSoon = (L, t0) => L.ev.some((e) => evEnd(e) >= t0 && e[0] <= addDays(t0, 7));
function skVisible(t0) {
  const q = SK.q.trim().toLowerCase();
  return SK.data.waters.map((L) => {
    if (SK.regions.size && !SK.regions.has(String(L.region))) return null;
    if (SK.types.size && !L.types.some((t) => SK.types.has(t))) return null;
    if (q && !(L.name + " " + L.county + " " + L.water).toLowerCase().includes(q)) return null;
    const w = skWindow(L, t0);
    if (!w.ok) return null;
    return { L, next: skNext(L, t0, w.ev), n: w.ev.filter((e) => evEnd(e) >= t0).length, mi: milesFromClub(L) };
  }).filter(Boolean);
}
// Stocking months as runs around the year: [1,2,3,4,11,12] reads "Nov–Apr".
function monthsText(L) {
  const set = new Set(L.months.flatMap((m) => m[1]));
  if (set.size >= 12) return "All year";
  if (!set.size) return "";
  let start = 1;
  while (!(set.has(start) && !set.has(((start + 10) % 12) + 1))) start = (start % 12) + 1;   // a month that opens a run
  const runs = [];
  for (let i = 0, m = start; i < 12; i++, m = (m % 12) + 1) {
    if (!set.has(m)) continue;
    const prev = ((m + 10) % 12) + 1;
    if (runs.length && set.has(prev) && i > 0) runs[runs.length - 1][1] = m; else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? MON[a - 1] : MON[a - 1] + "–" + MON[b - 1])).join(", ");
}
function whenText(e, t0) {
  if (!e) return "";
  if (e[1] === "week") {
    if (e[0] <= t0) return "This week";
    const g = dayGap(e[0], t0);
    return g <= 6 ? "Next week" : `In ${g} days`;
  }
  const g = dayGap(e[0], t0);
  return g === 0 ? "Today" : g === 1 ? "Tomorrow" : `In ${g} days`;
}
const evLabel = (e) => (e[1] === "week" ? "Week of " : "") + fmtD(e[0], { weekday: e[1] === "week" ? undefined : "short", month: "short", day: "numeric" });

function renderStockingTab() {
  const st = skState();
  document.querySelectorAll("#v-stocking [data-st]").forEach((el) => { el.hidden = el.dataset.st !== st; });
  document.querySelectorAll("[data-sksa]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sksa === st)));
  if (st === "GA") { renderGA(); return; }
  if (!SK.data) {
    $("#sk-list").innerHTML = `<li class="loading">Loading the schedule…</li>`;
    ensureStocking().then((ok) => { if (ok) scheduleRender(); });
    return;
  }
  const t0 = todayStr(), D = SK.data;
  $("#sk-lede").innerHTML = `${esc(D.agency)}'s trout stocking schedule for the ${esc(D.season)} season, every stocked water on one map. Tap a water for its dates.`;
  if (!SK.built) skBuild();
  const week = D.waters.flatMap((L) => L.ev.filter((e) => evEnd(e) >= t0 && e[0] <= addDays(t0, 7)).map((e) => ({ L, e })));
  const home = homeLL();
  const near = [...week].sort((a, b) => home ? milesFromClub(a.L) - milesFromClub(b.L) : (a.e[0] < b.e[0] ? -1 : a.e[0] > b.e[0] ? 1 : 0))[0];
  const nearTxt = near && (home
    ? `Closest to you: <button class="linkbtn" type="button" data-skw="${near.L.id}">${esc(near.L.name)}</button>, ${esc(evLabel(near.e))}, ${milesFromClub(near.L)} miles away.`
    : `Next up: <button class="linkbtn" type="button" data-skw="${near.L.id}">${esc(near.L.name)}</button>, ${esc(evLabel(near.e))}.`);
  setHTML($("#sk-score"), `<div class="tm-big">${week.length}</div>
    <div class="tm-score-r"><span class="tm-cap">Stockings in the next 7 days</span>
      <span class="tm-sub">${nearTxt || "Nothing on the schedule this week."} ${D.waters.length} waters on the ${esc(D.season)} schedule.</span></div>`);
  const vis = skVisible(t0);
  if (SK.sort === "near") vis.sort((a, b) => (a.mi ?? 9e9) - (b.mi ?? 9e9) || a.L.name.localeCompare(b.L.name));
  else vis.sort((a, b) => (a.next ? a.next[0] : "9999").localeCompare(b.next ? b.next[0] : "9999") || a.L.name.localeCompare(b.L.name));
  const nEv = vis.reduce((sum, v) => sum + v.n, 0);
  $("#sk-count").textContent = `${vis.length} ${vis.length === 1 ? "water" : "waters"} · ${nEv} dated ${nEv === 1 ? "stocking" : "stockings"}`;
  setHTML($("#sk-list"), vis.length ? vis.map((v) => skRow(v, t0)).join("") : `<li class="tm-empty">No waters match. Try a longer window or fewer filters.</li>`);
  document.querySelectorAll("[data-sks]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sks === SK.sort)));
  document.querySelectorAll("[data-skr]").forEach((b) => b.setAttribute("aria-pressed", String(SK.regions.has(b.dataset.skr))));
  document.querySelectorAll("[data-skt]").forEach((b) => b.setAttribute("aria-pressed", String(SK.types.has(b.dataset.skt))));
  skPaint(new Set(vis.map((v) => v.L.id)), t0);
}
function skRow({ L, next, mi }, t0) {
  const stamp = next
    ? `<span class="stamp" aria-hidden="true"><span class="${next[1] === "week" ? "wk" : "dow"}">${next[1] === "week" ? "Week of" : esc(fmtD(next[0], { weekday: "short" }))}</span><span class="dnum">${esc(fmtD(next[0], { day: "numeric" }))}</span><span class="mon">${esc(fmtD(next[0], { month: "short" }))}</span></span>`
    : `<span class="stamp" aria-hidden="true"><span class="dow">${L.months.length ? "Monthly" : "Done"}</span></span>`;
  const rel = next ? whenText(next, t0) : L.months.length ? `Monthly, ${monthsText(L)}` : "Done for the season";
  const soon = next && next[0] <= addDays(t0, 7);
  const types = L.types.map((t) => `<span class="sk-dot" style="background:${SK.tcol[t] || "#999"}"></span>${esc(t)}`).join(" · ");
  return `<li><button class="sk-row ${L.id === SK.sel ? "sel" : ""}" type="button" data-skw="${L.id}" aria-label="${esc(L.name + ", " + (next ? evLabel(next) : rel))}">
    ${stamp}
    <span class="tmain"><span class="sk-nm">${esc(L.name)}</span><span class="tm-meta">${esc(L.county)} Co. · ${types} · ${esc(L.species.join(", "))}</span></span>
    <span class="sk-side"><span class="sk-rel ${soon ? "soon" : ""}">${esc(rel)}</span>${mi != null ? `<span class="sk-mi">${mi} mi</span>` : ""}</span>
  </button></li>`;
}

/* Stocking map: a plain projection of Tennessee (it's small enough that a cosine-scaled
   equirectangular map reads right). On phones the map is taller than the state and opens zoomed
   in on the club, so pins are big enough to tap. */
function skBuild() {
  const D = SK.data, host = $("#sk-map");
  const narrow = host.clientWidth < 640;
  const B = { x0: -90.45, x1: -81.5, y0: 34.85, y1: 36.8 }, K = Math.cos(35.8 * RAD);
  const W = 960, sc = W / ((B.x1 - B.x0) * K), Hc = (B.y1 - B.y0) * sc;
  const VH = narrow ? Math.round(W * 0.66) : Math.round(Hc), oy = (VH - Hc) / 2;
  SK.proj = (lon, lat) => [(lon - B.x0) * K * sc, oy + (B.y1 - lat) * sc];
  const line = (pts) => "M" + pts.map(([lon, lat]) => SK.proj(lon, lat).map((v) => v.toFixed(1)).join(",")).join("L");
  const state = line(D.outline) + "Z";
  let grat = "";
  for (let lon = -90; lon <= -82; lon++) grat += line([[lon, B.y0], [lon, B.y1]]);
  for (let lat = 35; lat <= 36.5; lat += 0.5) grat += line([[B.x0, lat], [B.x1, lat]]);
  const c = homeLL(), [ccx, ccy] = c ? SK.proj(c.lon, c.lat) : [0, 0];
  const pins = D.waters.map((L) => { const [x, y] = SK.proj(L.lon, L.lat); return `<circle class="sk-ring" data-w="${L.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="none" stroke="#B3382C" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`; }).join("")
    + D.waters.map((L) => { const [x, y] = SK.proj(L.lon, L.lat); return `<circle class="sk-pin" data-w="${L.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${SK.tcol[L.primary]}" stroke="#FFFFFF" stroke-width="1.3" vector-effect="non-scaling-stroke"/>`; }).join("");
  const cities = D.cities.map(([n, lat, lon]) => { const [x, y] = SK.proj(lon, lat); return `<g class="sk-city" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#0C1A14"/><text x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(n)}</text></g>`; }).join("");
  const old = $("#sk-svg"); if (old) old.remove();
  host.insertAdjacentHTML("afterbegin", `<svg id="sk-svg" viewBox="0 0 ${W} ${VH}" role="img" aria-label="Map of Tennessee's stocked trout waters. The list below has every water.">
    <defs><clipPath id="sk-clip"><path d="${state}"/></clipPath></defs>
    <rect width="${W}" height="${VH}" fill="#E6EDF0"/>
    <g id="sk-z">
      <path d="${state}" fill="#F4F5F1" stroke="#0F6B4F" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
      <path d="${grat}" fill="none" stroke="#D3DCE0" stroke-width="0.6" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" clip-path="url(#sk-clip)"/>
      <g id="sk-pins">${pins}</g>
      <g id="sk-cities" font-family="Inter, system-ui, sans-serif" fill="#55655C" stroke="#F4F5F1" paint-order="stroke" stroke-linejoin="round" pointer-events="none">${cities}</g>
      ${c ? `<path id="sk-club" data-x="${ccx.toFixed(1)}" data-y="${ccy.toFixed(1)}" fill="#8DA096" stroke="#FFFFFF" stroke-width="1.2" vector-effect="non-scaling-stroke" pointer-events="none"/>` : ""}
    </g>
  </svg>`);
  const m = $("#sk-map-msg"); if (m) m.remove();
  $("#sk-ctl").hidden = false;
  SK.svg = $("#sk-svg"); SK.narrow = narrow; SK.built = true; SK.H = VH; SK.Hc = Hc;
  SK.pins = [...SK.svg.querySelectorAll(".sk-pin")]; SK.rings = [...SK.svg.querySelectorAll(".sk-ring")];
  SK.pz = makePanZoom(SK.svg, $("#sk-z"), W, VH, {
    maxK: 30, onZoom: skZoomed, onHover: skHover, onLeave: skHideTip,
    onTap: (e) => { const id = skHit(e.clientX, e.clientY, e.pointerType === "mouse" ? 12 : 22); if (id != null) { skHideTip(); openWater(id); } },
  });
  skHome(false);
}
// The opening view: the whole state on wide screens; on phones, filled to height around the club.
function skHome(animate) {
  if (!SK.pz) return;
  let z = { k: 1, x: 0, y: 0 };
  if (SK.narrow) {
    const c = homeLL(), k = SK.H / SK.Hc, [cx, cy] = c ? SK.proj(Math.max(-89, Math.min(-82.5, c.lon)), c.lat) : [480, SK.H / 2];
    z = { k, x: 480 - cx * k, y: SK.H / 2 - cy * k };
  }
  if (animate) SK.pz.animateTo(z); else SK.pz.set(z);
}
function skZoomed(pz) {
  const u = pz.unit(); if (!u) return;
  const big = SK.narrow ? 1.2 : 1;
  SK.pins.forEach((el) => el.setAttribute("r", ((+el.dataset.w === SK.sel ? 7.5 : 5) * big * u).toFixed(3)));
  SK.rings.forEach((el) => el.setAttribute("r", (9.5 * big * u).toFixed(3)));
  const cg = $("#sk-cities");
  cg.setAttribute("font-size", (13 * u).toFixed(3)); cg.setAttribute("stroke-width", (3 * u).toFixed(3));
  cg.querySelectorAll(".sk-city").forEach((g) => {
    g.querySelector("circle").setAttribute("r", (2.4 * u).toFixed(3));
    const t = g.querySelector("text");
    t.setAttribute("x", (+g.dataset.x + 5 * u).toFixed(2)); t.setAttribute("y", (+g.dataset.y - 4 * u).toFixed(2));
  });
  const cl = $("#sk-club");
  if (cl) { const x = +cl.dataset.x, y = +cl.dataset.y, r = 7 * u; cl.setAttribute("d", `M${x},${y - r}L${x + r},${y}L${x},${y + r}L${x - r},${y}Z`); }
}
function skPaint(visible, t0) {
  if (!SK.built) return;
  const L = SK.data.waters;
  SK.pins.forEach((el) => {
    const id = +el.dataset.w, on = visible.has(id);
    el.setAttribute("opacity", on ? 1 : 0.15);
    el.setAttribute("stroke", id === SK.sel ? "#0C1A14" : "#FFFFFF");
    el.setAttribute("stroke-width", id === SK.sel ? 2.4 : 1.3);
  });
  SK.rings.forEach((el) => { const id = +el.dataset.w; el.setAttribute("display", visible.has(id) && skSoon(L[id], t0) ? "inline" : "none"); });
  // Matching pins draw on top of the dimmed ones.
  const g = $("#sk-pins");
  SK.pins.filter((el) => visible.has(+el.dataset.w)).forEach((el) => g.appendChild(el));
  const sel = SK.pins.find((el) => +el.dataset.w === SK.sel); if (sel) g.appendChild(sel);
  SK.pz.apply();
}
function skHit(cx, cy, tol) {
  const t0 = todayStr(), vis = new Set(skVisible(t0).map((v) => v.L.id));
  let best = null, bd = tol;
  SK.data.waters.forEach((L) => {
    const [px, py] = SK.proj(L.lon, L.lat), [sx, sy] = SK.pz.screenOf(px, py);
    const d = Math.hypot(sx - cx, sy - cy) * (vis.has(L.id) ? 1 : 1.8);
    if (d < bd) { bd = d; best = L.id; }
  });
  return best;
}
function skHideTip() { const t = $("#sk-tip"); if (t) t.hidden = true; if (SK.svg) SK.svg.style.cursor = ""; }
function skHover(e) {
  const id = skHit(e.clientX, e.clientY, 12), tip = $("#sk-tip");
  if (id == null) { skHideTip(); return; }
  const L = SK.data.waters[id], t0 = todayStr(), n = skNext(L, t0), box = $("#sk-map").getBoundingClientRect();
  tip.textContent = L.name + " · " + (n ? evLabel(n) : L.months.length ? "monthly" : "done for the season");
  tip.style.left = (e.clientX - box.left) + "px"; tip.style.top = (e.clientY - box.top) + "px";
  tip.hidden = false; SK.svg.style.cursor = "pointer";
}
function openWater(id) {
  SK.sel = id;
  renderStockingTab();
  openSheet("water", { w: id });
}
function waterSheetMarkup(id) {
  const D = SK.data, L = D && D.waters[id];
  if (!L) return sheetTop("Stocking") + `<div class="sh-scroll"><p class="muted">That water isn't on the schedule.</p></div>`;
  const t0 = todayStr(), next = skNext(L, t0), mi = milesFromClub(L);
  const pills = L.types.map((t) => `<span class="sk-pill" style="background:${SK.tcol[t] || "#55655C"}">${esc(t)}</span>`).join("");
  let nextBox;
  if (next) nextBox = `<div class="sk-next"><span class="tm-cap">Next stocking</span><b>${esc(evLabel(next))}</b><span class="muted">${esc(whenText(next, t0))}${next[1] === "week" ? ". The truck comes within five days of that Sunday." : "."}</span></div>`;
  else if (L.months.length) nextBox = `<div class="sk-next"><span class="tm-cap">Stocked monthly</span><b>${esc(monthsText(L))}</b></div>`;
  else nextBox = `<div class="sk-next"><span class="tm-cap">Next stocking</span><b>None left this season</b></div>`;
  const byType = {};
  L.ev.forEach((e) => (byType[e[2]] = byType[e[2]] || []).push(e));
  const sched = L.types.map((t) => {
    const ev = byType[t] || [], mons = L.months.filter((m) => m[0] === t), tbd = L.tbd.filter((x) => x[0] === t);
    if (!ev.length && !mons.length && !tbd.length) return "";
    return `<section class="sh-sec"><h3>${esc(t)}${ev.length && ev[0][1] === "week" ? " · week of" : ""}</h3><div class="sk-dates">
      ${ev.map((e) => `<span class="${evEnd(e) < t0 ? "past" : e === next ? "nx" : ""}">${esc(fmtD(e[0], { month: "short", day: "numeric", year: e[0].slice(0, 4) !== t0.slice(0, 4) ? "numeric" : undefined }))}</span>`).join("")}
      ${mons.map((m) => m[1].map((x) => `<span>${MON[x - 1]}</span>`).join("")).join("")}
      ${tbd.map((x) => `<span>To be set: ${esc(x[1])}</span>`).join("")}
    </div></section>`;
  }).join("");
  const gm = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(L.name.replace(/ TW /, " Tailwater ") + ", " + L.county.split("/")[0] + " County, Tennessee");
  return sheetTop("Stocking") + `<div class="sh-scroll">
    <div style="display:grid;gap:12px">
      <div>${pills}</div>
      <h2 class="tv-title">${esc(L.name)}</h2>
      <p class="tv-when">${esc(L.county)} County · ${esc(D.regions[L.region] || "")}${mi != null ? ` · ${mi} miles from you` : ""}</p>
      ${nextBox}
      <dl class="facts"><div><dt>Species</dt><dd>${esc(L.species.join(", "))}</dd></div><div><dt>Region</dt><dd>${esc(D.agency)} Region ${esc(L.region)}</dd></div></dl>
      <div class="host-tools">
        <button class="btn primary small" type="button" data-act="sk-show" data-w="${L.id}">Show on the map</button>
        <a class="btn ghost small" href="${esc(planLink(`Should I fish ${L.water} this week? When is it stocked next, and what flies should I bring?`, "TN"))}" target="_blank" rel="noopener">Ask the trip planner</a>
        ${genButton(generationFor(L.name))}
        <a class="btn ghost small" href="${esc(gm)}" target="_blank" rel="noopener">Google Maps</a>
      </div>
    </div>
    ${sched}
    <p class="hint">Pin placement is approximate. Schedules change with weather and water levels, so <a href="${esc(D.source)}" target="_blank" rel="noopener">check ${esc(D.agency)}</a> before you drive.</p>
  </div>`;
}
// "Nearest" asks the browser where you are. The position stays on this device.
function skLocate() {
  if (!navigator.geolocation) { toast("This browser can't share your location."); return; }
  toast("Asking your browser for your location…");
  navigator.geolocation.getCurrentPosition((pos) => {
    SK.me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    SK.sort = "near"; SK.built = false;   // rebuild so the map marks where you are
    scheduleRender();
  }, () => toast("Couldn't get your location. Allow it in the browser, or keep sorting by soonest."), { timeout: 10000, maximumAge: 600000 });
}
async function skShow(id) {
  closeSheet();
  SK.state = "TN";
  for (let i = 0; i < 40 && !SK.built; i++) await sleep(100);
  if (!SK.built) return;
  SK.sel = id;
  renderStockingTab();
  const L = SK.data.waters[id], [px, py] = SK.proj(L.lon, L.lat);
  SK.pz.centerOn(px, py, Math.max(SK.pz.Z.k, SK.narrow ? 6 : 5));
  const el = $("#sk-map"), r = el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
}
