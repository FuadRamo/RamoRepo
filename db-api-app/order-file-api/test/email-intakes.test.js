const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const appDirectory = path.join(__dirname, "..");
const seedPath = path.join(appDirectory, "db.seed.json");
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "email-intake-test-"));
const testDatabasePath = path.join(tempDirectory, "db.json");
process.env.DB_PATH = testDatabasePath;

const app = require("../server");
let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => fs.copyFileSync(seedPath, testDatabasePath));
after(() => {
  server.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  return { response, body: await response.json() };
}

function intakePayload(overrides = {}) {
  return {
    gmail_message_id: "gmail-message-1",
    gmail_thread_id: "gmail-thread-1",
    sender: "Ali <ali@example.com>",
    subject: "Artwork for order #260727QURVFYCT",
    intent: "order_submission",
    extracted_order_id: "Order ID: 260727-QURVFYCT",
    customer_notes: "Remove the background and keep the logo blue.",
    extraction_confidence: 0.97,
    attachments: [
      {
        attachment_key: "attachment_0",
        original_filename: "customer-design.pdf",
        mime_type: "application/pdf",
        file_size: 1200,
      },
    ],
    ...overrides,
  };
}

test("an inquiry is stored without creating a missing-attachment review", async () => {
  const { response, body } = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(
      intakePayload({
        gmail_message_id: "gmail-inquiry-1",
        intent: "inquiry",
        inquiry_text: "How long does printing take?",
        extracted_order_id: null,
        customer_notes: "",
        attachments: [],
      })
    ),
  });
  assert.equal(response.status, 201);
  assert.equal(body.intake.intent, "inquiry");
  assert.equal(body.intake.status, "inquiry");
  assert.equal(body.intake.match_status, "not_applicable");

  const reviews = await request("/api/review-cases?intake_id=" + body.intake.intake_id);
  assert.equal(reviews.body.length, 0);
});

test("an unclassified email creates a customer-contact review", async () => {
  const { body } = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(
      intakePayload({
        gmail_message_id: "gmail-other-1",
        intent: "other",
        inquiry_text: "Unclear message",
        extracted_order_id: null,
        attachments: [],
      })
    ),
  });
  const reviews = await request(
    "/api/review-cases?intake_id=" + body.intake.intake_id
  );
  assert.equal(reviews.body.length, 1);
  assert.equal(reviews.body[0].reason, "customer_contact_required");
});

test("a Gmail intake matches a normalized external order ID", async () => {
  const { response, body } = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(intakePayload()),
  });
  assert.equal(response.status, 201);
  assert.equal(body.intake.match_status, "matched");
  assert.equal(body.intake.order_id, "ORD_456");
  assert.equal(body.intake.external_order_id, "260727QURVFYCT");
  assert.equal(body.intake.customer_notes, "Remove the background and keep the logo blue.");
  assert.equal(body.intake.status, "processing");
});

test("Gmail message IDs make intake creation idempotent", async () => {
  const first = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(intakePayload()),
  });
  const second = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(intakePayload()),
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.intake.intake_id, first.body.intake.intake_id);
});

test("an unknown order creates a visible human-review case with customer notes", async () => {
  const created = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(
      intakePayload({
        gmail_message_id: "gmail-message-unknown",
        extracted_order_id: "NOT-A-REAL-ORDER",
      })
    ),
  });
  assert.equal(created.body.intake.match_status, "unmatched");
  assert.equal(created.body.intake.status, "needs_review");

  const reviews = await request("/api/review-cases?reason=missing_order_information");
  assert.equal(reviews.body.length, 1);
  assert.equal(reviews.body[0].intake_id, created.body.intake.intake_id);
  assert.equal(
    reviews.body[0].context.customer_notes,
    "Remove the background and keep the logo blue."
  );
});

test("a message without files creates a no-attachment review", async () => {
  const created = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(
      intakePayload({ gmail_message_id: "gmail-message-empty", attachments: [] })
    ),
  });
  assert.equal(created.body.intake.status, "needs_review");
  const reviews = await request("/api/review-cases?reason=no_attachment");
  assert.equal(reviews.body.length, 1);
});

test("stored file results complete an intake", async () => {
  const created = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(intakePayload()),
  });
  const intakeId = created.body.intake.intake_id;
  const updated = await request(`/api/email-intakes/${intakeId}/files`, {
    method: "POST",
    body: JSON.stringify({
      attachment_key: "attachment_0",
      status: "stored",
      final_filename: "customer-design.pdf",
      nas_path: "Orders/email/260727QURVFYCT/INCOMING/customer-design.pdf",
      checksum_sha256: "abc123",
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.intake.status, "completed");
  assert.equal(updated.body.file.status, "stored");
});

test("failed file storage creates an upload review", async () => {
  const created = await request("/api/email-intakes", {
    method: "POST",
    body: JSON.stringify(intakePayload()),
  });
  const intakeId = created.body.intake.intake_id;
  await request(`/api/email-intakes/${intakeId}/files`, {
    method: "POST",
    body: JSON.stringify({
      attachment_key: "attachment_0",
      status: "failed",
      error: "receiver unavailable",
    }),
  });
  const reviews = await request("/api/review-cases?reason=upload_failed");
  assert.equal(reviews.body.length, 1);
  assert.equal(reviews.body[0].intake_id, intakeId);
});
