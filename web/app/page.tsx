"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import RobotFace, { type RobotState } from "@/components/RobotFace";

type Source = { book: string; page: number; image_url: string; score: number };

const STARTERS = [
  "Where are combat aircraft? Show me the pages.",
  "How do you identify or recognize an aircraft?",
  "How does a turbofan engine work?",
  "What are the main parts of a reciprocating engine?",
];

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const waiting = status === "submitted"; // before the first token streams

  // Drive the robot's expression from the chat state.
  const robotState: RobotState =
    status === "streaming" ? "talking" : status === "submitted" ? "thinking" : "neutral";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="chat-container">
      <div className="robot-zone">
        <RobotFace state={robotState} />
      </div>

      <header className="chat-header">
        <h1>Visual RAG Agent</h1>
        <p>
          An agentic <b>visual RAG</b>: it reads the actual document pages (figures and
          diagrams included) and answers with the source pages cited.
        </p>
      </header>

      <div className="messages-area">
        {messages.length === 0 && (
          <div className="welcome">
            <p className="welcome-corpus">
              📚 Indexed corpus: <b>US Army — Visual Aircraft Recognition</b> and the{" "}
              <b>FAA Aviation Maintenance — Powerplant Handbook</b>. Ask about aircraft
              identification/recognition or aircraft engines — the agent finds the
              relevant pages and answers from what they actually show.
            </p>
            <div className="starters-label">Try asking</div>
            <div className="starters">
              {STARTERS.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="starter-btn"
                  onClick={() => !busy && sendMessage({ text: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`message ${m.role}`}>
            {m.parts.map((p, i) => {
              if (p.type === "text") return <span key={i}>{p.text}</span>;
              if (p.type === "data-sources") {
                const sources = (p as { data: Source[] }).data;
                return (
                  <div className="sources" key={i}>
                    <div className="sources-label">Source pages</div>
                    <div className="thumbs">
                      {sources.map((s, j) => (
                        <a key={j} href={s.image_url} target="_blank" rel="noreferrer" className="thumb">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.image_url} alt={`${s.book} p.${s.page}`} />
                          <span>{s.book} · p.{s.page}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}

        {waiting && (
          <div className="thinking-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
      </div>

      <form className="composer-area" onSubmit={onSubmit}>
        <div className="composer">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the documents…"
            disabled={busy}
          />
          <button className="send-btn" type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
