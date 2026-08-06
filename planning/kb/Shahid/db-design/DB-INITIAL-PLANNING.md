# RamoRepo DB — Initial Planning (Orders / Messages / Files on Supabase)

**Date:** 2026-08-06
**Owner:** Shahid
**Status:** planning — see `openspec/changes/build-order-file-messaging-db/`
for the spec-driven change tracking this
**Full sourcing:** every decision below is cited in
`db-api-app/order-file-api/study/` — this doc is the synthesis, not the source.

## 1. Problem

`order-file-api` (port 3000) currently mocks its backend with a single
`db.json` file (see its README — explicitly a stand-in for the real backend).
The business's own automation spec — `AI-Customer-Service-Automation-Workflow.pdf`
in this same folder — requires a real, concurrent-safe, queryable database
serving three domains: **Orders**, **Messages** (chat), and **Files**
(attachment metadata), consumed by multiple independent services (n8n
Automation Engine, AI Search Agent, AI File Agent, Human Review).

## 2. Decisions made this session

| Question | Decision | Why |
|---|---|---|
| Platforms | Platform-agnostic (`platform` text + `raw_payload` jsonb), starting with Shopee, more TBD | User confirmed "Shopee + others TBD"; spec PDF also names Lazada, WhatsApp, Email |
| File storage | NAS is final storage; DB stores metadata + `nas_path` only | User confirmed; matches spec PDF's "Local Network Storage" requirement exactly |
| API auth | None for now (internal network only) | User confirmed; RLS still enabled default-deny at the DB layer regardless — see study/02 |
| Messages scope | Customer support chat threads, optionally linked to an order | User confirmed; matches spec PDF's Chat Database section field-for-field |

## 3. Schema overview

Five tables. Full column list + types: see `erd.mmd` (rendered ERD) in this
folder. Summary:

- **`orders`** — one row per platform order. `UNIQUE (platform,
  external_order_id)` for webhook idempotency. `status` + `review_reason`
  drive the Human Review workflow described in the spec PDF.
- **`order_items`** — line items, FK to `orders`.
- **`messages`** — one row per inbound/outbound message, any channel.
  `order_id` nullable (a message can exist before it's matched to an order —
  explicit in the spec PDF's Step 3A).
- **`files`** — attachment metadata only, never blob bytes. `order_item_id`
  nullable until the AI File Agent confirms the match (mirrors the existing
  mock's `ATT_124` example).
- **`file_jobs`** — processing pipeline state (pending → completed /
  human_review / failed), matching the existing mock's job model exactly so
  the port-3000 API's contract doesn't need to change for callers that
  already integrate against it.

Every table has a `raw_payload jsonb` column (GIN-indexed, `jsonb_path_ops`)
holding the untouched platform payload for audit/debugging — see
`study/02-supabase-schema-design.md` for why this is bounded to an audit
column rather than becoming the primary schema.

## 4. Operations flow

See `operations-flow.mmd` in this folder. Summary of the CRUD shape:

- **Create**: platforms/channels push in via `POST /api/orders` and
  `POST /api/messages` — these are the only two entry points from the outside
  world (n8n never talks to Postgres directly).
- **Read**: Automation Engine, AI Search Agent, and Human Review UI all read
  through `GET /api/orders` / `GET /api/messages`.
- **Update**: order status/review_reason and file_job status change via
  `PATCH`, never a raw SQL update from another service — the API is the
  single write gate that keeps `raw_payload` audit trails consistent.
- **Delete**: **no hard deletes planned.** Orders/messages/files are
  append-and-update — a "cancelled" order is `status = 'cancelled'`, not a
  removed row. This preserves the "full traceability" requirement the spec
  PDF states explicitly as a goal. If storage growth becomes a concern later,
  archiving (not deleting) to cold storage is the documented escape hatch —
  not designed in detail here, flagged as a future decision.

## 5. Security posture (current, explicit)

- Port-3000 API: **no auth**, per explicit user decision — acceptable only
  because it's internal-network-only right now. **Flag for follow-up:** if
  this API is ever exposed beyond the internal network, this decision must be
  revisited (shared API key middleware already exists commented-out in
  `server.js`).
- Postgres/Supabase: RLS **enabled** (default-deny) on every table regardless
  of the API's own auth state, because Supabase exposes a public REST/GraphQL
  surface on every project by default — RLS is what keeps that surface closed
  even though the port-3000 API itself has none. The Node API uses the
  `service_role` key (bypasses RLS by design) server-side only, never shipped
  to a client.
- Credentials: `.env`, gitignored, never committed. See
  `study/05-secrets-handling.md` — includes a rotation recommendation for the
  personal access token pasted into this session's chat.

## 6. Migration path to self-hosted VPS Postgres (future goal)

Documented in full in `study/03-migration-to-self-hosted.md`, sourced from
Supabase's own "Restore a Platform Project to Self-Hosted" guide. Key
takeaway for schema design now: because files live on NAS (not Supabase
Storage), there's no blob-storage migration problem — `supabase db dump` +
`psql` restore covers the entire schema and data. The one gap to solve at
migration time (not now): `service_role`'s `BYPASSRLS` behavior is
Supabase-provisioned and needs an equivalent grant on self-hosted Postgres.

## 7. What's NOT built yet (explicitly out of scope this round)

- `supabase/migrations/0001_init.sql` — the actual DDL. Planned as the next
  concrete step once this plan is reviewed.
- `server.js` rewritten to talk to Postgres instead of `db.json`.
- New endpoints (`POST /api/messages`, `POST /api/orders`, `PATCH
  /api/orders/:id`) — contract sketched in `openspec/changes/
  build-order-file-messaging-db/design.md`, not implemented.
- Auth on the port-3000 API.

## 8. References

- `db-api-app/order-file-api/study/` — full cited research (Supabase docs,
  PostgreSQL docs, OpenSpec docs, migration guide)
- `db-api-app/order-file-api/openspec/changes/build-order-file-messaging-db/`
  — spec-driven proposal/design/tasks/specs for this change
- `AI-Customer-Service-Automation-Workflow.pdf` / `.jpg` (this folder) — the
  business's own source requirement doc
- `erd.mmd`, `operations-flow.mmd` (this folder) — Mermaid diagrams
