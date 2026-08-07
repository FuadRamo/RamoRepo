/**
 * TEMPORARY DB bridge.
 *
 * We only have a Supabase *personal access token* (account-level Management
 * API credential) and a *publishable* (anon) key for this project - no
 * service_role key and no direct Postgres connection string were provided.
 * RLS is enabled default-deny on every table (see study/02), so the anon
 * key can't do anything useful, and there's no pg connection to use `pg`
 * with directly.
 *
 * The Management API's "run a query" endpoint
 * (POST /v1/projects/:ref/database/query, verified against
 * https://supabase.com/docs/reference/api/v1-run-a-query, parameterized
 * queries confirmed working with standard Postgres $1-style placeholders)
 * is the only thing we can authenticate to right now, so it's used here as
 * a stand-in Postgres driver.
 *
 * THIS IS NOT A PRODUCTION-APPROPRIATE PATTERN:
 *   - It's rate-limited to 60 requests/min per the Management API docs -
 *     nowhere near enough for real API traffic.
 *   - The access token it uses can manage/delete every project in the
 *     Supabase account, not just this database - a much bigger blast radius
 *     than a scoped DB credential if it ever leaked from this service.
 * Replace this with `pg` + a direct connection string, or
 * `@supabase/supabase-js` + the service_role key, before any real traffic.
 * See study/02-supabase-schema-design.md.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_URL.match(
  /https:\/\/([a-z0-9]+)\.supabase\.co/
)[1];
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const QUERY_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function query(sql, parameters = [], { readOnly = false } = {}) {
  const resp = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql, parameters, read_only: readOnly }),
  });

  const body = await resp.json();
  if (!resp.ok) {
    const err = new Error(body.message || "database query failed");
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

module.exports = { query };
