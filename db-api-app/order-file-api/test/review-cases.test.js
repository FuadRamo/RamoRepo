const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");

const appDirectory = path.join(__dirname, "..");
const seedPath = path.join(appDirectory, "db.seed.json");
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "order-file-api-test-"));
const testDatabasePath = path.join(tempDirectory, "db.json");
process.env.DB_PATH = testDatabasePath;

const app = require("../server");
let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  fs.copyFileSync(seedPath, testDatabasePath);
});

after(() => {
  server.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json();
  return { response, body };
}

function reviewPayload(overrides = {}) {
  return {
    job_id: "JOB_789",
    order_id: "ORD_456",
    external_order_id: "260727QURVFYCT",
    attachment_id: "ATT_123",
    reason: "uncertain_file_match",
    source_workflow: "Downloading attchments to NAS",
    source_node: "Needs Human Review?",
    summary: "The attachment could not be matched confidently",
    confidence: 0.45,
    context: { platform: "shopee" },
    ...overrides,
  };
}

async function createReviewCase(overrides = {}) {
  return request("/api/review-cases", {
    method: "POST",
    body: JSON.stringify(reviewPayload(overrides)),
  });
}

test("browser preflight requests are allowed", async () => {
  const response = await fetch(`${baseUrl}/api/review-cases`, { method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(response.headers.get("access-control-allow-methods"), /PATCH/);
});

test("creating a review case returns 201", async () => {
  const { response, body } = await createReviewCase();
  assert.equal(response.status, 201);
  assert.equal(body.created, true);
  assert.match(body.review_case.review_id, /^REV_[A-F0-9]{32}$/);
  assert.equal(body.review_case.status, "open");
  assert.equal(body.review_case.priority, "normal");
});

test("creating a linked case moves the file job to human_review", async () => {
  await createReviewCase();
  const { response, body } = await request("/api/file-jobs/JOB_789");
  assert.equal(response.status, 200);
  assert.equal(body.status, "human_review");
  assert.equal(body.error, "The attachment could not be matched confidently");
  assert.ok(body.updated_at);
});

test("an unresolved duplicate is returned without another insert", async () => {
  const first = await createReviewCase({ dedupe_key: "stable-key" });
  const second = await createReviewCase({ dedupe_key: "stable-key" });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.created, false);
  assert.equal(second.body.review_case.review_id, first.body.review_case.review_id);

  const database = JSON.parse(fs.readFileSync(testDatabasePath, "utf8"));
  assert.equal(database.review_cases.length, 1);
});

test("an invalid reason returns 400", async () => {
  const { response } = await createReviewCase({ reason: "not_supported" });
  assert.equal(response.status, 400);
});

test("confidence outside 0 through 1 returns 400", async () => {
  for (const confidence of [-0.01, 1.01]) {
    const { response } = await createReviewCase({ confidence });
    assert.equal(response.status, 400);
  }
});

test("an unknown job_id returns 404", async () => {
  const { response } = await createReviewCase({ job_id: "JOB_UNKNOWN" });
  assert.equal(response.status, 404);
});

test("list filters return only matching review cases", async () => {
  await createReviewCase({ dedupe_key: "first", priority: "high" });
  await createReviewCase({
    job_id: "JOB_790",
    attachment_id: "ATT_124",
    reason: "missing_order_information",
    priority: "urgent",
    dedupe_key: "second",
  });

  const { response, body } = await request(
    "/api/review-cases?reason=missing_order_information&priority=urgent&job_id=JOB_790"
  );
  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].attachment_id, "ATT_124");
});

test("one review case can be fetched by review_id", async () => {
  const created = await createReviewCase();
  const reviewId = created.body.review_case.review_id;
  const { response, body } = await request(`/api/review-cases/${reviewId}`);
  assert.equal(response.status, 200);
  assert.equal(body.review_id, reviewId);
});

test("status and reviewer information can be updated", async () => {
  const created = await createReviewCase();
  const reviewId = created.body.review_case.review_id;
  const { response, body } = await request(`/api/review-cases/${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "in_review",
      assigned_to: "reviewer@example.com",
      reviewer_notes: "Checking the source file",
      corrected_data: { order_item_id: "ITEM_01" },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.status, "in_review");
  assert.equal(body.assigned_to, "reviewer@example.com");
  assert.equal(body.reviewer_notes, "Checking the source file");
  assert.deepEqual(body.corrected_data, { order_item_id: "ITEM_01" });
});

test("terminal statuses set resolved_at and reopening clears it", async () => {
  const created = await createReviewCase();
  const reviewId = created.body.review_case.review_id;
  const resolved = await request(`/api/review-cases/${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", resolution: "Matched manually" }),
  });
  assert.ok(resolved.body.resolved_at);

  const reopened = await request(`/api/review-cases/${reviewId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "waiting_customer" }),
  });
  assert.equal(reopened.body.resolved_at, null);
});
