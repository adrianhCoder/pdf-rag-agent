/** Call the Modal ColPali service to embed a user query into a multivector. */
const MODAL_EMBED_QUERIES_URL = process.env.MODAL_EMBED_QUERIES_URL!;

export async function embedQuery(query: string): Promise<number[][]> {
  const res = await fetch(MODAL_EMBED_QUERIES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [query] }),
  });
  if (!res.ok) throw new Error(`Modal embed failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embeddings: number[][][] };
  return data.embeddings[0]; // multivector for the single query
}
