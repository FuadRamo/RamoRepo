# Supabase / PostgreSQL schema design — sourced decisions

## Primary keys

**Source:** https://supabase.com/docs/guides/database/tables
> "It's common to use a `uuid` type or a numbered `identity` column as your primary key."

**Decision:** `uuid primary key default gen_random_uuid()` for `orders`, `messages`,
`files`. Reason not cited-elsewhere but load-bearing for this project specifically:
order/message/file IDs get referenced across services (n8n, AI agents, the NAS
path naming scheme) before they're ever inserted into Postgres in some flows —
UUIDs can be generated client-side/idempotently, sequential identity columns
can't. `order_items` also uses uuid for consistency, FK'd to `orders.id`.

## JSONB vs normalized columns

**Source:** https://supabase.com/docs/guides/database/json
> "Don't go overboard with json/jsonb columns... most of the benefits of a
> relational database come from the ability to query and join structured data."
> Recommended for "data that is unstructured or has a variable schema" — example
> given: storing webhook responses with unpredictable formats.

**Decision:** Every table gets one `raw_payload jsonb` column holding the
untouched platform webhook/API payload (Shopee order webhook, WhatsApp message
webhook, etc.) for audit/debugging. Everything the application logic actually
queries or joins on (order status, customer phone, message sender, file status)
is a real typed column, not buried in JSON. This follows the doc's caution
directly: JSONB is the escape hatch for "whatever the platform sent," not the
primary schema.

## JSONB indexing

**Source:** https://www.postgresql.org/docs/current/datatype-json.html
- `jsonb` preferred over `json` for anything queried: "most applications should
  prefer to store JSON data as jsonb... faster processing, with indexing support."
- Two GIN operator classes: default `jsonb_ops` (supports `?`, `?|`, `?&`, `@>`)
  vs `jsonb_path_ops` (`@>` only, smaller/faster index).

**Decision:** `raw_payload` gets a GIN index with `jsonb_path_ops` — this
project only ever needs containment queries against it (e.g. "find the order
whose raw payload contains this Shopee order SN"), never key-existence checks,
so the smaller/faster operator class is the correct one per the doc's own
guidance, not a default left unexamined.

## Row Level Security

**Source:** https://supabase.com/docs/guides/database/postgres/row-level-security
**Source:** https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
> "Any table without RLS is publicly accessible through the [Supabase] API."
> Index every column referenced in a policy — up to 99.94% improvement measured.

**Decision (per user's explicit call this session — see 05-secrets-handling.md
override note):** the port-3000 Express API is the only thing that talks to
this DB directly right now, using the Supabase connection over an internal
network with no public exposure of the Supabase REST/GraphQL API. RLS is
**enabled with a default-deny policy** on every table regardless (this is a
5-second `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies — the
doc is explicit that skipping this makes tables public through the API layer
Supabase exposes by default, which is a different, larger blast radius than
"the port-3000 app has no auth yet"). All actual reads/writes route through the
`service_role` key from the Node API server-side only — server_role bypasses
RLS by design, so RLS-enabled-but-policy-less tables still work correctly for
this API while remaining closed to the public `anon`/`authenticated` REST
surface Supabase exposes on every project by default.

## Foreign keys & relationships

**Source:** https://supabase.com/docs/guides/database/tables
> One-to-many via a FK column (e.g. `category_id`); many-to-many via a join table.

**Decision:** `order_items.order_id → orders.id` (one-to-many). `messages.order_id
→ orders.id` nullable (many-to-one, nullable because a message may arrive
before it's matched to an order — this is explicit in the business spec, see
04-platform-integration-source.md Step 3A). `files.order_id → orders.id` and
`files.order_item_id → order_items.id` nullable for the same reason (mock data
already has attachments with an empty `order_item_id` when unmatched).

## Naming conventions

**Source:** https://supabase.com/docs/guides/database/tables
> "Use lowercase with underscores for table names."

**Decision:** followed throughout — `order_items`, `file_jobs`, `raw_payload`, etc.

## Enums vs lookup tables for `platform`/`status`

**Source:** https://www.postgresql.org/docs/current/datatype-enum.html —
Postgres native `enum` types are fixed at creation; adding a value requires
`ALTER TYPE ... ADD VALUE` (a schema migration).

**Decision:** `platform` is a plain `text` column with a `CHECK` constraint,
**not** a Postgres enum. Reason: the user's own answer to "which platforms"
was "Shopee + others TBD" — new platforms (Lazada, TikTok Shop per the
business's own automation spec) will be added, and a `CHECK` constraint can be
altered with a plain `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT`, no
`ALTER TYPE` restart-in-transaction restriction. `status` columns (order
status, file job status, message direction) use `text + CHECK` for the same
reason — these are exactly the columns most likely to grow a new value as the
n8n workflow matures.
