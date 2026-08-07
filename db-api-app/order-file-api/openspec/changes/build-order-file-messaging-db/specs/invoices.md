# Spec: Invoices

## Requirement: invoice status follows a fixed, sourced vocabulary

**Source:** https://docs.stripe.com/api/invoices/object

**Scenario:** Invoice created for a new order
- WHEN Finance calls `POST /api/invoices` with an `order_id` and `amount`
- THEN an `invoices` row is created with `status = 'draft'`

**Scenario:** Payment confirmed before production starts
- WHEN `PATCH /api/invoices/:id` is called with `status = 'paid'` and a
  `paid_at` timestamp
- THEN the invoice updates, and per the Customer Service Workflow's own
  ordering ("Confirm payment before processing"), this is the signal the
  Automation Engine/CS staff use before advancing `orders.status` past
  payment-gated stages — enforced procedurally (staff/n8n check invoice
  status before triggering production), not by a DB trigger in this design
