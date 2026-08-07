# Business requirement source — "AI Customer Service Automation Workflow"

**Source:** `planning/kb/Shahid/db-design/AI-Customer-Service-Automation-Workflow.pdf`
(provided by the user, 2026-08-06). This is the actual internal spec this DB
serves — not a third-party doc, but the ground truth for what fields exist and
why. Quoted/paraphrased directly, not reinterpreted.

## Order Database (→ `orders` / `order_items` tables)

Verbatim field list from the spec's Step 1 ("New Order Trigger"):
Order ID, Tracking Number, Customer Name, Phone Number, Email, Platform,
Ordered Products, Quantity. The spec states this DB "triggers the workflow" —
i.e. an `INSERT` into `orders` is the event n8n/the automation engine listens
for. This is why the planning doc treats order creation as the one write path
that must be reliably observable (webhook/trigger), not just a CRUD endpoint.

## Chat Database (→ `messages` table)

Verbatim field list from the spec's "Chat Database" section: Platform,
Conversation ID, Message ID, Sender, Receiver, Message Content, Message Time,
Order ID (if detected — **explicitly nullable**), Tracking Number (if detected),
Attachments, Attachment Location. Channels named: WhatsApp, Email, Shopee Chat,
Lazada Chat.

This directly confirms two schema decisions:
1. `messages.order_id` must be nullable — the spec's own Step 3A ("Conversation
   Not Found") describes cases where no order match exists yet.
2. `messages` needs its own `attachments` relationship, distinct from `files`
   attached directly to an order — a WhatsApp message can carry a file before
   it's matched/renamed/organized into the order's file set (that matching is
   Step 4, a separate later step).

## File Storage (→ `files` / `file_jobs` tables)

Spec: "Store all downloaded customer files in the Local Network Storage after
they have been renamed and matched to the correct product." Confirms the
user's answer in this session (NAS is final storage, DB stores metadata only)
is exactly what the business's own spec already assumes — not a new decision,
just formalizing what Step 3B/Step 4 already require.

## Human Review triggers (→ `orders.review_reason` / status model)

Spec lists five conditions that move a case to Human Review: no conversation
found, no attachment found, AI can't confidently match files to products,
multiple possible conversations found, manual communication required. These
become the allowed values of a `review_reason` check constraint rather than a
free-text field, so the automation engine and any dashboard can filter/count
by reason reliably.

## Roles named in the spec (informs which tables which service touches)

Order Database, Chat Integration, Chat Database, AI Search Agent, AI File
Agent, Automation Engine, Local Network Storage, Human Review. This project
(`order-file-api`, port 3000) is the shared data-access layer these roles talk
through — it does not implement the AI Search/File Agent logic itself.
