// GET /api/health: confirms the database is connected and the tables exist. The daily schedule calls it so a free
// Supabase project doesn't pause for lack of traffic.
import { route } from "../lib/http.js";
import { q, ensureSchema } from "../lib/db.js";

export default route(["GET"], async () => {
  await ensureSchema();
  const [r] = await q("select count(*)::int as stockings from ga_stockings");
  return { ok: true, gaStockings: r.stockings };
});
