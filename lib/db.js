// Postgres access through postgres.js. In production this is Supabase: connecting Supabase
// to the project under Vercel Storage sets POSTGRES_URL, its pooled (transaction mode)
// connection, which suits serverless functions. Any other Postgres works through
// POSTGRES_URL or DATABASE_URL. Tests swap in a local Postgres through globalThis.__nacQuery.
// This site can share the Anglers Club's Supabase database (its tables are named ga_*) or use its own.
import { HttpError } from "./http.js";

let sqlPromise = null;

async function getSql() {
  const raw = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!raw && !globalThis.__nacSqlFactory) {
    throw new HttpError(503, "The database isn't connected yet. In Vercel, add Supabase under Storage (or set POSTGRES_URL), then redeploy.");
  }
  if (!sqlPromise) {
    sqlPromise = (globalThis.__nacSqlFactory ? Promise.resolve(globalThis.__nacSqlFactory()) : import("postgres").then(({ default: postgres }) => {
      // Provider URLs can carry extra query settings (sslmode, pooler hints) that postgres.js
      // would pass to the server as startup parameters; TLS is set explicitly instead.
      const url = new URL(raw);
      const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key);
      return postgres(url.toString(), {
        ssl: local ? false : "require",
        prepare: false, // required by Supabase's transaction-mode pooler
        max: 1,
        idle_timeout: 20,
        connect_timeout: 5,
      });
    }));
    sqlPromise.catch(() => { sqlPromise = null; });
  }
  return sqlPromise;
}

// A serverless instance can sit frozen between requests while the database (or its pooler)
// closes the idle connection; the next query then waits on a dead socket until Vercel cuts the
// whole request off with a 504. Every statement gets a short limit instead. When one stalls, the
// connection is thrown away; reads are tried once more on a fresh connection, writes are not
// (the first try may have gone through).
const QUERY_MS = () => globalThis.__nacQueryMs || 4000;

function dropSql() {
  const old = sqlPromise;
  sqlPromise = null;
  if (old) old.then((sql) => sql.end({ timeout: 0 })).catch(() => {});
}

function stalled(sql, text, params) {
  let timer;
  const stall = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("database stalled"), { stalled: true })), QUERY_MS());
  });
  const run = sql.unsafe(text, params);
  run.catch(() => {}); // a late failure after the limit has passed is not news
  return Promise.race([run, stall]).finally(() => clearTimeout(timer));
}

// Closes the current connection so the next statement opens a new one (tests use this between cases).
export function resetConnection() {
  dropSql();
}

// Errors that mean the connection itself is unusable (as opposed to a bad statement).
const DEAD = new Set(["CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]);

// Runs one parameterized statement ($1, $2, ...) and returns its rows.
export async function q(text, params = []) {
  if (globalThis.__nacQuery) return globalThis.__nacQuery(text, params);
  const read = /^\s*select\b/i.test(text);
  for (let attempt = 0; ; attempt++) {
    const sql = await getSql();
    try {
      return await stalled(sql, text, params);
    } catch (e) {
      if (!(e && (e.stalled || DEAD.has(e.code)))) throw e;
      dropSql();
      if (read && attempt === 0) continue;
      throw new HttpError(503, "The database is slow to answer right now. Try again in a moment.");
    }
  }
}

// Timestamps are stored as epoch milliseconds in double precision columns so every driver hands them back as plain numbers.
export const SCHEMA = [
  // Georgia's weekly trout stocking report, read once a day: one row per stocking as the state printed it, and one row
  // saying when the report was last read. Public data; nothing in it belongs to a person.
  `create table if not exists ga_stockings (
    day text not null,
    county text not null,
    water text not null,
    week_from text not null default '',
    week_to text not null default '',
    seen double precision not null,
    primary key (day, county, water)
  )`,
  `create table if not exists ga_stocking_runs (
    id int primary key,
    at double precision not null default 0,
    ok boolean not null default false,
    ok_at double precision,
    week text not null default '',
    rows int not null default 0,
    skipped int not null default 0,
    error text not null default ''
  )`,
  // Row-level security on, with no policies: Supabase's public data API can't reach these tables; only this site's server can.
  `alter table ga_stockings enable row level security`,
  // Last, so the check in ensureSchema covers everything above.
  `alter table ga_stocking_runs enable row level security`,
];

let ready = null;

// Creates the tables on first use, once per server instance.
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const r = await q(
        `select coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.ga_stocking_runs')), false) as ok`,
      );
      if (r[0] && r[0].ok) return;
      for (const stmt of SCHEMA) await q(stmt);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
