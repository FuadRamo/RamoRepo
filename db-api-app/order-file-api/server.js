/**
 * order-file-api
 * -------------------------------------------------------------------------
 * Backed by the live Supabase Postgres schema (see
 * supabase/migrations/20260806140000_init_schema.sql) via db.js, which uses
 * PostgREST + the service_role key — see db.js header for why.
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

async function getOrderWithItems(orderId) {
  const rows = await db.select("orders", `?id=eq.${encodeURIComponent(orderId)}&select=*,order_items(*)`);
  return rows[0] || null;
}

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

if (!(webhook_url && attachment_id) && !(platform && external_order_id)) {
  return res.status(400).json({
    error:
      "either webhook_url+attachment_id or platform+external_order_id is required",
  });
}

    return res
      .status(400)
      .json({ error: "platform and external_order_id are required" });
  }

  try {
    const existing = await db.select(
      "orders",
      `?platform=eq.${encodeURIComponent(platform)}&external_order_id=eq.${encodeURIComponent(external_order_id)}`
    );
    if (existing.length > 0) {
      return res.json(await getOrderWithItems(existing[0].id));
    }

    const [order] = await db.insert("orders", [
      {
        platform,
        external_order_id,
        tracking_number: tracking_number || null,
        customer_name: customer_name || null,
        phone_number: phone_number || null,
        email: email || null,
        raw_payload: raw_payload || null,
      },
    ]);

    await db.insert("order_status_events", [
      { order_id: order.id, from_status: null, to_status: "new", reason: "order created", changed_by: "api" },
    ]);

    if (items && items.length) {
      await db.insert(
        "order_items",
        items.map((item) => ({
          order_id: order.id,
          product_name: item.product_name || null,
          sku: item.sku || null,
          variation: item.variation || null,
          quantity: item.quantity || null,
        }))
      );
    }

    res.status(201).json(await getOrderWithItems(order.id));
  } catch (err) {
    res.status(500).json({ error: "failed to create order", details: err.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const rows = await db.select("orders", "?select=*,order_items(*)&order=created_at.desc");
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
    const current = await db.select("orders", `?id=eq.${encodeURIComponent(req.params.id)}&select=status`);
    if (current.length === 0) return res.status(404).json({ error: "order not found" });

    await db.update("orders", `?id=eq.${encodeURIComponent(req.params.id)}`, {
      status,
      review_reason: review_reason || null,
    });
    await db.insert("order_status_events", [
      {
        order_id: req.params.id,
        from_status: current[0].status,
        to_status: status,
        reason: reason || null,
        changed_by: changed_by || "api",
      },
    ]);

    res.json(await getOrderWithItems(req.params.id));
  } catch (err) {
    res.status(500).json({ error: "failed to update order", details: err.message });
  }
});

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
    const [message] = await db.insert("messages", [
      {
        order_id: order_id || null,
        platform,
        conversation_id: conversation_id || null,
        external_message_id: external_message_id || null,
        sender: sender || null,
        receiver: receiver || null,
        direction: direction || null,
        content: content || null,
        message_time: message_time || null,
        raw_payload: raw_payload || null,
      },
    ]);
    res.status(201).json(message);
  } catch (err) {
    res.status(500).json({ error: "failed to create message", details: err.message });
  }
});

app.get("/api/messages", async (req, res) => {
  const { order_id, platform, conversation_id } = req.query;
  const filters = [];
  if (order_id) filters.push(`order_id=eq.${encodeURIComponent(order_id)}`);
  if (platform) filters.push(`platform=eq.${encodeURIComponent(platform)}`);
  if (conversation_id) filters.push(`conversation_id=eq.${encodeURIComponent(conversation_id)}`);
  filters.push("order=message_time.asc.nullslast,created_at.asc");

  try {
    const rows = await db.select("messages", `?${filters.join("&")}`);
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

        const [message] = await db.insert("messages", [
          {
            platform: "whatsapp",
            conversation_id: msg.from,
            external_message_id: msg.id,
            sender: msg.from,
            direction: "inbound",
            content,
            message_time: messageTime,
            raw_payload: msg,
          },
        ]);

        let file = null;
        if (msg.type === "image" || msg.type === "document") {
          const media = msg[msg.type];
          const [fileRow] = await db.insert("files", [
            { message_id: message.id, original_filename: media.filename || null, mime_type: media.mime_type || null },
          ]);
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
    const rows = await db.select("files", "?select=*&order=created_at.desc");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list files", details: err.message });
  }
});

app.get("/api/attachments/:attachment_id/download", async (req, res) => {
  try {
    const rows = await db.select("files", `?id=eq.${encodeURIComponent(req.params.attachment_id)}`);
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
    const rows = await db.select("file_jobs", "?select=*&order=created_at.desc");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "failed to list file jobs", details: err.message });
  }
});

app.get("/api/file-jobs/:job_id", async (req, res) => {
  try {
    const rows = await db.select("file_jobs", `?id=eq.${encodeURIComponent(req.params.job_id)}`);
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
    const jobs = await db.select("file_jobs", `?id=eq.${encodeURIComponent(req.params.job_id)}`);
    if (jobs.length === 0) return res.status(404).json({ error: "job not found" });

    const patch = { status, error: error || null, updated_at: new Date().toISOString() };
    if (final_filename) patch.final_filename = final_filename;
    if (checksum_sha256) patch.checksum_sha256 = checksum_sha256;

    const [job] = await db.update("file_jobs", `?id=eq.${encodeURIComponent(req.params.job_id)}`, patch);

    if (nas_path) {
      await db.update("files", `?id=eq.${encodeURIComponent(job.file_id)}`, { nas_path });
    }

    res.json({ ok: true, job });
  } catch (err) {
    res.status(500).json({ error: "failed to update file job", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`order-file-api listening on http://localhost:${PORT} (backed by Supabase via PostgREST)`);
});
