# Tasks

- [x] Research and cite Supabase/Postgres schema design decisions (`/study`)
- [x] Research Supabase → self-hosted migration path (`/study/03-...`)
- [x] Extract business requirements from the source spec PDF (`/study/04-...`)
- [x] Write initial planning doc with full column-level schema
- [x] Mermaid ERD of the schema
- [x] Mermaid diagram of create/read/update/delete operation flow through the API
- [ ] Write `supabase/migrations/0001_init.sql` implementing the schema (SQL,
      not yet applied to the live Supabase project)
- [ ] Wire `server.js` to Postgres (via `@supabase/supabase-js` or `pg`)
      instead of `db.json` — follow-up change, not this one
- [ ] Add `POST /api/messages`, `GET /api/messages`, `POST /api/orders`,
      `PATCH /api/orders/:id` endpoints — follow-up change
- [ ] Decide + implement port-3000 API auth (deferred per explicit user
      decision this session — revisit before any public/external exposure)
