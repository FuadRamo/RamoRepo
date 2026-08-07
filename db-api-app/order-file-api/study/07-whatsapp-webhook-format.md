# WhatsApp Cloud API webhook format → messages/files mapping

**Source:** three real webhook payloads pasted by the user (2026-08-05/06,
from `@Moh_Fuad_`'s own WhatsApp Business number), saved verbatim in
`study/examples/whatsapp-webhooks/{text,image,document}.json`. Structure
matches Meta's documented WhatsApp Cloud API webhook shape (`messaging_product`,
`metadata.display_phone_number`/`phone_number_id`, `contacts[]`, `messages[]`)
— https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/.
Note: Meta's docs show this `value` object nested inside `entry[].changes[]`;
the pasted payloads are already the unwrapped `value` object with `field`
appended (consistent with how n8n's WhatsApp trigger node flattens webhooks
before handing them to a workflow) — the API endpoint below accepts this
already-unwrapped shape, matching what will actually arrive from n8n.

## Common fields (all three types)

| Webhook field | → column |
|---|---|
| `messages[].id` | `messages.external_message_id` |
| `messages[].from` | `messages.sender` |
| `messages[].timestamp` (unix seconds, string) | `messages.message_time` (converted) |
| `contacts[].profile.name` | not stored as a column — available in `raw_payload` if needed later |
| whole message object | `messages.raw_payload` |
| — | `messages.platform = 'whatsapp'`, `messages.direction = 'inbound'` |
| — | `messages.conversation_id = messages[].from` (WhatsApp has no separate thread id; the customer's `wa_id` **is** the conversation) |

## Type-specific handling

- **`type: "text"`** → `messages.content = messages[].text.body`. No `files` row.
- **`type: "image"`** → `messages.content = NULL` (or a placeholder like
  `"[image]"` — not decided, flag if needed); a `files` row is created:
  `files.mime_type = image.mime_type`, `files.message_id` = the new message's
  id, `files.original_filename = NULL` (WhatsApp doesn't send one for images —
  unlike `document`), `files.nas_path = NULL` until downloaded. The WhatsApp
  media `id`/`url` from the payload go into `files` via `raw_payload` on the
  `messages` row (not duplicated onto `files` — `files` doesn't have its own
  `raw_payload` column per the current schema; the download step reads it
  from `messages.raw_payload` via `files.message_id`).
- **`type: "document"`** → same as image, plus
  `files.original_filename = document.filename`.

## What this does NOT cover yet

- **Downloading the actual media bytes.** WhatsApp webhook `url` fields are
  short-lived (`ext` query param = expiry) and require a signed request with
  the WhatsApp access token to actually fetch — a separate step (the AI File
  Agent's job per the original automation spec), not part of ingesting the
  webhook itself. `files.nas_path` stays `NULL` until that happens.
- **Order matching.** Per the original automation spec (Step 2/3), matching
  `messages.sender` (a phone number) to `orders.phone_number` is a separate
  AI Search Agent step, not done at ingestion time — `messages.order_id`
  stays `NULL` on insert here, same as the general design.
