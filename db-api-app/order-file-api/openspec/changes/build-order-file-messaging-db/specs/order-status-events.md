# Spec: Order Status Events

## Requirement: every order status change is recorded, never overwritten

**Source:** Shopify order timeline pattern —
https://shopify.dev/docs/api/admin-graphql/latest/objects/order — "each
action... is timestamped, forming an audit trail."

**Scenario:** Order status changes via any path
- WHEN `PATCH /api/orders/:id` changes `orders.status` from one value to
  another (human review, payment confirmation, return approval, etc.)
- THEN a new `order_status_events` row is inserted with `from_status`,
  `to_status`, `reason`, `changed_by`, `created_at` — this table is
  append-only; the API never issues an `UPDATE` or `DELETE` against it

## Requirement: audit trail is independently queryable

**Scenario:** CS staff needs to explain an order's history to a customer
- WHEN `GET /api/orders/:id/status-events` is called
- THEN it returns the full ordered list of transitions for that order,
  independent of the order's current `status` value — satisfies the original
  automation spec's "full traceability" goal (see
  `study/04-platform-integration-source.md`) at the status-history level
