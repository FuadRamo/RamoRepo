# order-file-api-mock

A minimal mock of **Mohammad's backend API** for the *AI Customer Service
Automation Workflow*. It exists so the n8n side of this project can be built
and tested against real request/response shapes before the production API
is ready.

**This is not SQL.** All data lives in one file, `db.json`, which the server
reads and rewrites on each request. That's the whole "database."

```
order-file-api/
├── server.js          # the API — start here
├── db.json             # working data (gets modified as you test)
├── db.seed.json         # original seed data (never modified)
├── sample-files/         # dummy files served by the download endpoint
├── scripts/reset-db.js    # copies db.seed.json back over db.json
├── package.json
└── README.md
```

## Why this exists

From the thread: n8n needs to (1) get notified when an attachment is ready,
(2) download the actual file, and (3) report back what happened. Points 2
and 3 are endpoints that live on **Mohammad's** side, and point 1 is a
webhook n8n receives. Until his real API exists, this repo stands in for
it so the n8n workflow can be wired up and tested end-to-end today.

## Setup

```bash
npm install
npm start
# -> order-file-api-mock listening on http://localhost:3000
```

Requires Node 18+ (uses the built-in `fetch`).

To reset the data after testing:

```bash
npm run reset-db
```

## Endpoints

### 1. `GET /api/attachments/:attachment_id/download`

Returns the raw binary file for that attachment — exactly what your
`download_url` in the webhook payload should point to.

```bash
curl -o out.pdf http://localhost:3000/api/attachments/ATT_123/download
```

Try `ATT_123` (a mock PDF) or `ATT_124` (a mock `.ai` file) against the
seed data.

### 2. `PATCH /api/file-jobs/:job_id`

n8n calls this after it has downloaded, renamed, and saved a file to the
NAS, to report the result.

**Completed:**

```bash
curl -X PATCH http://localhost:3000/api/file-jobs/JOB_789 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "final_filename": "260727QURVFYCT_Sticker-A5_01.pdf",
    "nas_path": "/Orders/Shopee/260727QURVFYCT/260727QURVFYCT_Sticker-A5_01.pdf",
    "checksum_sha256": "abc123..."
  }'
```

**Failure / needs a human:**

```bash
curl -X PATCH http://localhost:3000/api/file-jobs/JOB_790 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "human_review",
    "error": "The attachment could not be matched to an order item"
  }'
```

`status` must be one of `completed`, `human_review`, `failed`. The updated
job is saved to `db.json` and returned in the response.

### Human Review API

These endpoints store cases that need a person to inspect an attachment or
correct its order matching. They are part of this JSON mock only; production
still needs an equivalent SQL model and API implementation.

#### `POST /api/review-cases`

Create a case. `reason` and at least one of `job_id`, `order_id`,
`external_order_id`, or `attachment_id` are required. The server generates
`review_id`, timestamps, default status `open`, default priority `normal`, and
default context `{}`.

```bash
curl -X POST http://localhost:3000/api/review-cases \
  -H "Content-Type: application/json" \
  -d '{
    "job_id": "JOB_789",
    "order_id": "ORD_456",
    "external_order_id": "260727QURVFYCT",
    "attachment_id": "ATT_123",
    "reason": "uncertain_file_match",
    "source_workflow": "Downloading attchments to NAS",
    "source_node": "Needs Human Review?",
    "summary": "The attachment could not be matched confidently",
    "confidence": 0.45,
    "context": { "platform": "shopee" }
  }'
```

A new case returns `201` with `created: true`. If `job_id` is present and
valid, this same database write changes that job to `human_review`, copies the
case summary (or error) into the job's `error` field, and updates the job's
`updated_at`. It does not mark the job completed when the case is later
resolved; a future resume workflow owns that transition.

#### `GET /api/review-cases`

List newest cases first. Optional exact-match filters are `status`, `reason`,
`priority`, `job_id`, `order_id`, `external_order_id`, and `attachment_id`.

```bash
curl "http://localhost:3000/api/review-cases?status=open&priority=high"
```

#### `GET /api/review-cases/:review_id`

Fetch one case by its server-generated ID.

```bash
curl http://localhost:3000/api/review-cases/REV_REPLACE_WITH_ID
```

#### `PATCH /api/review-cases/:review_id`

Update one or more of `status`, `priority`, `assigned_to`, `reviewer_notes`,
`resolution`, `corrected_data`, or `customer_contacted_at`.

```bash
curl -X PATCH http://localhost:3000/api/review-cases/REV_REPLACE_WITH_ID \
  -H "Content-Type: application/json" \
  -d '{
    "status": "corrected",
    "assigned_to": "reviewer@example.com",
    "reviewer_notes": "Matched to the first order item",
    "resolution": "manual_match",
    "corrected_data": { "order_item_id": "ITEM_01" }
  }'
```

Changing status to `approved`, `corrected`, or `resolved` sets `resolved_at`.
Moving a case back to a nonterminal status clears `resolved_at`.

#### Allowed values

