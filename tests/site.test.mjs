// The built page: both states are there, nothing from the club site (trips, names, clubs) came along, the inlined scripts
// parse, and the search files point at the site. No database needed. Usage: npm run build && node tests/site.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
let n = 0; const ok = (label) => { n++; console.log("ok", n, label); };

const app = read("public/index.html");
assert.ok(!/<!--[A-Z_]+-->|\/\*[A-Z_]+\*\//.test(app), "every placeholder was filled");
for (const id of ["sk-map", "sk-list", "sk-q", "sk-when", "ga-map", "ga-evlist", "ga-list", "sheet", "toast"]) assert.ok(app.includes(`id="${id}"`), id);
assert.ok(app.includes('data-sksa="TN"') && app.includes('data-sksa="GA"'), "the state switch");
ok("the page has both states, the switch and the sheet");

const js = [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
js.forEach((code) => new vm.Script(code));
const main = js.find((c) => c.includes("function renderStockingTab"));
for (const word of ["S.clubId", "S.readOnly", "S.tab", "club()", "goTab(", "tpPlace(", "openName(", "skPostTrip", "gaPostTrip"]) assert.ok(!main.includes(word), "nothing left from the club site: " + word);
ok("the inlined scripts parse, and nothing from the club site came along");

// Every function the scripts call is defined somewhere in them (a missing helper would only show up in the browser).
const defined = new Set([...main.matchAll(/function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1] || m[2]));
const builtins = new Set(["if", "for", "while", "switch", "catch", "return", "function", "fetch", "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "encodeURIComponent", "String", "Number", "Math", "Date", "Set", "Map", "Object", "Promise", "Error", "Boolean", "JSON", "Intl", "URLSearchParams", "AbortController", "isNaN", "parseInt", "parseFloat", "Array", "RegExp", "typeof", "new", "await", "async", "res", "rej", "step", "attempt", "line", "end", "mid", "clamp", "toView", "stall", "sleep", "translate", "scale"]);
// Comments and plain strings hold prose like "TVA (the dam operator)", so they are left out of the search.
const code = main.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
const called = new Set([...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
const missing = [...called].filter((f) => !defined.has(f) && !builtins.has(f));
assert.deepEqual(missing, [], "called but never defined");
ok("every function the page calls is defined");

const tn = read("public/stocking-tn.js"), D = JSON.parse(read("data/stocking-tn.json"));
assert.deepEqual(JSON.parse(tn.slice(tn.indexOf("window.STOCKING = ") + 18).replace(/;\s*$/, "")), D, "public/stocking-tn.js matches the data");
assert.ok(D.waters.length > 50 && D.waters.every((w) => w.lat > 34.8 && w.lat < 36.8 && w.lon > -90.4 && w.lon < -81.5), "every Tennessee water is on the map");
ok(`the Tennessee schedule (${D.waters.length} waters) is built from the data and every pin sits inside the state`);

assert.ok(/<link rel="canonical" href="https?:\/\/[^"]+\/">/.test(app) && app.includes('"@type":"Dataset"'));
assert.ok(app.includes('id="crawl"') && app.includes(D.waters[0].name.replace(/&/g, "&amp;")), "a crawlable list of the waters");
assert.ok(read("public/sitemap.xml").includes("/georgia") && read("public/robots.txt").includes("Sitemap:"));
const vj = JSON.parse(read("vercel.json"));
assert.ok(vj.rewrites.some((r) => r.source === "/georgia") && vj.crons.some((c) => c.path === "/api/stocking?refresh=1"));
ok("search metadata, sitemap, the /tennessee and /georgia addresses and the daily read are set up");
console.log(`\nAll ${n} checks passed.`);
