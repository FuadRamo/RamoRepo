# Spec: Orders

## Requirement: order creation triggers the automation workflow

Per the business spec (Step 1), inserting an order must be an observable
event other services can react to.

**Scenario:** New order arrives from a platform
- WHEN the API receives `POST /api/orders` with a valid `platform`,
  `external_order_id`, and at least one item
- THEN a new `orders` row is created with `status = 'new'`, a new row per item
  is created in `order_items`, and the response includes the generated
  `order_id` (uuid) for the caller to reference in subsequent calls

**Scenario:** Duplicate order from the same platform
- WHEN `POST /api/orders` is called with a `(platform, external_order_id)`
  pair that already exists
- THEN the API returns the existing order (idempotent), not a duplicate row —
  `orders` has a `UNIQUE (platform, external_order_id)` constraint

## Requirement: order moves to Human Review under defined conditions

Per the business spec's five listed Human Review triggers.

**Scenario:** No conversation found for an order after reminder limit
- WHEN the Automation Engine has retried searching per its configured limit
  and found no matching conversation
- THEN `PATCH /api/orders/:id` sets `status = 'human_review'` and
  `review_reason = 'no_conversation_found'` (one of the five spec-defined
  reasons, enforced by a CHECK constraint, not free text)
