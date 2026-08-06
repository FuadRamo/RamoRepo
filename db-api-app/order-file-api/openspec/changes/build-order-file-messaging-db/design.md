# Design: Production Supabase DB for orders, messages, files

Full rationale with citations lives in `/study` — this file is the technical
approach summary, not a duplicate of the sourcing.

## Tables

```
orders        — one row per platform order (Shopee, Lazada, ...)
order_items   — line items within an order (product, sku, variation, qty)
messages      — customer conversation messages across channels, optionally
                linked to an order once matched (nullable order_id)
files         — attachment metadata; actual bytes live on NAS, not in Postgres
file_jobs     — processing pipeline state for a file (download → rename →
                organize → done), matches the existing mock's job model
```

See `../../../planning/kb/Shahid/db-design/DB-INITIAL-PLANNING.md` for the
full column-level design and the ERD.

## Key technical decisions (see study/ for citations)

1. UUID primary keys everywhere (Supabase docs: common pattern; project-specific
   reason: IDs need to exist before Postgres insert in some flows).
2. `raw_payload jsonb` on every table, GIN-indexed with `jsonb_path_ops`
   (Postgres docs: smaller/faster index for containment-only queries).
3. `platform`/`status`/`review_reason` are `text + CHECK`, not Postgres
   `enum` — avoids `ALTER TYPE` migrations as new platforms/statuses appear.
4. RLS enabled (default-deny) on every table; the Node API uses the
   `service_role` key server-side, which bypasses RLS by design — public
   Supabase REST/GraphQL surface stays closed regardless of the port-3000
   API's own (currently absent) auth.
5. Files table never stores blob bytes — `nas_path` is the source of truth,
   matching the existing mock's `nas_path` field and the business spec's
   "Local Network Storage" requirement.

## API surface (port 3000, unchanged contract where the mock already works)

Existing mock endpoints stay, backed by Postgres instead of `db.json`:
- `GET /api/attachments/:attachment_id/download`
- `PATCH /api/file-jobs/:job_id`
- `POST /api/simulate/fire-webhook`
- `GET /api/orders`, `/api/attachments`, `/api/file-jobs`, `/api/file-jobs/:job_id`

New endpoints needed for the Chat Database requirement (not in the mock today):
- `POST /api/messages` — n8n/Chat Integration pushes a synced message in
- `GET /api/messages?order_id=&platform=&conversation_id=`
- `PATCH /api/orders/:order_id` — status/review_reason updates
- `POST /api/orders` — new order ingestion (the workflow trigger point per spec)

## Out of scope for this change

Actual endpoint implementation — this change is the schema + migration file
(`supabase/migrations/`) and planning artifacts. Wiring `server.js` to
Postgres instead of `db.json` is a follow-up change.
