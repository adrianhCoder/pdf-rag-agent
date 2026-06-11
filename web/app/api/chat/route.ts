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

export const maxDuration = 60;

// Retrieve a broader set to synthesize a complete answer from, but only surface
// the strongest few to the user as image thumbnails.
const CONTEXT_PAGES = 6; // pages GPT-4o reads to compose the answer
const DISPLAY_PAGES = 3; // top pages shown to the user as thumbnails

/** Pull the plain text out of the latest user UIMessage. */
function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const question = lastUserText(messages);

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
          "images, charts or diagrams), action='search' with a focused query. If " +
          "it's small talk, action='chitchat' with a friendly reply. If clearly " +
          "out of scope, action='refuse' and say so honestly.",
        prompt: question,
      });

      if (route.action !== "search") {
        const r = streamText({
          model: google("gemini-2.5-flash-lite"),
          system: "Reply briefly and naturally.",
          prompt: route.reply || "Hello!",
        });
        writer.merge(r.toUIMessageStream());
        return;
      }

      // ── 2. Retrieve relevant pages (visual late-interaction search) ───────
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
              { type: "text", text: `Question: ${question}` },
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
