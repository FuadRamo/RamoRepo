# Spec: Support Cases

## Requirement: a support case can exist without a fulfillment order changing state

Per the Customer Service Workflow spec's Step 3 (Handle Customer Requests) —
product questions, after-sales, complaints, returns, and cancellations are all
distinct from an order's own fulfillment status.

**Scenario:** Customer files a complaint about a completed order
- WHEN a CS staff member opens `POST /api/support-cases` with `case_type =
  'complaint'` and an `order_id` referencing an already-`completed` order
- THEN the `support_cases` row is created with `status = 'open'`, and
  `orders.status` is untouched — the two statuses are independent

**Scenario:** Case has no order yet (general product question)
- WHEN a case is opened from a message that hasn't been matched to any order
- THEN `support_cases.order_id` is `NULL`, same nullable pattern as
  `messages.order_id`

## Requirement: return/cancel cases can drive an order status change

**Scenario:** Return request is approved
- WHEN a `support_cases` row with `case_type = 'return_request'` is closed
  with a resolution indicating approval
- THEN a separate `PATCH /api/orders/:id` call (not an automatic side effect)
  sets `orders.status = 'returned'`, which in turn writes an
  `order_status_events` row — the two writes stay separate calls so the audit
  trail records the order-status change explicitly, not implicitly
