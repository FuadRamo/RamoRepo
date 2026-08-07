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
- [x] Wire `server.js` to Postgres — done via `db.js`, a **temporary**
      Management-API-based bridge (no service_role key or connection string
      was available). Rate-limited to 60 req/min and uses an
      account-level credential — replace with `pg`/`supabase-js` +
      service_role before real traffic. See db.js header comment.
- [x] Add `POST /api/messages`, `GET /api/messages`, `POST /api/orders`,
      `GET /api/orders/:id`, `PATCH /api/orders/:id`,
      `POST /api/webhooks/whatsapp` (text/image/document, see
      study/07-whatsapp-webhook-format.md) — implemented and tested live
      against the Supabase project (2026-08-06/07)
- [ ] Removed in this pass, not yet re-added: `POST /api/simulate/fire-webhook`
      (was tightly coupled to db.json's shape) — flag if still needed
- [ ] Get a service_role key or direct Postgres connection string from the
      user and swap db.js for a real driver (blocks: production scale, and
      removes the account-level-credential risk noted above)
- [ ] Decide + implement port-3000 API auth (deferred per explicit user
      decision this session — revisit before any public/external exposure;
      now more urgent since the API is live-writing to production data)
