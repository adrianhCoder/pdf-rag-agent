/**
 * Tiny in-memory sliding-window rate limiter (per IP).
 *
 * First line of defense against someone hammering the public /api/chat endpoint
 * and burning the Gemini quota/budget. Zero dependencies, zero extra services.
 *
 * Caveat (be honest): on serverless each instance has its own memory, so under
 * heavy scale-out the limit is per-instance, not global. It throttles a single
 * abusive client well; the *hard* wallet cap is the Google Cloud billing budget.
 * For a global guarantee, swap this for @upstash/ratelimit + Vercel KV.
 */
const WINDOW_MS = 30_000; // 30s window
const MAX_IN_WINDOW = 10; // requests per IP per window

const hits = new Map<string, number[]>();

export function rateLimit(ip: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_IN_WINDOW) {
    hits.set(ip, recent);
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return { ok: false, retryAfter };
  }

  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map can't grow unbounded.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }

  return { ok: true, retryAfter: 0 };
}
