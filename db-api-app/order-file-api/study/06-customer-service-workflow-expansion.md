# Scope expansion — full Customer Service Workflow

**Source:** message from Mohammad Shahid Akhtar, 2026-08-06 14:01 (pasted directly
in this session), titled "Customer Service Workflow." Also references a Google
Drive folder ("Task", owner xal.hamdi0@gmail.com,
`https://drive.google.com/drive/folders/1QuXr8E_4frMAXbsgtLArOUbXkH789fCz`) —
folder metadata was reachable but its file contents were not (not indexed for
the connected Drive account); this note is sourced from the pasted text only.

This is a second, broader spec than `04-platform-integration-source.md`'s
automation-workflow PDF — it describes the *human* daily workflow the DB must
support, not just the AI automation slice. Nine numbered steps map to four new
schema concepts (the original orders/messages/files design stands unchanged):

## 1–3: Monitor / Understand / Handle Customer Requests → `support_cases`

Step 3 lists explicit request types: New Order, Product Questions, Order
Status, Order Updates/Changes, Address Changes, After-sales Support,
Complaints, Return Request, Cancel Request. This is a closed, named set — same
reasoning as `platform`/`status` elsewhere in this project (see
`02-supabase-schema-design.md`): `case_type text` with a `CHECK` constraint,
not a Postgres enum, so new case types (the business already names 9, more
plausible) don't require a type migration.

Case lifecycle needs a status distinct from `orders.status` — a support case
can be open/in_progress/waiting_customer/resolved/closed independent of the
order's own fulfillment status (an order can be `completed` while an
after-sales complaint about it is still `open`).

## 4: Payment & Invoice → `invoices`

**Source:** https://docs.stripe.com/api/invoices/object — Stripe's Invoice
object status vocabulary: `draft, open, paid, uncollectible, void`. Adopted
directly (renaming `open`→`sent` to match this business's own language
"Create Invoice" → "Confirm payment" flow, and dropping `uncollectible` since
that's a dunning-specific Stripe concept not in scope) as `status text CHECK
(status in ('draft','sent','paid','overdue','void'))`. Using an established
real-world vocabulary here instead of inventing one is the point of the
citation requirement — this isn't a novel problem.

## 5–7: Download / Organize / Share Files → existing `files`/`file_jobs`, extended

No new table. Two additions to the existing design:
- `platform` CHECK constraint on `files`/`messages` gains `'website'` as a
  source (the pasted workflow explicitly lists "Website" alongside
  Shopee/Lazada/WhatsApp/Email as both an order and a file source).
- "Notify the next department when required" (Step 7) → `files.shared_at
  timestamptz` nullable, set when the file has been uploaded to NAS and the
  next department notified — a single timestamp is sufficient; which
  department isn't specified in the source text, so not modeled as a field
  (would be inventing a value set not given — flagged, not guessed).

## 8: Print Documents → `print_jobs`

**Pattern reference:** no dedicated cited source for "print job tracking" —
this is modeled directly from the pasted spec's own two named artifacts (Job
Sheet, Shipping Label) and the explicit dependency ("Attach the Job Sheet to
the order label"), not from an external framework. `print_jobs`: one row per
order, `job_sheet_printed_at`, `shipping_label_printed_at`, both nullable
timestamps — printed once each is what the spec describes, not a repeatable
job queue.

## 9: Order Follow-up → `order_status_events`

**Source:** https://shopify.dev/docs/api/admin-graphql/latest/objects/order
and Shopify's order timeline — "each action, from order creation to shipment,
is timestamped, forming an audit trail that reveals precisely what happened,
when, and who was responsible." This is the standard e-commerce pattern for
"track order progress... until the case is closed" (the pasted spec's own
words). `order_status_events`: append-only, `order_id`, `from_status`,
`to_status`, `reason`, `changed_by`, `created_at` — never updated or deleted,
mirrors `orders.status` transitions. This also satisfies the original
automation-workflow PDF's "full traceability" goal more completely than a
single mutable `orders.status` column alone does.
