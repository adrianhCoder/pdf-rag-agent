import { openai } from "@ai-sdk/openai";
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
        model: openai("gpt-4o-mini"),
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
          model: openai("gpt-4o-mini"),
          system: "Reply briefly and naturally.",
          prompt: route.reply || "Hello!",
        });
        writer.merge(r.toUIMessageStream());
        return;
      }

      // ── 2. Retrieve relevant pages (visual late-interaction search) ───────
      const hits = await searchPages(route.query || question, 4);

      if (hits.length === 0) {
        const r = streamText({
          model: openai("gpt-4o-mini"),
          prompt:
            "Say, honestly and briefly, that the corpus doesn't contain " +
            "information to answer this question.",
        });
        writer.merge(r.toUIMessageStream());
        return;
      }

      // ── 3. Emit the source pages so the UI can show them ──────────────────
      writer.write({
        type: "data-sources",
        id: "sources",
        data: hits.map((h) => ({
          book: h.book,
          page: h.page,
          image_url: h.image_url,
          score: h.score,
        })),
      });

      // ── 4. Ground the answer on the page images (GPT-4o vision) ───────────
      const sources = hits.map((h) => `${h.book} · p.${h.page}`).join("; ");
      const r = streamText({
        model: openai("gpt-4o"),
        system:
          "You answer using ONLY the textbook page images provided. Base every " +
          "claim on what is visible in those pages, including figures and " +
          "diagrams. Cite sources inline as (book · page). If the pages don't " +
          "contain the answer, say so honestly — do not invent.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: question },
              ...hits.map((h) => ({ type: "image" as const, image: new URL(h.image_url) })),
              { type: "text", text: `Available sources to cite: ${sources}` },
            ],
          },
        ],
      });
      writer.merge(r.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
