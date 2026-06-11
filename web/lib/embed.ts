/** Embed the user's query with Gemini text-embedding-004 (RETRIEVAL_QUERY). */
const KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const MODEL = "gemini-embedding-001";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`;

export async function embedQuery(query: string): Promise<number[]> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${MODEL}`,
      content: { parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) throw new Error(`Gemini embed failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { embedding: { values: number[] } };
  return data.embedding.values; // 768-dim single vector
}
