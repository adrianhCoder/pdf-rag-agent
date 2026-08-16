"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import RobotFace, { type RobotState } from "@/components/RobotFace";

type Source = { book: string; page: number; image_url: string; score: number };

const BLOB = "https://9c8zzkmp2kpc5vxu.public.blob.vercel-storage.com/pages";
const PDFS = "https://9c8zzkmp2kpc5vxu.public.blob.vercel-storage.com/books";

const BOOKS = [
  {
    title: "Visual Aircraft Recognition",
    sub: "US Army · FM 3-01.80 — aircraft identification",
    cover: `${BLOB}/US_Army_Aircraft_Recognition/p0001.png`,
    pdf: `${PDFS}/US_Army_Aircraft_Recognition.pdf`,
  },
  {
    title: "Powerplant Handbook",
    sub: "FAA · FAA-H-8083-32 — aircraft engines",
    cover: `${BLOB}/FAA_Powerplant_Handbook/p0001.png`,
    pdf: `${PDFS}/FAA_Powerplant_Handbook.pdf`,
  },
];

const STARTERS = [
  "What does the MiG-29 Fulcrum look like?",
  "How do you identify or recognize an aircraft?",
  "How does a turbofan engine work?",
  "What are the main parts of a reciprocating engine?",
];

export default function Home() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";
  const waiting = status === "submitted"; // before the first token streams

  // Drive the robot's expression from the chat state. "Talking" only while
  // answer text is actually streaming in — during routing, retrieval and the
  // vision model reading the pages, it stays "thinking".
  const lastMsg = messages[messages.length - 1];
  const speaking =
    status === "streaming" &&
    lastMsg?.role === "assistant" &&
    lastMsg.parts.some(
      (p) => p.type === "text" && (p as { text?: string }).text?.trim()
    );
  const robotState: RobotState = speaking ? "talking" : busy ? "thinking" : "neutral";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="app-layout">
      <aside className="avatar-pane">
        <RobotFace state={robotState} />
      </aside>

      <main className="chat-pane">
      <header className="chat-header">
        <span className="eyebrow">Agentic · Multimodal Retrieval</span>
        <h1>
          Visual <span className="grad">RAG</span> Agent
        </h1>
        <p>
          It reads the actual document pages — <b>figures and diagrams included</b> — and
          answers with the source pages cited.
        </p>
      </header>

      <div className="messages-area">
        {messages.length === 0 && (
          <div className="welcome">
            <p className="welcome-corpus">
              📚 Two illustrated manuals are indexed for this chat. Ask about aircraft
              identification or aircraft engines — the agent finds the relevant pages and
              answers from what they actually show.
            </p>
            <div className="corpus-books">
              {BOOKS.map((b, i) => (
                <a
                  className="book-card"
                  key={i}
                  href={b.pdf}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${b.title} (PDF)`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.cover} alt={`${b.title} cover`} />
                  <div className="book-meta">
                    <span className="book-title">{b.title}</span>
                    <span className="book-sub">{b.sub}</span>
                    <span className="book-open">Open the PDF ↗</span>
                  </div>
                </a>
              ))}
            </div>
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

        {messages.map((m, mi) => {
          const isLast = mi === messages.length - 1;
          const hasText = m.parts.some(
            (p) => p.type === "text" && (p as { text?: string }).text?.trim()
          );
          const hasSources = m.parts.some(
            (p) =>
              p.type === "data-sources" &&
              ((p as { data?: Source[] }).data?.length ?? 0) > 0
          );
          // Fill the gap after the source pages render while the vision model
          // reads them and before the first answer token streams in.
          const reading =
            m.role === "assistant" && isLast && busy && hasSources && !hasText;

          return (
            <div key={m.id} className={`message ${m.role}`}>
              {m.parts.map((p, i) => {
                if (p.type === "text")
                  return m.role === "assistant" ? (
                    <div className="md" key={i}>
                      <ReactMarkdown>{p.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <span key={i}>{p.text}</span>
                  );
                if (p.type === "data-sources") {
                  const sources = (p as { data?: Source[] }).data ?? [];
                  if (sources.length === 0) return null;
                  return (
                    <div className="sources" key={i}>
                      <div className="sources-label">Source pages</div>
                      <div className="thumbs">
                        {sources.map((s, j) => (
                          <a key={j} href={s.image_url} target="_blank" rel="noreferrer" className="thumb">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={s.image_url} alt={`${s.book} p.${s.page}`} />
                            <span>{s.book.replace(/_/g, " ")} · p.{s.page}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
              {reading && (
                <div className="reading-indicator">
                  <span className="reading-label">Reading the pages</span>
                  <span className="reading-dots"><span></span><span></span><span></span></span>
                </div>
              )}
            </div>
          );
        })}

        {waiting && (
          <div className="thinking-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}

        {error && (
          <div className="message assistant error-msg">
            ⚠️{" "}
            {/quota|rate limit|429/i.test(error.message ?? "")
              ? "Easy there, speed reader! 📚 You're flipping pages faster than I can read them. Give me a few seconds to catch my breath and try again."
              : error.message || "Something went wrong on my end — give it another try."}
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
      </main>
    </div>
  );
}
