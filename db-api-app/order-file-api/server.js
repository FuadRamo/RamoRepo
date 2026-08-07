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
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

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
    [
      body.job_id,
      body.attachment_id,
      body.order_id,
      body.external_order_id,
      body.intake_id,
    ].find(
      hasIdentifier
    ) || "unknown";
  return `${identifier}:${body.reason}:${body.source_node || "unknown_source"}`;
}

function normalizeOrderIdentifier(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/^ORDER\s*(?:ID|NUMBER|NO)?\s*[:#-]?\s*/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

function addReviewCaseRecord(db, body) {
  db.review_cases ||= [];
  const status = body.status ?? "open";
  const priority = body.priority ?? "normal";
  const dedupeKey = body.dedupe_key || generatedDedupeKey(body);
  const duplicate = db.review_cases.find(
    (reviewCase) =>
      reviewCase.dedupe_key === dedupeKey &&
      UNRESOLVED_REVIEW_STATUSES.has(reviewCase.status)
  );
  if (duplicate) return { created: false, review_case: duplicate };

  const now = new Date().toISOString();
  const reviewCase = {
    review_id: `REV_${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`,
    intake_id: body.intake_id ?? null,
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
  return { created: true, review_case: reviewCase };
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
    "intake_id",
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

  const result = addReviewCaseRecord(db, body);
  writeDB(db);
  res.status(result.created ? 201 : 200).json(result);
});

app.get("/api/review-cases", (req, res) => {
  const filters = [
    "intake_id",
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
// Gmail order intake
// ---------------------------------------------------------------------
app.post("/api/email-intakes", (req, res) => {
  const body = req.body || {};
  const allowedIntents = ["order_submission", "inquiry", "other"];
  const intent = body.intent ?? "order_submission";
  if (!hasIdentifier(body.gmail_message_id)) {
    return res.status(400).json({ error: "gmail_message_id is required" });
  }
  if (!allowedIntents.includes(intent)) {
    return res
      .status(400)
      .json({ error: `intent must be one of: ${allowedIntents.join(", ")}` });
  }
  if (
    body.extraction_confidence !== undefined &&
    (typeof body.extraction_confidence !== "number" ||
      !Number.isFinite(body.extraction_confidence) ||
      body.extraction_confidence < 0 ||
      body.extraction_confidence > 1)
  ) {
    return res
      .status(400)
      .json({ error: "extraction_confidence must be a number from 0 to 1" });
  }
  if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
    return res.status(400).json({ error: "attachments must be an array" });
  }

  const db = readDB();
  db.email_intakes ||= [];
  const duplicate = db.email_intakes.find(
    (item) => item.gmail_message_id === String(body.gmail_message_id)
  );
  if (duplicate) {
    return res.status(200).json({ created: false, intake: duplicate });
  }

  const extractedOrderId = hasIdentifier(body.extracted_order_id)
    ? String(body.extracted_order_id).trim()
    : null;
  const normalizedOrderId = normalizeOrderIdentifier(extractedOrderId);
  const order = normalizedOrderId
    ? (db.orders || []).find((candidate) =>
        [candidate.order_id, candidate.external_order_id].some(
          (value) => normalizeOrderIdentifier(value) === normalizedOrderId
        )
      )
    : null;
  const attachments = (body.attachments || []).map((file, index) => ({
    attachment_key: hasIdentifier(file?.attachment_key)
      ? String(file.attachment_key)
      : `attachment_${index}`,
    original_filename: hasIdentifier(file?.original_filename)
      ? String(file.original_filename)
      : `attachment-${index + 1}`,
    mime_type: file?.mime_type ? String(file.mime_type) : null,
    file_size:
      Number.isFinite(Number(file?.file_size)) && Number(file.file_size) >= 0
        ? Number(file.file_size)
        : null,
    status: "pending",
    final_filename: null,
    nas_path: null,
    checksum_sha256: null,
    error: null,
  }));
  const now = new Date().toISOString();
  const intake = {
    intake_id: `INT_${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`,
    gmail_message_id: String(body.gmail_message_id),
    gmail_thread_id: body.gmail_thread_id ? String(body.gmail_thread_id) : null,
    sender: body.sender ? String(body.sender) : null,
    recipient: body.recipient ? String(body.recipient) : null,
    subject: body.subject ? String(body.subject) : null,
    received_at: body.received_at ? String(body.received_at) : now,
    raw_snippet: body.raw_snippet ? String(body.raw_snippet) : null,
    intent,
    inquiry_text: body.inquiry_text ? String(body.inquiry_text).trim() : "",
    extracted_order_id: extractedOrderId,
    order_id: order?.order_id ?? null,
    external_order_id: order?.external_order_id ?? null,
    platform: order?.platform ?? null,
    customer_notes: body.customer_notes ? String(body.customer_notes).trim() : "",
    extraction_confidence: body.extraction_confidence ?? null,
    match_status:
      intent === "order_submission"
        ? order
          ? "matched"
          : extractedOrderId
            ? "unmatched"
            : "missing"
        : "not_applicable",
    status:
      intent === "inquiry"
        ? "inquiry"
        : intent === "other"
          ? "needs_review"
          : order && attachments.length > 0
            ? "processing"
            : "needs_review",
    attachments,
    created_at: now,
    updated_at: now,
  };
  db.email_intakes.push(intake);

  if (intent === "order_submission" && (!order || attachments.length === 0)) {
    const reason = attachments.length === 0 ? "no_attachment" : "missing_order_information";
    addReviewCaseRecord(db, {
      intake_id: intake.intake_id,
      order_id: intake.order_id,
      external_order_id: intake.external_order_id,
      reason,
      priority: "normal",
      source_workflow: "Gmail - Adding the orders",
      source_node: "Register Email Intake",
      summary:
        reason === "no_attachment"
          ? "The customer email did not include a file"
          : extractedOrderId
            ? `The extracted order ID ${extractedOrderId} was not found`
            : "No order ID could be extracted from the customer email",
      confidence: body.extraction_confidence,
      dedupe_key: `${intake.intake_id}:${reason}`,
      context: {
        gmail_message_id: intake.gmail_message_id,
        sender: intake.sender,
        subject: intake.subject,
        extracted_order_id: extractedOrderId,
        customer_notes: intake.customer_notes,
        attachment_names: attachments.map((file) => file.original_filename),
      },
    });
  } else if (intent === "other") {
    addReviewCaseRecord(db, {
      intake_id: intake.intake_id,
      reason: "customer_contact_required",
      priority: "normal",
      source_workflow: "Gmail - Adding the orders",
      source_node: "Route Email Intent (fallback)",
      summary: "The email was not a clear order submission or supported inquiry",
      confidence: body.extraction_confidence,
      dedupe_key: `${intake.intake_id}:customer_contact_required`,
      context: {
        gmail_message_id: intake.gmail_message_id,
        sender: intake.sender,
        subject: intake.subject,
        inquiry_text: intake.inquiry_text,
        customer_notes: intake.customer_notes,
        attachment_names: attachments.map((file) => file.original_filename),
      },
    });
  }

  writeDB(db);
  res.status(201).json({ created: true, intake });
});

app.get("/api/email-intakes", (req, res) => {
  const intakes = [...(readDB().email_intakes || [])]
    .filter(
      (item) =>
        req.query.status === undefined || item.status === req.query.status
    )
    .sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
  res.json(intakes);
});

app.get("/api/email-intakes/:intake_id", (req, res) => {
  const intake = (readDB().email_intakes || []).find(
    (item) => item.intake_id === req.params.intake_id
  );
  if (!intake) return res.status(404).json({ error: "email intake not found" });
  res.json(intake);
});

app.post("/api/email-intakes/:intake_id/files", (req, res) => {
  const body = req.body || {};
  if (!hasIdentifier(body.attachment_key) && !hasIdentifier(body.original_filename)) {
    return res
      .status(400)
      .json({ error: "attachment_key or original_filename is required" });
  }
  if (!["stored", "failed"].includes(body.status)) {
    return res.status(400).json({ error: "status must be stored or failed" });
  }

  const db = readDB();
  const intake = (db.email_intakes || []).find(
    (item) => item.intake_id === req.params.intake_id
  );
  if (!intake) return res.status(404).json({ error: "email intake not found" });

  let file = intake.attachments.find(
    (candidate) =>
      (hasIdentifier(body.attachment_key) &&
        candidate.attachment_key === String(body.attachment_key)) ||
      (hasIdentifier(body.original_filename) &&
        candidate.original_filename === String(body.original_filename))
  );
  if (!file) {
    file = {
      attachment_key: body.attachment_key || `attachment_${intake.attachments.length}`,
      original_filename: body.original_filename || "attachment",
      mime_type: body.mime_type ?? null,
      file_size: body.file_size ?? null,
    };
    intake.attachments.push(file);
  }

  Object.assign(file, {
    status: body.status,
    final_filename: body.final_filename ?? file.final_filename ?? null,
    nas_path: body.nas_path ?? file.nas_path ?? null,
    checksum_sha256: body.checksum_sha256 ?? file.checksum_sha256 ?? null,
    error: body.error ?? null,
  });
  const statuses = intake.attachments.map((attachment) => attachment.status);
  intake.status = statuses.includes("failed")
    ? "needs_review"
    : statuses.length > 0 && statuses.every((status) => status === "stored")
      ? "completed"
      : "processing";
  intake.updated_at = new Date().toISOString();

  if (body.status === "failed") {
    addReviewCaseRecord(db, {
      intake_id: intake.intake_id,
      order_id: intake.order_id,
      external_order_id: intake.external_order_id,
      reason: "upload_failed",
      source_workflow: "Gmail - Adding the orders",
      source_node: "Upload Email Attachment",
      summary: `Could not store ${file.original_filename}`,
      error_message: body.error ?? null,
      dedupe_key: `${intake.intake_id}:${file.attachment_key}:upload_failed`,
      context: {
        customer_notes: intake.customer_notes,
        sender: intake.sender,
        subject: intake.subject,
        original_filename: file.original_filename,
      },
    });
  }

  writeDB(db);
  res.json({ intake, file });
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
