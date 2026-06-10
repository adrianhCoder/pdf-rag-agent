"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";

type Source = { book: string; page: number; image_url: string; score: number };

export default function Home() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState("");
  const busy = status === "submitted" || status === "streaming";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="shell">
      <header>
        <h1>Visual RAG Agent</h1>
        <p>
          Ask about the indexed illustrated textbooks — including their figures and
          diagrams. Answers are grounded on the retrieved pages shown below each reply.
        </p>
      </header>

      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role}`}>
          <div className="role">{m.role === "user" ? "you" : "AI"}</div>
          <div className={`bubble ${m.role}`}>
            {m.parts.map((p, i) => {
              if (p.type === "text") return <span key={i}>{p.text}</span>;
              if (p.type === "data-sources") {
                const sources = (p as { data: Source[] }).data;
                return (
                  <div className="sources" key={i}>
                    <div className="sources-label">Retrieved pages</div>
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
        </div>
      ))}

      {busy && <div className="hint">retrieving & reading pages…</div>}

      <form onSubmit={onSubmit}>
        <div className="composer">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. What does the diagram of the water cycle show?"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
