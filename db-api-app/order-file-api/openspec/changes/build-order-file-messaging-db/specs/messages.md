# Spec: Messages

## Requirement: messages can exist without a matched order

Per the business spec's Chat Database section — Order ID is "if detected."

**Scenario:** Message arrives before any order match
- WHEN Chat Integration syncs a new WhatsApp/Shopee Chat/Lazada Chat/Email
  message via `POST /api/messages`
- THEN the message is stored with `order_id = NULL` if no match was supplied,
  and can be updated later via `PATCH /api/messages/:id` once the AI Search
  Agent matches it to an order

## Requirement: every message records platform + conversation threading

**Scenario:** Two messages in the same WhatsApp thread
- WHEN two messages share the same `platform` and `conversation_id`
- THEN both rows reference the same `conversation_id` value, allowing
  `GET /api/messages?conversation_id=X` to return the full thread in
  `message_time` order
