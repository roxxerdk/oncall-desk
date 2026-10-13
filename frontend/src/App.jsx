import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Send, Volume2 } from "lucide-react";
import "./App.css";

const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready to connect");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const messagesRef = useRef([]);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      recognitionRef.current?.stop();
      window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!active) return;

    const timer = window.setInterval(
      () => setSeconds((value) => value + 1),
      1000
    );

    return () => window.clearInterval(timer);
  }, [active]);

  function addMessage(message) {
    messagesRef.current = [...messagesRef.current, message];
    setMessages(messagesRef.current);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function endCall() {
    activeRef.current = false;
    busyRef.current = false;
    setActive(false);
    setBusy(false);
    setListening(false);
    setStatus("Call ended");
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    window.speechSynthesis.cancel();
  }

  async function sendMessage(text) {
    const message = text.trim();

    if (!message || busyRef.current) return;

    stopListening();
    setError("");
    busyRef.current = true;
    setBusy(true);
    setStatus("Aria is thinking…");

    const history = messagesRef.current
      .filter((item) => item.role === "user" || item.role === "assistant")
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));

    addMessage({ role: "user", content: message });

    try {
      const response = await fetch("/api/ai/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "AI request failed");
      }

      if (!mountedRef.current || !activeRef.current) return;

      addMessage({ role: "assistant", content: data.reply });

      const utterance = new SpeechSynthesisUtterance(data.reply);
      utterance.lang = "en-IN";
      utterance.rate = 1;

      utterance.onstart = () => setStatus("Aria is speaking");
      utterance.onend = () => {
        busyRef.current = false;
        setBusy(false);

        if (activeRef.current) {
          setStatus("Listening for your next message");
          startListening();
        }
      };
      utterance.onerror = () => {
        busyRef.current = false;
        setBusy(false);

        if (activeRef.current) {
          setStatus("Speech playback unavailable");
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      busyRef.current = false;
      setBusy(false);

      if (mountedRef.current && activeRef.current) {
        setError(err.message || "Unable to contact Aria");
        setStatus("Something went wrong");
      }
    }
  }

  function startListening() {
    if (
      !activeRef.current ||
      busyRef.current ||
      !SpeechRecognition ||
      recognitionRef.current
    ) {
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;

    let finalTranscript = "";

    recognition.onstart = () => {
      if (!activeRef.current) {
        recognition.abort();
        return;
      }

      setListening(true);
      setStatus("Listening…");
    };

    recognition.onresult = (event) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += `${text} `;
        } else {
          interim += text;
        }
      }

      setInput(finalTranscript + interim);
    };

    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was denied."
          : `Speech recognition error: ${event.error}`
      );
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;

      const text = finalTranscript.trim();

      if (activeRef.current && text && !busyRef.current) {
        setInput("");
        void sendMessage(text);
      } else if (activeRef.current && !busyRef.current) {
        setStatus("Listening stopped. Tap the microphone to try again.");
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setError("Could not start speech recognition. Try again.");
    }
  }

  function startCall() {
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }

    window.speechSynthesis.cancel();
    messagesRef.current = [];
    setMessages([]);
    setInput("");
    setError("");
    setSeconds(0);
    activeRef.current = true;
    busyRef.current = false;
    setActive(true);
    setBusy(false);
    setStatus("Starting your conversation…");
    startListening();
  }

  function formatTime(total) {
    const minutes = Math.floor(total / 60);
    const secs = total % 60;

    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="OnCall Desk home">
          <span className="brand-icon"><Phone size={19} /></span>
          <span>OnCall<span className="brand-light">Desk</span></span>
        </a>
        <span className="environment-label">VOICE ASSISTANT</span>
      </header>

      <section className="voice-layout">
        <div className="assistant-panel">
          <div className={`orb ${active ? "orb-active" : ""} ${listening ? "orb-listening" : ""}`}>
            <div className="orb-inner">
              <Volume2 size={34} />
            </div>
          </div>

          <p className="eyebrow">YOUR AI ASSISTANT</p>
          <h1>Meet Aria.</h1>
          <p className="subtitle">
            A natural voice conversation, right from your browser.
          </p>

          <div className="status-pill">
            <span className={`status-dot ${active ? "dot-live" : ""}`} />
            {status}
          </div>

          {active && (
            <p className="call-timer">{formatTime(seconds)}</p>
          )}

          <div className="call-controls">
            {!active ? (
              <button className="call-button" onClick={startCall}>
                <Phone size={19} />
                Start AI call
              </button>
            ) : (
              <>
                <button
                  className={`mic-button ${listening ? "mic-active" : ""}`}
                  onClick={() => {
                    if (listening) {
                      stopListening();
                    } else {
                      startListening();
                    }
                  }}
                  disabled={busy}
                  aria-label={listening ? "Stop listening" : "Start listening"}
                >
                  {listening ? <Mic size={21} /> : <MicOff size={21} />}
                </button>

                <button className="end-button" onClick={endCall}>
                  <PhoneOff size={19} />
                  End call
                </button>
              </>
            )}
          </div>

          <p className="privacy-note">
            Your microphone is used only after you start a call.
          </p>
          {error && <p className="error-message" role="alert">{error}</p>}
        </div>

        <section className="transcript-panel" aria-label="Conversation transcript">
          <div className="transcript-heading">
            <div>
              <p className="eyebrow">LIVE CONVERSATION</p>
              <h2>Transcript</h2>
            </div>
            <span className="message-count">{messages.length} messages</span>
          </div>

          <div className="messages" aria-live="polite">
            {messages.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><Mic size={24} /></div>
                <h3>Your conversation starts here</h3>
                <p>Start a call and speak naturally to Aria.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={index}>
                  <span className="message-role">
                    {message.role === "assistant" ? "ARIA" : "YOU"}
                  </span>
                  <p>{message.content}</p>
                </article>
              ))
            )}
            {busy && <p className="typing-indicator">Aria is preparing a response…</p>}
          </div>

          <form
            className="message-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!activeRef.current) {
                setError("Start an AI call before sending a message.");
                return;
              }

              const text = input.trim();
              if (text && !busyRef.current) {
                setInput("");
                void sendMessage(text);
              }
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a message to Aria…"
              aria-label="Message to Aria"
              maxLength={2000}
              disabled={busy}
            />
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() || busy}
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </form>
          <p className="input-hint">Typed messages are available as a fallback.</p>
        </section>
      </section>

      <footer className="footer">
        <span>ONCALL DESK</span>
        <span>AI voice interface · Development build</span>
      </footer>
    </main>
  );
}
