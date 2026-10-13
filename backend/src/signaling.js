import { randomUUID } from "node:crypto";

export function registerSignaling(io) {
  // Connected users are indexed by their socket IDs
  const users = new Map();
  const calls = new Map();

  function publicUsers() {
    return [...users.entries()].map(([userId, user]) => ({
      userId,
      username: user.username,
    }));
  }

  function broadcastUsers() {
    io.emit("users:list", publicUsers());
  }

  function sendError(socket, code, message) {
    socket.emit("call:error", { code, message });
  }

  function getCallForSocket(socket, callId) {
    const call = calls.get(callId);
    if (!call) return null;

    if (call.callerId !== socket.id && call.calleeId !== socket.id) {
      return null;
    }

    return call;
  }

  function endCall(callId, endedBy, reason = "ended") {
    const call = calls.get(callId);
    if (!call) return;

    if (call.ringTimeout) {
      clearTimeout(call.ringTimeout);
    }

    calls.delete(callId);

    const payload = { callId, endedBy, reason };

    if (endedBy === "server") {
      io.to(call.callerId).emit("call:end", payload);
      io.to(call.calleeId).emit("call:end", payload);
      return;
    }

    const otherId =
      endedBy === call.callerId ? call.calleeId : call.callerId;

    io.to(otherId).emit("call:end", payload);
  }

  io.on("connection", (socket) => {
    // 1. User Registration & Directory Presence
    socket.on("user:register", (payload = {}, acknowledge) => {
      const username =
        typeof payload.username === "string"
          ? payload.username.trim().slice(0, 32)
          : "";

      if (!username) {
        const result = {
          ok: false,
          error: "A username between 1 and 32 characters is required.",
        };

        if (typeof acknowledge === "function") acknowledge(result);
        else sendError(socket, "INVALID_USERNAME", result.error);
        return;
      }

      users.set(socket.id, { username, registeredAt: Date.now() });

      const result = {
        ok: true,
        user: { userId: socket.id, username },
        users: publicUsers(),
      };

      if (typeof acknowledge === "function") acknowledge(result);

      socket.emit("users:list", result.users);
      broadcastUsers();
    });

    // 2. Outgoing Call Invitation
    socket.on("call:invite", (payload = {}) => {
      const caller = users.get(socket.id);
      const calleeId = payload.targetUserId;

      if (!caller) {
        return sendError(socket, "NOT_REGISTERED", "Register before calling.");
      }

      if (typeof calleeId !== "string" || calleeId === socket.id) {
        return sendError(socket, "INVALID_TARGET", "Choose another online user.");
      }

      const callee = users.get(calleeId);

      if (!callee) {
        return sendError(socket, "USER_OFFLINE", "That user is not online.");
      }

      const isBusy = [...calls.values()].some(
        (call) =>
          call.status !== "ended" &&
          ([call.callerId, call.calleeId].includes(socket.id) ||
            [call.callerId, call.calleeId].includes(calleeId))
      );

      if (isBusy) {
        return sendError(
          socket,
          "USER_BUSY",
          "One of the participants is already in a call."
        );
      }

      const callId = randomUUID();

      // Ring timeout: Auto-expire unanswered call after 60 seconds
      const ringTimeout = setTimeout(() => {
        if (calls.has(callId) && calls.get(callId).status === "ringing") {
          endCall(callId, "server", "timeout-no-answer");
        }
      }, 60000);

      const call = {
        callId,
        callerId: socket.id,
        calleeId,
        status: "ringing",
        ringTimeout,
        createdAt: Date.now(),
      };

      calls.set(callId, call);

      io.to(calleeId).emit("call:invite", {
        callId,
        caller: { userId: socket.id, username: caller.username },
      });

      socket.emit("call:ringing", {
        callId,
        callee: { userId: calleeId, username: callee.username },
      });
    });

    // 3. Call Acceptance
    socket.on("call:accept", (payload = {}) => {
      const call = getCallForSocket(socket, payload.callId);

      if (!call || call.calleeId !== socket.id || call.status !== "ringing") {
        return sendError(socket, "INVALID_CALL", "This call cannot be accepted.");
      }

      if (call.ringTimeout) {
        clearTimeout(call.ringTimeout);
        call.ringTimeout = null;
      }

      call.status = "accepted";

      io.to(call.callerId).emit("call:accept", {
        callId: call.callId,
        userId: socket.id,
      });

      socket.emit("call:accepted", {
        callId: call.callId,
        userId: call.callerId,
      });
    });

    // 4. Call Rejection
    socket.on("call:reject", (payload = {}) => {
      const call = getCallForSocket(socket, payload.callId);

      if (!call || call.calleeId !== socket.id || call.status !== "ringing") {
        return sendError(socket, "INVALID_CALL", "This call cannot be rejected.");
      }

      if (call.ringTimeout) {
        clearTimeout(call.ringTimeout);
      }

      calls.delete(call.callId);

      io.to(call.callerId).emit("call:reject", {
        callId: call.callId,
        userId: socket.id,
      });
    });

    // 5. End Call / Hang-up
    socket.on("call:end", (payload = {}) => {
      const call = getCallForSocket(socket, payload.callId);

      if (!call) {
        return sendError(socket, "INVALID_CALL", "Call not found.");
      }

      endCall(call.callId, socket.id);
    });

    // 6. WebRTC Signaling Relays (Offer, Answer, ICE Candidates)
    for (const eventName of [
      "webrtc:offer",
      "webrtc:answer",
      "webrtc:ice-candidate",
    ]) {
      socket.on(eventName, (payload = {}) => {
        const call = getCallForSocket(socket, payload.callId);

        if (!call || call.status !== "accepted") {
          return sendError(
            socket,
            "INVALID_CALL",
            "WebRTC signaling requires an accepted call."
          );
        }

        const targetId =
          socket.id === call.callerId ? call.calleeId : call.callerId;

        const field =
          eventName === "webrtc:ice-candidate"
            ? "candidate"
            : "description";

        // Validate payload content (allows null candidate for WebRTC end-of-candidates)
        if (
          payload[field] === undefined ||
          (payload[field] !== null && typeof payload[field] !== "object")
        ) {
          return sendError(socket, "INVALID_SIGNAL", `Missing or invalid ${field}.`);
        }

        io.to(targetId).emit(eventName, {
          callId: call.callId,
          [field]: payload[field],
          fromUserId: socket.id,
        });
      });
    }

    // 7. Disconnection Cleanup
    socket.on("disconnect", () => {
      users.delete(socket.id);

      for (const call of [...calls.values()]) {
        if (call.callerId === socket.id || call.calleeId === socket.id) {
          endCall(call.callId, "server", "participant-disconnected");
        }
      }

      broadcastUsers();
    });
  });
}
