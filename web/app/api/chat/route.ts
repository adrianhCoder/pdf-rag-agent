import { google } from "@ai-sdk/google";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateObject,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { searchPages } from "@/lib/search";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 60;

// Retrieve a broader set to synthesize a complete answer from, but only surface
// the strongest few to the user as image thumbnails.
const CONTEXT_PAGES = 6; // pages the vision model reads to compose the answer
const DISPLAY_PAGES = 3; // top pages shown to the user as thumbnails

// Conversation memory: the last N turns, as plain text. Text-only history is
// cheap (no images re-sent), the router uses it to resolve follow-ups into a
// standalone retrieval query, and the answer model uses it for continuity.
const HISTORY_TURNS = 10;

/** Plain text of one UIMessage (ignores sources/data parts). */
function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/** Pull the plain text out of the latest user UIMessage. */
function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  return last ? messageText(last) : "";
}

/** "User: … / Assistant: …" transcript of the last turns, excluding the latest user message. */
function historyText(messages: UIMessage[]): string {
  return messages
    .slice(0, -1)
    .slice(-HISTORY_TURNS)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${messageText(m)}`)
    .filter((line) => !line.endsWith(": "))
    .join("\n");
}

export async function POST(req: Request) {
  // Throttle the public endpoint before spending any LLM call.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const limit = rateLimit(ip);
  if (!limit.ok) {
    return new Response(
      `Rate limit reached — please wait ${limit.retryAfter}s and try again.`,
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();
  const question = lastUserText(messages);
  const history = historyText(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // ── 1. Router (the agent decides what to do) ──────────────────────────
      const { object: route } = await generateObject({
        model: google("gemini-2.5-flash-lite"),
        schema: z.object({
          action: z.enum(["search", "refuse", "chitchat"]),
          query: z.string().describe("a clean retrieval query when action=search"),
          reply: z.string().describe("a short direct reply when refuse/chitchat"),
        }),
        system:
          "You route messages for an assistant that answers questions about a " +
          "fixed corpus of illustrated textbooks (it reads text AND figures/" +
          "diagrams). If the textbooks could answer it (including questions about " +
          "images, charts or diagrams), action='search' with a focused, STANDALONE " +
          "query: resolve pronouns and follow-up references ('it', 'that engine', " +
          "'show me more') using the conversation so the query works on its own. If " +
          "it's small talk, action='chitchat' with a friendly reply. If clearly " +
          "out of scope, action='refuse' and say so honestly.",
        prompt: history
          ? `Conversation so far:\n${history}\n\nLatest user message: ${question}`
          : question,
      });

      if (route.action !== "search") {
        const r = streamText({
          model: google("gemini-2.5-flash-lite"),
          system: "Reply briefly and naturally, consistent with the conversation.",
          prompt: history
            ? `Conversation so far:\n${history}\n\nReply to say: ${route.reply || "Hello!"}`
            : route.reply || "Hello!",
        });
        writer.merge(r.toUIMessageStream());
        return;
      }

      // ── 2. Retrieve relevant pages (text-embedding cosine search) ─────────
      const hits = await searchPages(route.query || question, CONTEXT_PAGES);

      if (hits.length === 0) {
        const r = streamText({
          model: google("gemini-2.5-flash-lite"),
          prompt:
            "Say, honestly and briefly, that the corpus doesn't contain " +
            "information to answer this question.",
        });
        writer.merge(r.toUIMessageStream());
        return;
      }

      // ── 3. Surface the strongest pages to the UI as thumbnails ────────────
      const shown = hits.slice(0, DISPLAY_PAGES);
      writer.write({
        type: "data-sources",
        id: "sources",
        data: shown.map((h) => ({
          book: h.book,
          page: h.page,
          image_url: h.image_url,
          score: h.score,
        })),
      });

      // ── 4. Ground the answer on those pages (Gemini vision) ───────────────
      const sources = shown.map((h) => `${h.book} · p.${h.page}`).join("; ");
      const r = streamText({
        model: google("gemini-2.5-flash"),
        system:
          "You answer using ONLY the textbook page images provided. Structure your " +
          "reply as: (1) a direct 1-2 sentence answer to the question; then (2) a " +
          "short bullet for EACH page summarizing what it shows (text, figures, " +
          "diagrams), each ending with its citation as (book · page). Base every " +
          "claim only on what is visible in the pages — if they don't contain the " +
          "answer, say so honestly; never invent.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: history
                  ? `Conversation so far (for context only):\n${history}\n\nQuestion: ${question}`
                  : `Question: ${question}`,
              },
              ...shown.map((h) => ({ type: "image" as const, image: new URL(h.image_url) })),
              { type: "text", text: `The pages above are, in order: ${sources}` },
            ],
          },
        ],
      });
      writer.merge(r.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
