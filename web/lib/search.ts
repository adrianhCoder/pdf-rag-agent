/** Text-embedding (cosine) search over page vectors in Qdrant. */
import { embedQuery } from "./embed";

const QDRANT_URL = process.env.QDRANT_URL!;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY!;
const COLLECTION = process.env.QDRANT_COLLECTION ?? "visual_rag_pages";

export type PageHit = {
  score: number;
  book: string;
  page: number;
  image_url: string;
};

export async function searchPages(query: string, limit = 4): Promise<PageHit[]> {
  const vector = await embedQuery(query); // number[] single vector

  const res = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION}/points/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": QDRANT_API_KEY },
      body: JSON.stringify({ query: vector, limit, with_payload: true }),
    }
  );
  if (!res.ok) throw new Error(`Qdrant query failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    result: { points: { score: number; payload: Omit<PageHit, "score"> }[] };
  };
  return data.result.points.map((p) => ({ score: p.score, ...p.payload }));
}
