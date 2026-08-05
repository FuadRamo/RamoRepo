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
```

`status` starts as `"pending"` and moves to `"completed"`,
`"human_review"`, or `"failed"` via the PATCH endpoint above.

## Not covered here

This repo only mocks the two endpoints Mohammad's side needs to expose,
plus a way to fire the webhook n8n needs to receive. It does **not**
include: the Order/Chat databases, the AI Search/File agents, or the real
n8n workflow itself — those are separate pieces of the wider automation
described in the project brief.
