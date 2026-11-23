// Builds public/: index.html from src/ (styles, markup and scripts inlined, with the search metadata and a crawlable list
// of every water), plus the two schedules the page loads when a state is first shown.
// Run with `npm run build`; Vercel runs it on every deploy.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Where the site lives (canonical link, sitemap, JSON-LD) and where Fly AI lives (trip planner links).
const SITE = (process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL : "https://trout-stocking.vercel.app")).replace(/\/+$/, "");
const FLY_AI = (process.env.FLY_AI_URL || "https://angler-club.vercel.app").replace(/\/+$/, "");

const TN = JSON.parse(read("data/stocking-tn.json"));
const GA = JSON.parse(read("data/stocking-ga.json"));
const TITLE = "Trout Stocking Map: Tennessee and Georgia trout stocking schedules";
const DESC = `Every stocked trout water in Tennessee and Georgia on one map: TWRA's ${TN.season} stocking dates for ${TN.waters.length} waters, and Georgia's weekly stocking report and stocking frequencies for ${GA.waters.length} waters.`;

const ld = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": SITE + "/#site", url: SITE + "/", name: "Trout Stocking Map", description: DESC },
    { "@type": "Dataset", name: `Tennessee trout stocking schedule ${TN.season}`, description: `TWRA's trout stocking dates for ${TN.waters.length} Tennessee waters, placed on a map.`, url: SITE + "/tennessee", isBasedOn: TN.source, spatialCoverage: "Tennessee", isAccessibleForFree: true },
    { "@type": "Dataset", name: `Georgia trout stockings ${GA.season}`, description: `Georgia WRD's weekly trout stocking report and how often each of ${GA.waters.length} waters is stocked.`, url: SITE + "/georgia", isBasedOn: [GA.source, GA.weekly], spatialCoverage: "Georgia", isAccessibleForFree: true },
  ],
};
const head = [
  `<meta name="description" content="${esc(DESC)}">`,
  `<link rel="canonical" href="${SITE}/">`,
  `<meta property="og:type" content="website">`,
  `<meta property="og:title" content="${esc(TITLE)}">`,
  `<meta property="og:description" content="${esc(DESC)}">`,
  `<meta property="og:url" content="${SITE}/">`,
  `<meta name="twitter:card" content="summary">`,
  `<meta name="theme-color" content="#F6F8F6">`,
  `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
].join("\n");

// A plain list of every water for search engines and AI tools that don't run scripts; the page removes it once it draws.
const t0 = new Date().toISOString().slice(0, 10);
const tnRows = TN.waters.map((w) => {
  const next = (w.ev || []).map((e) => e[0]).filter((d) => d >= t0).sort()[0];
  return `<li>${esc(w.name)}, ${esc(w.county)} County: ${esc(w.types.join(", "))}${next ? `; next stocking ${next}` : ""}</li>`;
}).join("");
const gaRows = GA.waters.map((w) => `<li>${esc(w.name)}, ${esc(w.county)} County: ${esc(GA.groups[w.group - 1].text)}</li>`).join("");
const crawl = `<section id="crawl"><h2>Tennessee trout stocking schedule (${esc(TN.agency)}, ${esc(TN.season)})</h2><ul>${tnRows}</ul>
<h2>Georgia trout stocking frequencies (${esc(GA.agency)}, ${esc(GA.season)})</h2><ul>${gaRows}</ul></section>`;

let page = read("src/page.html");
// split/join rather than replace, so a "$" in the inlined code is never read as a replacement pattern.
const put = (mark, text) => { if (!page.includes(mark)) throw new Error("missing " + mark); page = page.split(mark).join(text); };
put("<!--SEO_HEAD-->", head);
put("/*STYLE*/", read("src/style.css").trimEnd());
put("<!--MARKUP-->", read("src/markup.html").trimEnd());
put("<!--CRAWL-->", crawl);
put("/*FLY_AI*/", FLY_AI);
put("/*SITE*/", JSON.stringify({ url: SITE, flyAi: FLY_AI }));
put("/*GENERATION*/", JSON.stringify(JSON.parse(read("data/generation.json"))));
put("/*TENNESSEE*/", read("src/tennessee.js").trimEnd());
put("/*GEORGIA*/", read("src/georgia.js").trimEnd());
put("/*MAIN*/", read("src/main.js").trimEnd());

mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/index.html"), page);
writeFileSync(join(root, "public/stocking-tn.js"),
  "// Tennessee trout stocking schedule (TWRA). Generated from data/stocking-tn.json by npm run build.\n" +
  "window.STOCKING = " + JSON.stringify(TN) + ";\n");
writeFileSync(join(root, "public/stocking-ga.js"),
  "// Georgia trout stocking frequencies (Georgia WRD). Generated from data/stocking-ga.json by npm run build.\n" +
  "window.STOCKING_GA = " + JSON.stringify(GA) + ";\n");
writeFileSync(join(root, "public/robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(root, "public/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${["/", "/tennessee", "/georgia"].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${t0}</lastmod></url>`).join("\n")}
</urlset>
`);
console.log(`Built public/ for ${SITE}: ${TN.waters.length} Tennessee waters, ${GA.waters.length} Georgia waters.`);
