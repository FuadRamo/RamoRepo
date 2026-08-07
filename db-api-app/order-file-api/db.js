/**
 * Postgres access via Supabase's PostgREST API, using the service_role key.
 *
 * This is the officially recommended server-side pattern -
 * https://supabase.com/docs/guides/database/postgres/row-level-security :
 * "service_role keys... bypass RLS... keep them server-side only." That's
 * exactly this process (never sent to a client). Project-scoped (unlike the
 * account-wide personal access token used to fetch this key once via the
 * Management API - see study/02-supabase-schema-design.md and
 * study/05-secrets-handling.md), and not subject to the Management API's
 * 60 req/min limit, so it's fit for real request traffic unlike the earlier
 * db.js version.
 *
 * PostgREST reference: https://docs.postgrest.org/en/v13/references/api.html
 * - filters as query params: `column=eq.value`
 * - resource embedding for FK relationships: `select=*,order_items(*)`
 * - `Prefer: return=representation` to get inserted/updated rows back
 */

const REST_URL = `${process.env.SUPABASE_PROJECT_URL}/rest/v1`;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function request(method, table, { query = "", body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;

  const resp = await fetch(`${REST_URL}/${table}${query}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  const data = text ? JSON.parse(text) : null;

  if (!resp.ok) {
    const err = new Error((data && data.message) || `PostgREST ${method} ${table} failed`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }
  return data;
}

const select = (table, query = "") => request("GET", table, { query });

const insert = (table, rows, { select: sel = "*" } = {}) =>
  request("POST", table, {
    query: `?select=${sel}`,
    body: rows,
    prefer: "return=representation",
  });

const update = (table, filterQuery, patch, { select: sel = "*" } = {}) =>
  request("PATCH", table, {
    query: `${filterQuery}&select=${sel}`,
    body: patch,
    prefer: "return=representation",
  });

const del = (table, filterQuery) =>
  request("DELETE", table, { query: filterQuery, prefer: "return=representation" });

module.exports = { select, insert, update, del };
