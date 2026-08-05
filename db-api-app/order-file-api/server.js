/**
 * order-file-api-mock
 * -------------------------------------------------------------------------
 * A minimal mock of "Mohammad's backend" for the AI Customer Service
 * Automation Workflow. It lets n8n be built and tested against real
 * request/response shapes before the production API exists.
 *
 * Storage: a single db.json file. No SQL, no ORM.
 *
 * Endpoints:
 *   GET   /api/attachments/:attachment_id/download   -> binary file
 *   PATCH /api/file-jobs/:job_id                      -> accept status update
 *   POST  /api/simulate/fire-webhook                  -> send the
 *         "attachment ready" webhook payload to a URL you provide (e.g. an
 *         n8n Webhook node's test URL), so you can trigger your workflow
 *         without waiting on the real backend.
 *
 *   Debug/read-only helpers:
 *   GET   /api/orders
 *   GET   /api/attachments
 *   GET   /api/file-jobs
 *   GET   /api/file-jobs/:job_id
 *
 * No auth is enforced right now (per "for now it's unnecessary"). See
 * README.md "Adding an API key later" for how to switch it on.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");
const FILES_DIR = path.join(__dirname, "sample-files");
const PORT = process.env.PORT || 3000;

// Uncomment and set to require an API key on every request:
// const API_KEY = process.env.API_KEY;
// app.use((req, res, next) => {
//   if (!API_KEY) return next();
//   if (req.get("x-api-key") !== API_KEY) {
//     return res.status(401).json({ error: "unauthorized" });
//   }
//   next();
// });

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------
// GET /api/attachments/:attachment_id/download
// Returns the original binary file for that attachment.
// ---------------------------------------------------------------------
app.get("/api/attachments/:attachment_id/download", (req, res) => {
  const db = readDB();
  const attachment = db.attachments.find(
    (a) => a.attachment_id === req.params.attachment_id
  );

  if (!attachment) {
    return res.status(404).json({ error: "attachment not found" });
  }

  const filePath = path.join(FILES_DIR, attachment.sample_file);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "file missing on disk" });
  }

  res.setHeader(
    "Content-Type",
    attachment.mime_type || "application/octet-stream"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${attachment.original_filename}"`
  );
  res.sendFile(filePath);
});

// ---------------------------------------------------------------------
// PATCH /api/file-jobs/:job_id
// n8n reports back the result of processing a file (success or failure).
// ---------------------------------------------------------------------
app.patch("/api/file-jobs/:job_id", (req, res) => {
  const db = readDB();
  const job = db.jobs.find((j) => j.job_id === req.params.job_id);

  if (!job) {
    return res.status(404).json({ error: "job not found" });
  }

  const { status, final_filename, nas_path, checksum_sha256, error } =
    req.body || {};

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  const allowedStatuses = ["completed", "human_review", "failed"];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowedStatuses.join(", ")}`,
    });
  }

  job.status = status;
  job.final_filename = final_filename ?? job.final_filename;
  job.nas_path = nas_path ?? job.nas_path;
  job.checksum_sha256 = checksum_sha256 ?? job.checksum_sha256;
  job.error = error ?? null;
  job.updated_at = new Date().toISOString();

  writeDB(db);
  res.json({ ok: true, job });
});

// ---------------------------------------------------------------------
// POST /api/simulate/fire-webhook
// Body: { "webhook_url": "<n8n test webhook url>", "attachment_id": "ATT_123" }
// Builds the "attachment ready" payload from db.json and POSTs it to the
// URL you give it, so you can trigger your n8n workflow on demand.
// ---------------------------------------------------------------------
app.post("/api/simulate/fire-webhook", async (req, res) => {
  const { webhook_url, attachment_id } = req.body || {};

  if (!webhook_url || !attachment_id) {
    return res
      .status(400)
      .json({ error: "webhook_url and attachment_id are required" });
  }

  const db = readDB();
  const attachment = db.attachments.find(
    (a) => a.attachment_id === attachment_id
  );
  if (!attachment) {
    return res.status(404).json({ error: "attachment not found" });
  }

  const order = db.orders.find((o) => o.order_id === attachment.order_id);

  const payload = {
    job_id: attachment.job_id,
    attachment_id: attachment.attachment_id,
    order_id: attachment.order_id,
    external_order_id: order ? order.external_order_id : null,
    platform: order ? order.platform : null,
    order_item_id: attachment.order_item_id || "",
    product_name: attachment.product_name || "",
    sku: attachment.sku || "",
    variation: attachment.variation || "",
    quantity: attachment.quantity ?? null,
    original_filename: attachment.original_filename,
    mime_type: attachment.mime_type,
    file_size: attachment.file_size,
    file_number: attachment.file_number,
    total_files: attachment.total_files,
    customer_notes: attachment.customer_notes || "",
    download_url: `${req.protocol}://${req.get(
      "host"
    )}/api/attachments/${attachment.attachment_id}/download`,
  };

  try {
    const resp = await fetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    res.json({ sent: true, webhook_status: resp.status, payload });
  } catch (err) {
    res.status(502).json({
      error: "failed to reach webhook_url",
      details: err.message,
      payload,
    });
  }
});

// ---------------------------------------------------------------------
// Debug / read-only helpers
// ---------------------------------------------------------------------
app.get("/api/orders", (req, res) => res.json(readDB().orders));

app.get("/api/attachments", (req, res) => res.json(readDB().attachments));

app.get("/api/file-jobs", (req, res) => res.json(readDB().jobs));

app.get("/api/file-jobs/:job_id", (req, res) => {
  const job = readDB().jobs.find((j) => j.job_id === req.params.job_id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

app.listen(PORT, () => {
  console.log(`order-file-api-mock listening on http://localhost:${PORT}`);
});
