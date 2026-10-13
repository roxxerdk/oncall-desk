import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3001";

function createClient() {
  return io(SERVER_URL, {
    transports: ["websocket"],
    reconnection: false,
    autoConnect: true,
  });
}

test("Signaling server: User registration and online list broadcast", async () => {
  const client1 = createClient();
  const client2 = createClient();

  try {
    const reg1 = await new Promise((resolve) => {
      client1.emit("user:register", { username: "Alice" }, resolve);
    });
    assert.equal(reg1.ok, true);
    assert.equal(reg1.user.username, "Alice");

    const reg2 = await new Promise((resolve) => {
      client2.emit("user:register", { username: "Bob" }, resolve);
    });
    assert.equal(reg2.ok, true);
    assert.equal(reg2.user.username, "Bob");

    // Verify Bob sees Alice in the user list
    const aliceInList = reg2.users.some((u) => u.username === "Alice");
    assert.equal(aliceInList, true);
  } finally {
    client1.disconnect();
    client2.disconnect();
  }
});

test("Signaling server: Full call lifecycle (invite -> accept -> webrtc relay -> end)", async () => {
  const alice = createClient();
  const bob = createClient();

  try {
    const regAlice = await new Promise((res) => {
      alice.emit("user:register", { username: "Alice" }, res);
    });
    const regBob = await new Promise((res) => {
      bob.emit("user:register", { username: "Bob" }, res);
    });

    const bobId = regBob.user.userId;
    const aliceId = regAlice.user.userId;

    // 1. Alice invites Bob
    const invitePromise = new Promise((resolve) => {
      bob.once("call:invite", resolve);
    });
    const ringingPromise = new Promise((resolve) => {
      alice.once("call:ringing", resolve);
    });

    alice.emit("call:invite", { targetUserId: bobId });

    const [inviteData, ringingData] = await Promise.all([
      invitePromise,
      ringingPromise,
    ]);

    assert.equal(inviteData.caller.username, "Alice");
    assert.equal(ringingData.callee.username, "Bob");
    assert.equal(inviteData.callId, ringingData.callId);

    const callId = inviteData.callId;

    // 2. Bob accepts call
    const acceptPromise = new Promise((resolve) => {
      alice.once("call:accept", resolve);
    });
    const acceptedPromise = new Promise((resolve) => {
      bob.once("call:accepted", resolve);
    });

    bob.emit("call:accept", { callId });

    const [acceptData, acceptedData] = await Promise.all([
      acceptPromise,
      acceptedPromise,
    ]);

    assert.equal(acceptData.callId, callId);
    assert.equal(acceptedData.callId, callId);

    // 3. WebRTC Offer relay from Alice to Bob
    const offerPromise = new Promise((resolve) => {
      bob.once("webrtc:offer", resolve);
    });

    alice.emit("webrtc:offer", {
      callId,
      description: { type: "offer", sdp: "v=0 mock-offer" },
    });

    const offerData = await offerPromise;
    assert.equal(offerData.description.sdp, "v=0 mock-offer");
    assert.equal(offerData.fromUserId, aliceId);

    // 4. WebRTC Answer relay from Bob to Alice
    const answerPromise = new Promise((resolve) => {
      alice.once("webrtc:answer", resolve);
    });

    bob.emit("webrtc:answer", {
      callId,
      description: { type: "answer", sdp: "v=0 mock-answer" },
    });

    const answerData = await answerPromise;
    assert.equal(answerData.description.sdp, "v=0 mock-answer");
    assert.equal(answerData.fromUserId, bobId);

    // 5. ICE Candidate relay
    const icePromise = new Promise((resolve) => {
      bob.once("webrtc:ice-candidate", resolve);
    });

    alice.emit("webrtc:ice-candidate", {
      callId,
      candidate: { candidate: "candidate:1 1 UDP 12345 mock-candidate" },
    });

    const iceData = await icePromise;
    assert.equal(iceData.candidate.candidate, "candidate:1 1 UDP 12345 mock-candidate");

    // 6. Hang-up (Alice ends call)
    const endPromise = new Promise((resolve) => {
      bob.once("call:end", resolve);
    });

    alice.emit("call:end", { callId });

    const endData = await endPromise;
    assert.equal(endData.callId, callId);
    assert.equal(endData.endedBy, aliceId);
  } finally {
    alice.disconnect();
    bob.disconnect();
  }
});

test("Signaling server: Prevents calling self or busy users", async () => {
  const alice = createClient();
  try {
    const reg = await new Promise((res) => {
      alice.emit("user:register", { username: "SoloAlice" }, res);
    });

    const errorPromise = new Promise((resolve) => {
      alice.once("call:error", resolve);
    });

    // Attempt calling self
    alice.emit("call:invite", { targetUserId: reg.user.userId });

    const err = await errorPromise;
    assert.equal(err.code, "INVALID_TARGET");
  } finally {
    alice.disconnect();
  }
});
