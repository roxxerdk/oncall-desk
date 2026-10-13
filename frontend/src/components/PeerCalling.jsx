import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  Check,
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  UserRound,
  Users,
  X,
} from "lucide-react";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
];

export default function PeerCalling({ onBack }) {
  const [username, setUsername] = useState(
    () => sessionStorage.getItem("oncall-username") || ""
  );
  const [draftName, setDraftName] = useState(
    () => sessionStorage.getItem("oncall-username") || ""
  );
  const [registered, setRegistered] = useState(false);
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState("Connect to see online users");
  const [error, setError] = useState("");
  const [incoming, setIncoming] = useState(null);
  const [call, setCall] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const callRef = useRef(null);
  const phaseRef = useRef("idle");
  const pendingCandidatesRef = useRef([]);
  const mountedRef = useRef(false);

  const setCallPhase = useCallback((next) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const formatTime = (total) =>
    `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
      total % 60
    ).padStart(2, "0")}`;

  const closePeerConnection = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    pendingCandidatesRef.current = [];
    setMuted(false);
  }, []);

  const resetCall = useCallback(
    (message = "Ready to call") => {
      closePeerConnection();
      callRef.current = null;
      setCall(null);
      setIncoming(null);
      setSeconds(0);
      setCallPhase("idle");
      setStatus(message);
    },
    [closePeerConnection, setCallPhase]
  );

  const createPeerConnection = useCallback(
    (callId) => {
      if (pcRef.current) return pcRef.current;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("webrtc:ice-candidate", {
            callId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const stream =
          event.streams?.[0] || new MediaStream([event.track]);

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch(() => {
            setStatus("Connected. Tap play if audio is blocked.");
          });
        }

        setStatus("Connected — live audio");
        setCallPhase("active");
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setStatus("Connected — live audio");
          setCallPhase("active");
        } else if (pc.connectionState === "failed") {
          setError("WebRTC connection failed. Check the network and try again.");
          resetCall("Connection failed");
        } else if (pc.connectionState === "disconnected") {
          setStatus("Connection interrupted…");
        }
      };

      return pc;
    },
    [resetCall, setCallPhase]
  );

  const ensureLocalAudio = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone access requires HTTPS or localhost.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    localStreamRef.current = stream;
    return stream;
  }, []);

  const addLocalTracks = useCallback(async (pc) => {
    const stream = await ensureLocalAudio();

    for (const track of stream.getAudioTracks()) {
      const alreadyAdded = pc.getSenders().some(
        (sender) => sender.track === track
      );

      if (!alreadyAdded) pc.addTrack(track, stream);
    }
  }, [ensureLocalAudio]);

  const flushCandidates = useCallback(async (pc) => {
    const candidates = pendingCandidatesRef.current.splice(0);

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Unable to apply queued ICE candidate:", err);
      }
    }
  }, []);

  const makeOffer = useCallback(async (callId) => {
    try {
      const pc = createPeerConnection(callId);
      await addLocalTracks(pc);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current.emit("webrtc:offer", {
        callId,
        description: pc.localDescription,
      });

      setStatus("Connecting audio…");
    } catch (err) {
      setError(err.message || "Could not start the call.");
      socketRef.current?.emit("call:end", { callId });
      resetCall("Call could not start");
    }
  }, [addLocalTracks, createPeerConnection, resetCall]);

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;

    setError("");
    try {
      await ensureLocalAudio();

      const currentCall = incoming;
      callRef.current = { callId: currentCall.callId, peer: currentCall.caller };
      setCall(callRef.current);

      const pc = createPeerConnection(currentCall.callId);
      await addLocalTracks(pc);

      socketRef.current.emit("call:accept", {
        callId: currentCall.callId,
      });

      setIncoming(null);
      setCallPhase("connecting");
      setStatus(`Connecting to ${currentCall.caller.username}…`);
    } catch (err) {
      setError(err.message || "Microphone access failed.");
      socketRef.current?.emit("call:reject", {
        callId: incoming.callId,
      });
      resetCall("Microphone unavailable");
    }
  }, [
    addLocalTracks,
    createPeerConnection,
    ensureLocalAudio,
    incoming,
    resetCall,
    setCallPhase,
  ]);

  const rejectIncoming = useCallback(() => {
    if (incoming) {
      socketRef.current?.emit("call:reject", {
        callId: incoming.callId,
      });
    }
    setIncoming(null);
    setStatus("Incoming call declined");
  }, [incoming]);

  const startCall = useCallback(async (peer) => {
    setError("");

    try {
      await ensureLocalAudio();

      socketRef.current.emit("call:invite", {
        targetUserId: peer.userId,
      });

      setCall({ peer });
      callRef.current = { peer };
      setCallPhase("outgoing");
      setStatus(`Calling ${peer.username}…`);
    } catch (err) {
      setError(err.message || "Microphone access failed.");
      closePeerConnection();
    }
  }, [closePeerConnection, ensureLocalAudio, setCallPhase]);

  const hangUp = useCallback(() => {
    const current = callRef.current || call;

    if (current?.callId) {
      socketRef.current?.emit("call:end", {
        callId: current.callId,
      });
    }

    resetCall("Call ended");
  }, [call, resetCall]);

  const toggleMute = () => {
    const nextMuted = !muted;

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }

    if (pcRef.current) {
      pcRef.current.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "audio") {
          sender.track.enabled = !nextMuted;
        }
      });
    }

    setMuted(nextMuted);
  };

  useEffect(() => {
    mountedRef.current = true;
    const socket = io("/", { path: "/socket.io" });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Connected to calling server");
      if (username.trim()) {
        socket.emit("user:register", { username: username.trim() }, (result) => {
          if (result?.ok && mountedRef.current) {
            setRegistered(true);
            setUsername(result.user.username);
            setUsers(result.users || []);
          } else if (result && !result.ok) {
            setError(result.error || "Registration failed.");
          }
        });
      }
    });

    socket.on("disconnect", () => {
      if (!mountedRef.current) return;
      setRegistered(false);
      setUsers([]);
      resetCall("Disconnected from calling server");
    });

    socket.on("users:list", (list) => {
      if (mountedRef.current) {
        setUsers(Array.isArray(list) ? list : []);
      }
    });

    socket.on("call:ringing", ({ callId, callee }) => {
      callRef.current = { callId, peer: callee };
      setCall(callRef.current);
      setStatus(`Calling ${callee?.username || "peer"}…`);
    });

    socket.on("call:invite", ({ callId, caller }) => {
      setIncoming({ callId, caller });
      setStatus(`Incoming call from ${caller?.username || "peer"}`);
    });

    socket.on("call:accept", async ({ callId }) => {
      callRef.current = { ...(callRef.current || {}), callId };
      setCall(callRef.current);
      setCallPhase("connecting");
      await makeOffer(callId);
    });

    socket.on("call:accepted", ({ callId }) => {
      callRef.current = { ...(callRef.current || {}), callId };
      setCall(callRef.current);
      setCallPhase("connecting");
      setStatus("Call accepted — connecting audio…");
    });

    socket.on("call:reject", () => resetCall("Call declined"));

    socket.on("call:end", ({ reason }) => {
      resetCall(reason === "participant-disconnected"
        ? "The other user disconnected"
        : "Call ended");
    });

    socket.on("webrtc:offer", async ({ callId, description }) => {
      try {
        const pc = createPeerConnection(callId);
        await addLocalTracks(pc);
        await pc.setRemoteDescription(new RTCSessionDescription(description));
        await flushCandidates(pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          callId,
          description: pc.localDescription,
        });
        setStatus("Answer sent — connecting audio…");
      } catch (err) {
        setError(err.message || "Could not answer the WebRTC offer.");
        socket.emit("call:end", { callId });
        resetCall("Negotiation failed");
      }
    });

    socket.on("webrtc:answer", async ({ callId, description }) => {
      try {
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== "have-local-offer") return;

        await pc.setRemoteDescription(new RTCSessionDescription(description));
        await flushCandidates(pc);
        setStatus("Answer received — connecting audio…");
      } catch (err) {
        setError(err.message || "Could not apply the WebRTC answer.");
        socket.emit("call:end", { callId });
        resetCall("Negotiation failed");
      }
    });

    socket.on("webrtc:ice-candidate", async ({ candidate }) => {
      const pc = pcRef.current;

      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn("Unable to apply ICE candidate:", err);
      }
    });

    socket.on("call:error", ({ message }) => {
      setError(message || "Calling error");
    });

    return () => {
      mountedRef.current = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      closePeerConnection();
    };
    // Socket lifecycle is established once per mounted component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!call?.callId || phase !== "active") return;
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [call?.callId, phase]);

  function registerUser(event) {
    event.preventDefault();
    const name = draftName.trim().slice(0, 32);
    if (!name) {
      setError("Enter a username between 1 and 32 characters.");
      return;
    }

    setError("");
    sessionStorage.setItem("oncall-username", name);
    setUsername(name);

    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Calling server is not connected. Try again.");
      return;
    }

    socket.emit("user:register", { username: name }, (result) => {
      if (!result?.ok) {
        setError(result?.error || "Registration failed.");
        return;
      }
      setUsername(result.user.username);
      setRegistered(true);
      setUsers(result.users || []);
      setStatus("Ready to call");
    });
  }

  const busy = phase !== "idle" || Boolean(incoming);

  return (
    <main className="app-shell peer-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => {
          event.preventDefault();
          onBack?.();
        }}>
          <span className="brand-icon"><Phone size={19} /></span>
          <span>OnCall<span className="brand-light">Desk</span></span>
        </a>
        <button className="peer-back-button" onClick={onBack}>
          <ArrowLeft size={16} /> Aria AI Voice
        </button>
      </header>

      <section className="peer-layout">
        <div className="peer-heading">
          <p className="eyebrow">BROWSER-TO-BROWSER AUDIO</p>
          <h1>Peer calling.</h1>
          <p className="subtitle">
            Talk live with another person using your browser microphone.
          </p>
        </div>

        {!registered ? (
          <form className="peer-card register-card" onSubmit={registerUser}>
            <div className="peer-card-icon"><UserRound size={24} /></div>
            <h2>Join the calling desk</h2>
            <p>Choose a display name so other online users can find you.</p>
            <label htmlFor="peer-username">Your display name</label>
            <input
              id="peer-username"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              maxLength={32}
              placeholder="e.g. Dhanush"
              autoComplete="nickname"
              required
            />
            <button className="peer-primary-button" type="submit">
              <Check size={18} /> Join online
            </button>
            <p className="peer-status">{status}</p>
          </form>
        ) : (
          <>
            <div className="peer-toolbar">
              <div>
                <span className="peer-avatar">{username.slice(0, 1).toUpperCase()}</span>
                <span className="peer-self-name">{username}</span>
                <span className="peer-online-dot" />
                <span className="peer-online-label">Online</span>
              </div>
              <div className="peer-count"><Users size={16} /> {users.length} online</div>
            </div>

            {incoming && (
              <div className="incoming-banner">
                <div className="incoming-icon"><PhoneIncoming size={23} /></div>
                <div className="incoming-copy">
                  <strong>Incoming call</strong>
                  <span>{incoming.caller.username} is calling you</span>
                </div>
                <button className="peer-accept-button" onClick={acceptIncoming}>
                  <Phone size={17} /> Accept
                </button>
                <button className="peer-decline-button" onClick={rejectIncoming}>
                  <X size={18} /> Decline
                </button>
              </div>
            )}

            {busy && !incoming && (
              <div className="active-call-card">
                <div className="active-call-orb"><PhoneCall size={28} /></div>
                <p className="eyebrow">
                  {phase === "outgoing" ? "OUTGOING CALL" :
                    phase === "active" ? "LIVE AUDIO CALL" : "CONNECTING"}
                </p>
                <h2>{call?.peer?.username || "Peer"}</h2>
                <p className="peer-status">{status}</p>
                {phase === "active" && (
                  <p className="peer-timer">{formatTime(seconds)}</p>
                )}
                <div className="peer-call-actions">
                  {phase === "active" && (
                    <button
                      className={`peer-secondary-button ${muted ? "peer-muted-button" : ""}`}
                      onClick={toggleMute}
                    >
                      {muted ? <MicOff size={18} /> : <Mic size={18} />}
                      {muted ? "Unmute" : "Mute"}
                    </button>
                  )}
                  <button className="peer-hangup-button" onClick={hangUp}>
                    <PhoneOff size={18} />
                    {phase === "outgoing" ? "Cancel call" : "Hang up"}
                  </button>
                </div>
                <audio ref={remoteAudioRef} autoPlay playsInline />
              </div>
            )}

            {!busy && (
              <div className="peer-directory">
                <div className="peer-section-heading">
                  <div><p className="eyebrow">YOUR DIRECTORY</p><h2>Available people</h2></div>
                  <span>{users.filter((user) => user.userId !== socketRef.current?.id).length} peers</span>
                </div>
                {users.filter((user) => user.userId !== socketRef.current?.id).length === 0 ? (
                  <div className="peer-empty-state">
                    <div className="peer-card-icon"><Users size={24} /></div>
                    <h3>Waiting for someone to join</h3>
                    <p>Open this app in another browser or device and register a different name.</p>
                  </div>
                ) : (
                  <div className="peer-users-list">
                    {users
                      .filter((user) => user.userId !== socketRef.current?.id)
                      .map((user) => (
                        <div className="peer-user-row" key={user.userId}>
                          <span className="peer-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
                          <div className="peer-user-info">
                            <strong>{user.username}</strong>
                            <span><span className="peer-online-dot" /> Available</span>
                          </div>
                          <button className="peer-primary-button" onClick={() => startCall(user)}>
                            <Phone size={17} /> Call
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="peer-error" role="alert">{error}</p>}
      </section>

      <footer className="footer">
        <span>ONCALL DESK</span><span>Peer audio · WebRTC</span>
      </footer>
    </main>
  );
}
