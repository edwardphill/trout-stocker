/* ---------- the page ---------- */
// The trip planner lives on Fly AI (the Anglers Club site). Links pass the question as ?q= so the planner can pick it up
// once it reads that parameter; until then the link opens the planner.
const FLY_AI = (window.SITE && window.SITE.flyAi) || "https://angler-club.vercel.app";
const planLink = (q, st) => FLY_AI + "/plan?" + new URLSearchParams({ q, state: st });

// Reads one of this site's own endpoints. A failed read is tried once more; the error carries the status (503 means the
// database isn't connected yet, which the Georgia screen explains instead of calling it an error).
async function api(path) {
  const attempt = async () => {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 10000) : 0;
    try { return await fetch("/api/" + path, { signal: ctl ? ctl.signal : undefined }); }
    finally { clearTimeout(timer); }
  };
  let res = null;
  try { res = await attempt(); } catch (e) { /* tried again below */ }
  if (!res || (res.status >= 502 && res.status <= 504 && res.status !== 503)) {
    try { res = await attempt(); } catch (e) { const err = new Error("offline"); err.status = 0; throw err; }
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) { const err = new Error((data && data.error) || "error " + res.status); err.status = res.status; throw err; }
  return data;
}

let rq = 0;
function scheduleRender() {
  if (rq) return;
  rq = requestAnimationFrame(() => { rq = 0; renderStockingTab(); });
}

/* The switch between states also sets the address, so /tennessee and /georgia can be shared. */
function setState(st) {
  if (st === SK.state) return;
  SK.state = st; SK.sel = null; GA.sel = null;
  const path = st === "GA" ? "/georgia" : "/tennessee";
  if (location.pathname !== path) { try { history.replaceState(null, "", path); } catch (e) { /* a preview frame */ } }
  document.title = (st === "GA" ? "Georgia" : "Tennessee") + " trout stocking map";
  renderStockingTab();
}

/* ---------- sheet ---------- */
const dlg = () => $("#sheet");
let sheetNow = null;
function openSheet(mode, data = {}) {
  sheetNow = { mode, ...data };
  const body = $("#sheet-body");
  if (mode === "water") body.innerHTML = waterSheetMarkup(data.w);
  else if (mode === "gawater") body.innerHTML = gaSheetMarkup(data.w);
  else if (mode === "gaevent") body.innerHTML = gaEvSheetMarkup(data.i);
  if (!dlg().open) { try { dlg().showModal(); } catch (e) { dlg().setAttribute("open", ""); } }
  const sc = $(".sh-scroll", body); if (sc) sc.scrollTop = 0;
}
function closeSheet() {
  sheetNow = null;
  if (dlg().open) dlg().close();
}
function sheetTop(label) {
  return `<div class="sh-top"><span class="lab">${esc(label)}</span><button class="icon-btn" type="button" data-act="close" aria-label="Close">×</button></div>`;
}
dlg().addEventListener("close", () => { sheetNow = null; });
dlg().addEventListener("click", (e) => { if (e.target === dlg()) closeSheet(); });   // a tap on the shade closes it

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  const skw = e.target.closest("[data-skw]");
  if (skw) { openWater(+skw.dataset.skw); return; }
  const sksa = e.target.closest("[data-sksa]");
  if (sksa) { setState(sksa.dataset.sksa); return; }
  const gaw = e.target.closest("[data-gaw]");
  if (gaw) { gaOpen(+gaw.dataset.gaw); return; }
  const gag = e.target.closest("[data-gag]");
  if (gag) { const v = +gag.dataset.gag; if (GA.groups.has(v)) GA.groups.delete(v); else GA.groups.add(v); renderGA(); return; }
  if (e.target.closest("[data-gal]")) { GA.late = !GA.late; renderGA(); return; }
  const gak = e.target.closest("[data-gak]");
  if (gak) { const v = gak.dataset.gak; if (GA.kinds.has(v)) GA.kinds.delete(v); else GA.kinds.add(v); renderGA(); return; }
  const gae = e.target.closest("[data-gae]");
  if (gae) { gaOpenEv(+gae.dataset.gae); return; }
  const gas = e.target.closest("[data-gas]");
  if (gas) { GA.sort = gas.dataset.gas; renderGA(); return; }
  const skf = e.target.closest("[data-skr],[data-skt]");
  if (skf) {
    const set = skf.dataset.skr ? SK.regions : SK.types, v = skf.dataset.skr || skf.dataset.skt;
    if (set.has(v)) set.delete(v); else set.add(v);
    renderStockingTab(); return;
  }
  const sks = e.target.closest("[data-sks]");
  if (sks) {
    if (sks.dataset.sks === "near" && !homeLL()) { skLocate(); return; }
    SK.sort = sks.dataset.sks; renderStockingTab(); return;
  }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  switch (a.dataset.act) {
    case "close": closeSheet(); break;
    case "sk-zin": if (SK.pz) SK.pz.zoomStep(2); break;
    case "sk-zout": if (SK.pz) SK.pz.zoomStep(0.5); break;
    case "sk-all": if (!SK.pz) break; SK.sel = null; renderStockingTab(); skHome(true); break;
    case "sk-retry": ensureStocking().then((ok) => { if (ok) scheduleRender(); }); break;
    case "sk-show": await skShow(+a.dataset.w); break;
    case "ga-zin": if (GA.pz) GA.pz.zoomStep(2); break;
    case "ga-zout": if (GA.pz) GA.pz.zoomStep(0.5); break;
    case "ga-all": if (!GA.pz) break; GA.county = null; GA.sel = null; renderGA(); gaHome(true); break;
    case "ga-clear": GA.county = null; renderGA(); break;
    case "ga-retry": ensureGA().then((ok) => { if (ok) scheduleRender(); }); break;
    case "ga-evretry": GA.evErr = false; GA.ev = null; gaWantEvents(); renderGA(); break;
    case "ga-show": await gaShow(gaSubj(a.dataset)); break;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "sk-q") { SK.q = e.target.value; renderStockingTab(); }
  else if (e.target.id === "ga-q") { GA.q = e.target.value; renderGA(); }
  else if (e.target.id === "sk-when") { SK.when = e.target.value; renderStockingTab(); }
  else if (e.target.id === "ga-when") { GA.when = e.target.value; renderGA(); }
});
let rsz = 0;
window.addEventListener("resize", () => {
  clearTimeout(rsz);
  rsz = setTimeout(() => {
    if (SK.built && skState() === "TN") {
      if (($("#sk-map").clientWidth < 640) !== SK.narrow) { SK.built = false; renderStockingTab(); } else SK.pz.apply();
    }
    if (GA.built && skState() === "GA") {
      if (($("#ga-map").clientWidth < 640) !== GA.narrow) { GA.built = false; renderGA(); } else GA.pz.apply();
    }
  }, 120);
});

/* ---------- start ---------- */
const st0 = skState();
SK.state = null; setState(st0);
const crawl = $("#crawl"); if (crawl) crawl.remove();   // the crawlable copy, for readers that don't run scripts