- Reasons: `no_attachment`, `uncertain_file_match`,
  `multiple_conversations`, `missing_order_information`, `invalid_payload`,
  `download_failed`, `upload_failed`, `unsupported_file`,
  `customer_contact_required`
- Statuses: `open`, `in_review`, `waiting_customer`, `approved`, `corrected`,
  `resolved`
- Priorities: `low`, `normal`, `high`, `urgent`

`confidence`, when present, must be from `0` to `1`. `context` and
`corrected_data` must be JSON objects.

#### Idempotency

Callers may provide a stable `dedupe_key`. If an `open`, `in_review`, or
`waiting_customer` case already has that key, the API returns that case with
HTTP `200` and `created: false` instead of inserting a duplicate. If the key is
omitted, the API derives one from the best available identifier, reason, and
source node. Terminal cases do not block a new case with the same key.

### 3. `POST /api/simulate/fire-webhook`

There's no real "new order" trigger yet, so use this to manually fire the
**attachment-ready webhook** — the one point 1 in the thread asks Mohammad's
side to send — at a URL of your choice (e.g. an n8n Webhook node's test
URL). This lets you trigger and test your n8n workflow on demand.

```bash
curl -X POST http://localhost:3000/api/simulate/fire-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "webhook_url": "https://your-n8n-instance/webhook-test/attachment-ready",
    "attachment_id": "ATT_123"
  }'
```

This builds and POSTs a payload shaped like:

```json
{
  "job_id": "JOB_789",
  "attachment_id": "ATT_123",
  "order_id": "ORD_456",
  "external_order_id": "260727QURVFYCT",
  "platform": "shopee",
  "order_item_id": "ITEM_01",
  "product_name": "Sticker A5",
  "sku": "STICKER-A5",
  "variation": "Glossy, 5cm",
  "quantity": 100,
  "original_filename": "customer-design.pdf",
  "mime_type": "application/pdf",
  "file_size": 5242880,
  "file_number": 1,
  "total_files": 2,
  "customer_notes": "Remove the background",
  "download_url": "http://localhost:3000/api/attachments/ATT_123/download"
}
```

`attachment_id` is unique per attachment (per the thread's request), so it
can be used on the n8n side as an idempotency key to prevent retries from
creating duplicate files.

If the attachment isn't matched to a specific product yet, `order_item_id`,
`product_name`, `sku`, and `variation` are empty strings (see `ATT_124` in
the seed data) — but `order_id` is always present.

### Debug / read-only helpers

```
GET /api/orders
GET /api/attachments
GET /api/file-jobs
GET /api/file-jobs/:job_id
```

Handy for checking what's in `db.json` without opening the file.

## Adding an API key later

No auth is enforced right now. When you're ready to lock it down, `server.js`
has a commented-out middleware block near the top — uncomment it, set an
`API_KEY` environment variable, and every request will need an
`x-api-key` header matching it.

## Data model (`db.json`)

```
orders[]
  order_id, external_order_id, platform, customer_name,
  phone_number, email, items[]

attachments[]
  attachment_id, job_id, order_id, order_item_id,
  product_name, sku, variation, quantity,
  original_filename, mime_type, file_size,
  file_number, total_files, customer_notes,
  sample_file   <- which file in sample-files/ this maps to

jobs[]
  job_id, attachment_id, status, final_filename,
  nas_path, checksum_sha256, error, created_at, updated_at

review_cases[]
  review_id, job_id, order_id, external_order_id, attachment_id,
  reason, status, priority, source_workflow, source_node, summary,
  error_message, confidence, context, dedupe_key, assigned_to,
  reviewer_notes, resolution, corrected_data, customer_contacted_at,
  created_at, updated_at, resolved_at
```

A stored review case has this portable shape:

```json
{
  "review_id": "REV_...",
  "job_id": "JOB_789",
  "order_id": "ORD_456",
  "external_order_id": "260727QURVFYCT",
  "attachment_id": "ATT_123",
  "reason": "uncertain_file_match",
  "status": "open",
  "priority": "normal",
  "source_workflow": "Downloading attchments to NAS",
  "source_node": "Needs Human Review?",
  "summary": "The attachment could not be matched confidently",
  "error_message": null,
  "confidence": 0.45,
  "context": {},
  "dedupe_key": "JOB_789:uncertain_file_match:Needs Human Review?",
  "assigned_to": null,
  "reviewer_notes": null,
  "resolution": null,
  "corrected_data": null,
  "customer_contacted_at": null,
  "created_at": "2026-08-06T00:00:00.000Z",
  "updated_at": "2026-08-06T00:00:00.000Z",
  "resolved_at": null
}
```

The four identifiers are nullable individually, but every case must contain at
least one of them.

`status` starts as `"pending"` and moves to `"completed"`,
`"human_review"`, or `"failed"` via the PATCH endpoint above.

## Not covered here

This repo only mocks the two endpoints Mohammad's side needs to expose,
plus a way to fire the webhook n8n needs to receive. It does **not**
include: the Order/Chat databases, the AI Search/File agents, or the real
n8n workflow itself — those are separate pieces of the wider automation
described in the project brief.
