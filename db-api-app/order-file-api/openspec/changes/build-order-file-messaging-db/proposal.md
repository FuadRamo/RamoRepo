# Proposal: Production Supabase DB for orders, messages, files

## Why

`order-file-api` currently stores everything in a single `db.json` file
(explicitly a mock — see project README) standing in for "Mohammad's backend."
The business's own automation spec (`planning/kb/Shahid/db-design/
AI-Customer-Service-Automation-Workflow.pdf`) requires a real Order Database,
Chat Database, and File Storage tracking system that multiple services (n8n,
AI Search Agent, AI File Agent, Automation Engine) read/write through this
API. JSON-file storage can't support concurrent writes from multiple modules,
has no query/index capability, and has no migration path.

## What's changing

- Replace `db.json` with a real Postgres schema hosted on Supabase, accessed
  through the existing port-3000 Express API (this API becomes the only thing
  that talks to Postgres directly — other modules keep calling `/api/*`, not
  Supabase directly).
- Core tables: `orders` (+ `order_items`), `messages`, `files` (+
  `file_jobs` for the download/rename/organize processing pipeline already
  described in the spec's Step 4).
- Extended tables, added after a second business spec ("Customer Service
  Workflow," pasted 2026-08-06) widened scope beyond the automation-only
  slice: `support_cases` (complaints/returns/cancellations/after-sales/
  questions), `invoices` (payment tracking), `order_status_events` (audit
  trail), `print_jobs` (job sheet / shipping label) — see
  `study/06-customer-service-workflow-expansion.md`.
- Every table platform-agnostic (`platform text` + `raw_payload jsonb`), so
  Lazada/TikTok Shop/WhatsApp Business API/Website can be added without a
  schema migration — see `study/02-supabase-schema-design.md`.

## Non-goals (this change)

- Not implementing the AI Search Agent / AI File Agent logic — this is a data
  layer only.
- Not adding auth to the port-3000 API — explicit user decision this session
  (internal network only, for now). RLS on the Postgres side is still enabled
  regardless (default-deny) — see `study/02-supabase-schema-design.md`.
- Not executing the Supabase → self-hosted migration — documented as a future
  path in `study/03-migration-to-self-hosted.md`, schema is designed to not
  block it, but the migration itself is out of scope here.

## References

All design decisions cited in `../../../study/` (relative to this file):
`01-openspec.md`, `02-supabase-schema-design.md`,
`03-migration-to-self-hosted.md`, `04-platform-integration-source.md`,
`05-secrets-handling.md`.
