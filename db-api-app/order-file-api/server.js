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
 *   POST  /api/review-cases                           -> create review case
 *   GET   /api/review-cases                           -> list review cases
 *   GET   /api/review-cases/:review_id                -> get review case
 *   PATCH /api/review-cases/:review_id                -> update review case
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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "db.json");
const FILES_DIR = path.join(__dirname, "sample-files");
const PORT = process.env.PORT || 3000;

const REVIEW_REASONS = [
  "no_attachment",
  "uncertain_file_match",
  "multiple_conversations",
  "missing_order_information",
  "invalid_payload",
  "download_failed",
  "upload_failed",
  "unsupported_file",
  "customer_contact_required",
];
const REVIEW_STATUSES = [
  "open",
  "in_review",
  "waiting_customer",
  "approved",
  "corrected",
  "resolved",
];
const REVIEW_PRIORITIES = ["low", "normal", "high", "urgent"];
const UNRESOLVED_REVIEW_STATUSES = new Set([
  "open",
  "in_review",
  "waiting_customer",
]);
const TERMINAL_REVIEW_STATUSES = new Set([
  "approved",
  "corrected",
  "resolved",
]);

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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasIdentifier(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function generatedDedupeKey(body) {
  const identifier =
    [body.job_id, body.attachment_id, body.order_id, body.external_order_id].find(
      hasIdentifier
    ) || "unknown";
  return `${identifier}:${body.reason}:${body.source_node || "unknown_source"}`;
}

// ---------------------------------------------------------------------
// Review cases
// ---------------------------------------------------------------------
app.post("/api/review-cases", (req, res) => {
  const body = req.body || {};

  if (!REVIEW_REASONS.includes(body.reason)) {
    return res.status(400).json({
      error: `reason must be one of: ${REVIEW_REASONS.join(", ")}`,
    });
  }

  const identifierFields = [
    "job_id",
    "order_id",
    "external_order_id",
    "attachment_id",
  ];
  if (!identifierFields.some((field) => hasIdentifier(body[field]))) {
    return res.status(400).json({
      error: `at least one identifier is required: ${identifierFields.join(", ")}`,
    });
  }

  const status = body.status ?? "open";
  const priority = body.priority ?? "normal";
  if (!REVIEW_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${REVIEW_STATUSES.join(", ")}`,
    });
  }
  if (!REVIEW_PRIORITIES.includes(priority)) {
    return res.status(400).json({
      error: `priority must be one of: ${REVIEW_PRIORITIES.join(", ")}`,
    });
  }
  if (
    body.confidence !== undefined &&
    (typeof body.confidence !== "number" ||
      !Number.isFinite(body.confidence) ||
      body.confidence < 0 ||
      body.confidence > 1)
  ) {
    return res.status(400).json({ error: "confidence must be a number from 0 to 1" });
  }
  if (body.context !== undefined && !isObject(body.context)) {
    return res.status(400).json({ error: "context must be an object" });
  }

  const db = readDB();
  db.review_cases ||= [];

  if (hasIdentifier(body.job_id)) {
    const linkedJob = db.jobs.find((job) => job.job_id === body.job_id);
    if (!linkedJob) {
      return res.status(404).json({ error: "job not found" });
    }
  }

  const dedupeKey = body.dedupe_key || generatedDedupeKey(body);
  const duplicate = db.review_cases.find(
    (reviewCase) =>
      reviewCase.dedupe_key === dedupeKey &&
      UNRESOLVED_REVIEW_STATUSES.has(reviewCase.status)
  );
  if (duplicate) {
    return res.status(200).json({ created: false, review_case: duplicate });
  }

  const now = new Date().toISOString();
  const reviewCase = {
    review_id: `REV_${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`,
    job_id: body.job_id ?? null,
    order_id: body.order_id ?? null,
    external_order_id: body.external_order_id ?? null,
    attachment_id: body.attachment_id ?? null,
    reason: body.reason,
    status,
    priority,
    source_workflow: body.source_workflow ?? null,
    source_node: body.source_node ?? null,
    summary: body.summary ?? null,
    error_message: body.error_message ?? null,
    confidence: body.confidence ?? null,
    context: body.context ?? {},
    dedupe_key: dedupeKey,
    assigned_to: null,
    reviewer_notes: null,
    resolution: null,
    corrected_data: null,
    customer_contacted_at: null,
    created_at: now,
    updated_at: now,
    resolved_at: TERMINAL_REVIEW_STATUSES.has(status) ? now : null,
  };

  db.review_cases.push(reviewCase);
  if (hasIdentifier(body.job_id)) {
    const linkedJob = db.jobs.find((job) => job.job_id === body.job_id);
    linkedJob.status = "human_review";
    linkedJob.error = body.summary || body.error_message || null;
    linkedJob.updated_at = now;
  }
  writeDB(db);

  res.status(201).json({ created: true, review_case: reviewCase });
});

app.get("/api/review-cases", (req, res) => {
  const filters = [
    "status",
    "reason",
    "priority",
    "job_id",
    "order_id",
    "external_order_id",
    "attachment_id",
  ];
  const reviewCases = [...(readDB().review_cases || [])]
    .reverse()
    .filter((reviewCase) =>
      filters.every(
        (field) =>
          req.query[field] === undefined || reviewCase[field] === req.query[field]
      )
    )
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(reviewCases);
});

app.get("/api/review-cases/:review_id", (req, res) => {
  const reviewCase = (readDB().review_cases || []).find(
    (item) => item.review_id === req.params.review_id
  );
  if (!reviewCase) return res.status(404).json({ error: "review case not found" });
  res.json(reviewCase);
});

app.patch("/api/review-cases/:review_id", (req, res) => {
  const allowedFields = [
    "status",
    "priority",
    "assigned_to",
    "reviewer_notes",
    "resolution",
    "corrected_data",
    "customer_contacted_at",
  ];
  const body = req.body || {};
  const fields = allowedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );

  if (fields.length === 0) {
    return res.status(400).json({ error: "at least one supported field is required" });
  }
  if (body.status !== undefined && !REVIEW_STATUSES.includes(body.status)) {
    return res.status(400).json({
      error: `status must be one of: ${REVIEW_STATUSES.join(", ")}`,
    });
  }
  if (body.priority !== undefined && !REVIEW_PRIORITIES.includes(body.priority)) {
    return res.status(400).json({
      error: `priority must be one of: ${REVIEW_PRIORITIES.join(", ")}`,
    });
  }
  if (body.corrected_data !== undefined && !isObject(body.corrected_data)) {
    return res.status(400).json({ error: "corrected_data must be an object" });
  }

  const db = readDB();
  const reviewCase = (db.review_cases || []).find(
    (item) => item.review_id === req.params.review_id
  );
  if (!reviewCase) return res.status(404).json({ error: "review case not found" });

  for (const field of fields) reviewCase[field] = body[field];
  reviewCase.updated_at = new Date().toISOString();
  if (fields.includes("status")) {
    reviewCase.resolved_at = TERMINAL_REVIEW_STATUSES.has(reviewCase.status)
      ? reviewCase.updated_at
      : null;
  }

  writeDB(db);
  res.json(reviewCase);
});

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`order-file-api-mock listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
