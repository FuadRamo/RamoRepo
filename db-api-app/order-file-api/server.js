/**
 * order-file-api
 * -------------------------------------------------------------------------
 * Backed by the live Supabase Postgres schema (see
 * supabase/migrations/20260806140000_init_schema.sql) via db.js — see that
 * file for why the DB access pattern is temporary and what to replace it
 * with (service_role key or a direct connection string, neither provided
 * yet).
 *
 * No auth is enforced right now (explicit decision, internal network only
 * — see study/02-supabase-schema-design.md and study/05-secrets-handling.md).
 * See README.md "Adding an API key later" for how to switch it on.
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("./db");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------

app.post("/api/orders", async (req, res) => {
  const {
    platform,
    external_order_id,
    tracking_number,
    customer_name,
    phone_number,
    email,
    items,
    raw_payload,
  } = req.body || {};

  if (!platform || !external_order_id) {
    return res
      .status(400)
      .json({ error: "platform and external_order_id are required" });
  }

  try {
    const existing = await db.query(
      `select id from orders where platform = $1 and external_order_id = $2`,
      [platform, external_order_id]
    );
    if (existing.length > 0) {
      const order = await getOrderWithItems(existing[0].id);
      return res.json(order);
    }

    const [{ id: orderId }] = await db.query(
      `insert into orders (platform, external_order_id, tracking_number, customer_name, phone_number, email, raw_payload)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        platform,
        external_order_id,
        tracking_number || null,
        customer_name || null,
        phone_number || null,
        email || null,
        raw_payload ? JSON.stringify(raw_payload) : null,
      ]
    );

    await db.query(
      `insert into order_status_events (order_id, from_status, to_status, reason, changed_by)
       values ($1, null, 'new', 'order created', 'api')`,
      [orderId]
    );

    for (const item of items || []) {
      await db.query(
        `insert into order_items (order_id, product_name, sku, variation, quantity)
         values ($1, $2, $3, $4, $5)`,
        [orderId, item.product_name || null, item.sku || null, item.variation || null, item.quantity || null]
      );
    }

    const order = await getOrderWithItems(orderId);
    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: "failed to create order", details: err.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const rows = await db.query(`select * from orders order by created_at desc`, [], { readOnly: true });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list orders", details: err.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await getOrderWithItems(req.params.id);
    if (!order) return res.status(404).json({ error: "order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "failed to fetch order", details: err.message });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  const { status, review_reason, reason, changed_by } = req.body || {};
  if (!status) return res.status(400).json({ error: "status is required" });

  try {
    const current = await db.query(`select status from orders where id = $1`, [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: "order not found" });

    await db.query(
      `update orders set status = $1, review_reason = $2 where id = $3`,
      [status, review_reason || null, req.params.id]
    );
    await db.query(
      `insert into order_status_events (order_id, from_status, to_status, reason, changed_by)
       values ($1, $2, $3, $4, $5)`,
      [req.params.id, current[0].status, status, reason || null, changed_by || "api"]
    );

    const order = await getOrderWithItems(req.params.id);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "failed to update order", details: err.message });
  }
});

async function getOrderWithItems(orderId) {
  const orders = await db.query(`select * from orders where id = $1`, [orderId]);
  if (orders.length === 0) return null;
  const items = await db.query(`select * from order_items where order_id = $1`, [orderId]);
  return { ...orders[0], items };
}

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------

app.post("/api/messages", async (req, res) => {
  const {
    order_id,
    platform,
    conversation_id,
    external_message_id,
    sender,
    receiver,
    direction,
    content,
    message_time,
    raw_payload,
  } = req.body || {};

  if (!platform) return res.status(400).json({ error: "platform is required" });

  try {
    const [message] = await db.query(
      `insert into messages (order_id, platform, conversation_id, external_message_id, sender, receiver, direction, content, message_time, raw_payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *`,
      [
        order_id || null,
        platform,
        conversation_id || null,
        external_message_id || null,
        sender || null,
        receiver || null,
        direction || null,
        content || null,
        message_time || null,
        raw_payload ? JSON.stringify(raw_payload) : null,
      ]
    );
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: "failed to create message", details: err.message });
  }
});

app.get("/api/messages", async (req, res) => {
  const { order_id, platform, conversation_id } = req.query;
  const clauses = [];
  const params = [];

  if (order_id) { params.push(order_id); clauses.push(`order_id = $${params.length}`); }
  if (platform) { params.push(platform); clauses.push(`platform = $${params.length}`); }
  if (conversation_id) { params.push(conversation_id); clauses.push(`conversation_id = $${params.length}`); }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";

  try {
    const rows = await db.query(
      `select * from messages ${where} order by message_time nulls last, created_at`,
      params,
      { readOnly: true }
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list messages", details: err.message });
  }
});

// ---------------------------------------------------------------------
// POST /api/webhooks/whatsapp
// Accepts the WhatsApp Cloud API webhook "value" shape (see
// study/07-whatsapp-webhook-format.md) - text, image, or document messages.
// Creates a messages row per message, plus a files row for image/document.
// ---------------------------------------------------------------------
app.post("/api/webhooks/whatsapp", async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const created = [];

  try {
    for (const event of events) {
      for (const msg of event.messages || []) {
        const messageTime = msg.timestamp
          ? new Date(Number(msg.timestamp) * 1000).toISOString()
          : null;

        const content = msg.type === "text" ? msg.text?.body ?? null : null;

        const [message] = await db.query(
          `insert into messages (platform, conversation_id, external_message_id, sender, direction, content, message_time, raw_payload)
           values ('whatsapp', $1, $2, $3, 'inbound', $4, $5, $6)
           returning *`,
          [msg.from, msg.id, msg.from, content, messageTime, JSON.stringify(msg)]
        );

        let file = null;
        if (msg.type === "image" || msg.type === "document") {
          const media = msg[msg.type];
          const [fileRow] = await db.query(
            `insert into files (message_id, original_filename, mime_type)
             values ($1, $2, $3)
             returning *`,
            [message.id, media.filename || null, media.mime_type || null]
          );
          file = fileRow;
        }

        created.push({ message, file });
      }
    }
    res.status(201).json({ created });
  } catch (err) {
    res.status(500).json({ error: "failed to ingest whatsapp webhook", details: err.message });
  }
});

// ---------------------------------------------------------------------
// Files / file jobs (existing mock contract, now backed by Postgres)
// ---------------------------------------------------------------------

app.get("/api/attachments", async (req, res) => {
  try {
    const rows = await db.query(`select * from files order by created_at desc`, [], { readOnly: true });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list files", details: err.message });
  }
});

app.get("/api/attachments/:attachment_id/download", async (req, res) => {
  try {
    const rows = await db.query(`select * from files where id = $1`, [req.params.attachment_id]);
    if (rows.length === 0) return res.status(404).json({ error: "attachment not found" });
    const file = rows[0];

    if (!file.nas_path || !fs.existsSync(file.nas_path)) {
      return res.status(404).json({ error: "file not yet available on NAS" });
    }

    res.setHeader("Content-Type", file.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.original_filename || path.basename(file.nas_path)}"`
    );
    res.sendFile(file.nas_path);
  } catch (err) {
    res.status(500).json({ error: "failed to fetch attachment", details: err.message });
  }
});

app.get("/api/file-jobs", async (req, res) => {
  try {
    const rows = await db.query(`select * from file_jobs order by created_at desc`, [], { readOnly: true });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list file jobs", details: err.message });
  }
});

app.get("/api/file-jobs/:job_id", async (req, res) => {
  try {
    const rows = await db.query(`select * from file_jobs where id = $1`, [req.params.job_id]);
    if (rows.length === 0) return res.status(404).json({ error: "job not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "failed to fetch file job", details: err.message });
  }
});

app.patch("/api/file-jobs/:job_id", async (req, res) => {
  const { status, final_filename, nas_path, checksum_sha256, error } = req.body || {};

  if (!status) return res.status(400).json({ error: "status is required" });
  const allowedStatuses = ["completed", "human_review", "failed"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowedStatuses.join(", ")}` });
  }

  try {
    const jobs = await db.query(`select * from file_jobs where id = $1`, [req.params.job_id]);
    if (jobs.length === 0) return res.status(404).json({ error: "job not found" });

    const [job] = await db.query(
      `update file_jobs
       set status = $1, final_filename = coalesce($2, final_filename),
           checksum_sha256 = coalesce($3, checksum_sha256), error = $4, updated_at = now()
       where id = $5
       returning *`,
      [status, final_filename || null, checksum_sha256 || null, error || null, req.params.job_id]
    );

    if (nas_path) {
      await db.query(`update files set nas_path = $1 where id = $2`, [nas_path, job.file_id]);
    }

    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: "failed to update file job", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`order-file-api listening on http://localhost:${PORT} (backed by Supabase)`);
});
