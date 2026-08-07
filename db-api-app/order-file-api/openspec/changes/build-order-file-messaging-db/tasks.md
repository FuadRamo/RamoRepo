# Tasks

- [x] Research and cite Supabase/Postgres schema design decisions (`/study`)
- [x] Research Supabase → self-hosted migration path (`/study/03-...`)
- [x] Extract business requirements from the source spec PDF (`/study/04-...`)
- [x] Write initial planning doc with full column-level schema
- [x] Mermaid ERD of the schema
- [x] Mermaid diagram of create/read/update/delete operation flow through the API
- [x] Extend schema for full Customer Service Workflow (support_cases,
      invoices, order_status_events, print_jobs) — second spec pasted
      2026-08-06, see study/06-customer-service-workflow-expansion.md
- [ ] Open the referenced Google Drive "Task" folder once accessible and
      check for additional requirements not yet reflected here
- [x] Write `supabase/migrations/20260806140000_init_schema.sql` implementing
      the full schema
- [x] Apply the migration to the live Supabase project (2026-08-06, via the
      Management API `database/query` endpoint — see db.js header)
- [x] Seed the live DB with the existing mock's example order/items/files
- [x] Wire `server.js` to Postgres — done via `db.js`, using PostgREST +
      the `service_role` key (fetched once via the Management API
      `GET /v1/projects/:ref/api-keys?reveal=true` endpoint, then used
      directly — not stored/used anywhere except this gitignored `.env`).
      Superseded an earlier version that used the Management API
      `database/query` endpoint directly (account-wide credential,
      60 req/min limit) — this is the correct server-side pattern per
      Supabase's own RLS docs (service_role bypasses RLS, kept
      server-side-only). See db.js header comment.
- [x] Add `POST /api/messages`, `GET /api/messages`, `POST /api/orders`,
      `GET /api/orders/:id`, `PATCH /api/orders/:id`,
      `POST /api/webhooks/whatsapp` (text/image/document, see
      study/07-whatsapp-webhook-format.md) — implemented and tested live
      against the Supabase project (2026-08-06/07), retested after the
      PostgREST rewrite
- [ ] Removed in this pass, not yet re-added: `POST /api/simulate/fire-webhook`
      (was tightly coupled to db.json's shape) — flag if still needed
- [ ] The raw Postgres connection string/password is still not available
      (not retrievable via the Management API — Supabase never exposes it
      after creation; resetting it would be disruptive and wasn't done
      without asking). Only matters if something needs a direct `pg`
      connection instead of PostgREST — not currently blocking anything.
- [ ] Decide + implement port-3000 API auth (deferred per explicit user
      decision this session — revisit before any public/external exposure;
      now more urgent since the API is live-writing to production data)
