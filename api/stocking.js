// GET /api/stocking?state=GA: every stocking Georgia's weekly report has listed so far (day, county, water as printed, the
//      frequency-sheet water it matched, Delayed Harvest or not) and when the report was last read. Public.
// GET /api/stocking?refresh=1: reads this week's report. Vercel's daily schedule does this; so can the site owner with
//      &key=<ADMIN_KEY> (add &force=1 to skip the three-hour pause). Anyone else gets a 403, so a visitor can never start a
//      model call. Tennessee needs no server: its schedule comes with the page.
import { timingSafeEqual } from "node:crypto";
import { route, HttpError } from "../lib/http.js";
import { ensureSchema } from "../lib/db.js";
import { readEvents, refresh } from "../lib/gastock.js";

function fromSchedule(req) {
  const h = req.headers || {};
  if (process.env.CRON_SECRET) return String(h.authorization || "") === `Bearer ${process.env.CRON_SECRET}`;
  return /^vercel-cron\//i.test(String(h["user-agent"] || ""));
}
// The owner's key, compared in constant time. With no ADMIN_KEY set, nobody is the owner.
function isOwner(given) {
  const want = process.env.ADMIN_KEY || "";
  if (want.length < 12 || !given) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default route(["GET"], async (req) => {
  await ensureSchema();
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("refresh")) {
    const owner = isOwner(u.searchParams.get("key"));
    if (!owner && !fromSchedule(req)) throw new HttpError(403, "Only the site owner or the daily schedule can read the stocking report.");
    return refresh({ force: owner && u.searchParams.get("force") === "1" });
  }
  if (String(u.searchParams.get("state") || "GA").toUpperCase() !== "GA") throw new HttpError(404, "Dated stockings are only collected for Georgia; Tennessee's schedule comes with the page.");
  return readEvents();
});
