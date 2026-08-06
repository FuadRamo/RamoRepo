# Spec: Files

## Requirement: files table never stores blob bytes

Per the business spec — "Store all downloaded customer files in the Local
Network Storage" — and the user's explicit decision this session.

**Scenario:** A file finishes processing
- WHEN a `file_job` transitions to `status = 'completed'` via
  `PATCH /api/file-jobs/:job_id` with a `nas_path`
- THEN the corresponding `files` row is updated with that `nas_path`, and
  `GET /api/attachments/:id/download` reads the file from that NAS path (or
  proxies to wherever the NAS is mounted/reachable from the API), never from
  a blob column in Postgres

## Requirement: a file can be unmatched to a specific order item

Matches the existing mock's `ATT_124` example (empty `order_item_id`).

**Scenario:** AI File Agent can't confidently match a file to a product
- WHEN a file is downloaded but the AI File Agent's match confidence is below
  threshold
- THEN `files.order_item_id` stays `NULL` and the associated `file_jobs` row
  gets `status = 'human_review'`, `error` populated with the reason — same
  status vocabulary as `orders.status`, so both surfaces are queryable the
  same way
