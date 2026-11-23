# Trout Stocking Map

Every stocked trout water in Tennessee and Georgia on one map. It is open to everyone, with no sign-in. It was split out of the Stocking tab of the Anglers Club / Fly AI site ([edwardphill/anglers-club](https://github.com/edwardphill/anglers-club)), with the club parts (posting trips, names, clubs) taken out.

- **Tennessee** (`/tennessee`, the home page): TWRA's trout stocking schedule on a map of the state. You can filter by window (next 7 days, next 30 days, anything coming up, or the whole season), region and water type, and sort by the next stocking or by distance. "Nearest" asks the browser for your location, which stays on your device. Tap a water to see its dates, its dam's generation schedule where there is one, Google Maps, and a link to Fly AI's trip planner. The schedule is `data/stocking-tn.json`, so this part works with no server.
- **Georgia** (`/georgia`): Georgia has two sources, and the page keeps them apart.
  - The weekly stocking report lists stockings after they happen. `lib/gastock.js` reads it once a day: Claude transcribes the PDF's table, then plain code checks every row. Each stocking is saved in Postgres exactly as printed. The history starts the day the first read runs, because the state replaces the PDF each week.
  - The 2026 frequency sheet (`data/stocking-ga.json`) gives no dates, only how often each of 86 waters is stocked.
  - The map marks counties, not waters, because the state gives counties and not coordinates.
  - Until a database is connected, the frequency sheet still shows, and the page says that dated stockings will appear once the daily read is on.

## How it's built

- `src/page.html` is the page template. `scripts/build.mjs` inlines `src/style.css`, `src/markup.html`, `src/tennessee.js` (shared helpers, the pan-and-zoom map, and the Tennessee screen), `src/georgia.js` and `src/main.js` (the state switch, the detail sheet and the events). The result is `public/index.html`. The build also writes `public/stocking-tn.js` and `public/stocking-ga.js` (the schedules, loaded when a state is first shown), `sitemap.xml` and `robots.txt`.
- The build adds the description, canonical link, Open Graph tags and JSON-LD (`WebSite` plus a `Dataset` for each state), and a plain list of every water for crawlers that don't run JavaScript. The page removes that list once it draws.
- `api/stocking.js`:
  - `GET /api/stocking?state=GA` returns the saved Georgia stockings. It is public.
  - `GET /api/stocking?refresh=1` reads this week's report. Only the daily Vercel cron or the owner's key (`&key=<ADMIN_KEY>`) can start a read, and only the owner can add `&force=1` to skip the three-hour pause.
- `api/health.js` checks the database. The daily cron also calls it so a free Supabase project doesn't pause.
- `lib/db.js` handles Postgres through postgres.js, using Supabase's pooled connection. The two tables (`ga_stockings`, `ga_stocking_runs`) are created on the first request. Row-level security is on, so Supabase's public API can't reach them.

Updating the data: when TWRA posts a new season, replace `data/stocking-tn.json`. When Georgia WRD posts a new frequency sheet, replace `data/stocking-ga.json`. Then run `npm run build`. Dam generation links are in `data/generation.json`.

## Deploy on Vercel

1. Import this repo in Vercel. `vercel.json` sets the build (`npm run build`), the output directory (`public`), the `/tennessee` and `/georgia` addresses, and the two daily crons.
2. Tennessee works as soon as it deploys. For Georgia's dated stockings, connect a database. In the project, open Storage and add Supabase, which sets `POSTGRES_URL`. Or paste an existing Supabase project's transaction pooler string as `POSTGRES_URL`. It can be the Anglers Club's database: these tables are named `ga_*`, and the club site uses the same ones, so both would show the same history.
3. Add `ANTHROPIC_API_KEY` (from the Claude Console) for the daily read of the PDF. `STOCKING_MODEL` optionally overrides the model (default `claude-sonnet-5-5`).
4. Optional environment variables:
   - `ADMIN_KEY` (12 or more characters) lets you force a read: `/api/stocking?refresh=1&force=1&key=...`.
   - `CRON_SECRET` makes the cron prove itself with a secret instead of its user agent.
   - `SITE_URL` sets canonical links and the sitemap once there is a custom domain.
   - `FLY_AI_URL` sets where the trip planner links go (default `https://angler-club.vercel.app`).
5. Redeploy, then open `/api/health`. It should return `{"ok":true,"gaStockings":0}`. That number grows after the first daily read.

## Tests

```bash
npm test                                   # builds, then checks the data and the page (no database needed)
PGTEST="-h localhost -p 5432 -U postgres -d stock_test" npm test   # also runs the Georgia reader against a local Postgres
```
