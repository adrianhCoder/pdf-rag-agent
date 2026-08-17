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

// Fact sheet about the corpus so the router and the chitchat replies can
// answer meta-questions ("which books do you know?") accurately instead of
// claiming ignorance about their own library.
const CORPUS_INFO =
  "The corpus is exactly 2 illustrated manuals (692 pages total): " +
  "1) 'Visual Aircraft Recognition' (US Army field manual FM 3-01.80, 192 pages) — " +
  "identifying military aircraft by sight: profiles, silhouettes, recognition features; " +
  "2) 'Aviation Maintenance Technician Handbook - Powerplant' (FAA-H-8083-32, 500 pages) — " +
  "aircraft engines: reciprocating and turbine engines, propellers, fuel, lubrication, " +
  "ignition and exhaust systems.";

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
          "diagrams). " +
          CORPUS_INFO +
          " If the textbooks could answer it (including questions about " +
          "images, charts or diagrams), action='search' with a focused, STANDALONE " +
          "query: resolve pronouns and follow-up references ('it', 'that engine', " +
          "'show me more') using the conversation so the query works on its own. If " +
          "it's small talk OR a question about the assistant itself or its corpus " +
          "(how many books, which titles, what topics it covers, what it can do), " +
          "action='chitchat' with a friendly reply answered accurately from the " +
          "corpus facts above. If clearly out of scope, action='refuse' and say so " +
          "honestly, mentioning what the corpus DOES cover.",
        prompt: history
          ? `Conversation so far:\n${history}\n\nLatest user message: ${question}`
          : question,
      });

      if (route.action !== "search") {
        const r = streamText({
          model: google("gemini-2.5-flash-lite"),
          system:
            "You are a friendly assistant that answers questions about a fixed " +
            "corpus of illustrated textbooks. " +
            CORPUS_INFO +
            " Reply briefly and naturally, consistent with the conversation; when " +
            "asked about your books or abilities, answer accurately from the facts " +
            "above and invite an on-topic question.",
          prompt:
            (history ? `Conversation so far:\n${history}\n\n` : "") +
            `The user just said: ${question}\n\n` +
            `Deliver this reply to the user, in your own natural words: ${route.reply || "Hello!"}`,
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

      // ── 4. Ground the answer on the pages (Gemini vision) ─────────────────
      // The model reads ALL retrieved pages, not just the displayed thumbnails.
      const sources = hits.map((h) => `${h.book} · p.${h.page}`).join("; ");
      const r = streamText({
        model: google("gemini-2.5-flash"),
        system:
          "You answer using ONLY the textbook page images provided. Answer the " +
          "question directly and naturally first, then support it with what the " +
          "pages show — text, figures, diagrams — citing the book name and page " +
          "for each claim, e.g. (Powerplant Handbook · p.77). Draw on the pages " +
          "that are actually relevant and simply " +
          "ignore the rest; don't describe pages for their own sake. Base every " +
          "claim only on what is visible in the pages — if they don't contain " +
          "the answer, say so honestly; never invent.",
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
              ...hits.map((h) => ({ type: "image" as const, image: new URL(h.image_url) })),
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
