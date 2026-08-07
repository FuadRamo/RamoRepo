# Supabase → self-hosted VPS Postgres migration path

**Source:** https://supabase.com/docs/guides/self-hosting/restore-from-platform

This is the documented, official procedure — recorded now so the schema is
designed to not fight it later (e.g. avoiding Supabase-proprietary features
that don't survive the export).

## Official steps

1. Get the platform project's connection string (Dashboard → Connect).
2. Dump three separate files via the Supabase CLI (not raw `pg_dump` — that
   pulls in Supabase-internal schemas and causes permission errors on restore):
   ```bash
   supabase db dump --db-url "<CONNECTION_STRING>" -f roles.sql --role-only
   supabase db dump --db-url "<CONNECTION_STRING>" -f schema.sql
   supabase db dump --db-url "<CONNECTION_STRING>" -f data.sql --use-copy --data-only
   ```
3. On the self-hosted target: enable any non-default Postgres extensions the
   project uses first (`select * from pg_extension` on the source to check).
4. Restore in order with `psql`:
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "<self-hosted-connection-string>"
   ```
5. Verify: tables, row counts, extensions present.

## What does NOT come along automatically

JWT secrets, OAuth config, Edge Functions, Storage *objects* (bucket file
bytes), SMTP settings, DNS — all need manual re-setup on the self-hosted side.

## What this means for schema design now

- **Storage objects don't matter here** — per this project's own design
  decision (files live on NAS, DB only stores metadata/paths), there's nothing
  in Supabase Storage to lose on migration. This was the right call
  independent of migration concerns, but it also removes an entire migration
  headache.
- **Avoid Supabase-specific SQL functions/extensions** in application logic
  where a plain Postgres equivalent exists (e.g. `gen_random_uuid()` from
  `pgcrypto`/core `pgcrypto` extension, not a Supabase-only helper) — this is
  already how the schema in this project is written.
- **RLS policies are plain Postgres RLS**, not a Supabase abstraction — they
  migrate with `schema.sql` as-is, no rewrite needed.
- **`service_role` bypass-RLS behavior is Supabase-specific** (it's a Postgres
  role Supabase provisions with `BYPASSRLS`). On self-hosted Postgres, the
  Node API's DB user will need `BYPASSRLS` granted explicitly, or real RLS
  policies written for it — noted as a migration-time task, not solved now.
