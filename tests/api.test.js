import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3001";

test("Health check endpoint returns status 200 and expected payload", async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, "oncall-desk-backend");
});

test("AI endpoint rejects empty message with status 400", async () => {
  const res = await fetch(`${BASE_URL}/api/ai/voice-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /1–2000 characters|between 1 and 2,000 characters/);
});

test("AI endpoint rejects invalid history with status 400", async () => {
  const res = await fetch(`${BASE_URL}/api/ai/voice-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Hello",
      history: [{ role: "hacker", content: "malicious" }],
    }),
  });
  assert.equal(res.status, 400);
});

test("AI endpoint processes valid typed message and returns natural response", async () => {
  const res = await fetch(`${BASE_URL}/api/ai/voice-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Testing typed text fallback message. Please respond with exactly: Affirmative.",
      history: [],
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.reply && data.reply.length > 0, "Expected non-empty reply");
  assert.ok(data.usage && data.usage.output_tokens > 0, "Expected token usage");
});
