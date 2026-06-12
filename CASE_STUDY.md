# Case Study — Visual RAG Agent over Illustrated Documents

**Author:** Adrianh de Lucio Chavero
**Type:** Personal project (built as proof of work; no confidential or client material)
**Live demo:** https://pdf-rag-agent.vercel.app  ·  **Repo:** https://github.com/adrianhCoder/pdf-rag-agent

---

## TL;DR
An **agentic, multimodal question-answering system** over a corpus of illustrated
manuals. The agent decides *how* to handle each question, retrieves the most
relevant pages, **reads those pages as images** with a vision model (so it reasons
over figures and diagrams, not just text), and **cites its sources**. Out-of-scope
questions are refused honestly instead of hallucinated.

Core design: **text to search, vision to answer.** Retrieval runs on text
embeddings (precise for labelled pages); answering runs on a vision LLM that reads
the actual page images. Built and deployed end-to-end: ingestion pipeline, vector
database, and a Next.js app on Vercel.

## Why this is an *agent*, not just a chatbot
The `/api/chat` endpoint runs a small decision loop rather than a single LLM call:

```
user message
  └─▶ ROUTER (LLM)  ── decides: search / chit-chat / refuse
        ├─ search ─▶ embed query ─▶ retrieve pages ─▶ emit source thumbnails
        │             └─▶ GROUND: vision model answers ONLY from retrieved pages
        ├─ chit-chat ─▶ direct reply
        └─ refuse ─▶ honest "out of scope"
```

It exhibits the properties that matter for autonomous agents:
- **Context-based decisions** — routes each request to the right behaviour.
- **Retrieval-augmented action** — pulls evidence from a vector DB before answering.
- **Grounded action** — answers are constrained to retrieved pages and cited.
- **Honest failure** — refuses when the corpus can't answer, instead of inventing.

This is the same backbone I'd extend for business agents: swap the "retrieve
pages" step for tools that hit a CRM, a messaging API, or an internal service, and
let the router orchestrate multi-step actions.

## Architecture

```
INGESTION (run once)                                   ingestion/
  PDF ──render each page──┬─▶ text  ─▶ Gemini text embedding (768-d) ─▶ Qdrant
                          └─▶ PNG   ─▶ Vercel Blob (public URL) ─▶ point payload

RUNTIME (Vercel · Next.js)                             web/
  question ─▶ /api/chat
     router (Gemini Flash-Lite) ─▶ embed query ─▶ Qdrant cosine search (top-k)
        ─▶ retrieved page images ─▶ Gemini 2.5 Flash (vision) ─▶ streamed answer + citations
        ─▶ source pages streamed to the UI as thumbnails
```

Each page is a **single point** in Qdrant: one text-embedding vector + a payload
`{ book, page, image_url }`. The vector is searched; the payload tells the agent
which page won and where its image lives — so it can hand that image to the vision
model. **The image is never embedded**; it is read directly at answer time.

## Key technical decisions
| Decision | Choice | Rationale |
|---|---|---|
| Retrieval | **Gemini text embeddings** (`gemini-embedding-001`, 768-d, cosine) | Precise on labelled technical pages; one API call, no GPU/infra. `taskType` is tuned per side (`RETRIEVAL_DOCUMENT` vs `RETRIEVAL_QUERY`) |
| Vector DB | **Qdrant** | Fast cosine search with the payload stored next to each vector; generous free tier |
| Router | **Gemini 2.5 Flash-Lite** | Cheap/fast structured-output routing; separate quota from the answering model |
| Answering model | **Gemini 2.5 Flash (vision)** | Reads the retrieved page images to answer figure/diagram questions |
| App + agent | **Next.js 15 + Vercel AI SDK v5** | Native Vercel deploy, streaming, custom streamed data parts |
| Image storage | **Vercel Blob** | Serves retrieved pages to both the vision model and the UI |
| Corpus | **US-government PDFs (public domain)** | Figure-dense manuals; fully shareable, no IP concerns |

### The ColPali detour — an engineering-judgment story
The first cut used **ColPali / ColQwen2**: visual late-interaction embeddings
(multivector + MaxSim) on a **Modal** GPU service, retrieving by page *appearance*.
I replaced it, and the reasoning is the interesting part:

- **Wrong notion of similarity.** ColPali matched pages by how they *look*. For a
  labelled corpus that meant a "helicopter" query could surface a visually-similar
  *engine* page. Text embeddings match by *meaning*, which is what these queries need.
- **Operational weight.** Multivector indexes are large (hundreds of vectors per
  page) and pressured the free tier; the GPU service added a cold-start dependency.
- **The fix kept the good half.** I moved *retrieval* to text embeddings but kept a
  *vision model for answering* — so figures and diagrams are still first-class.

Result: more precise retrieval, lower cost, and no GPU infrastructure. The
`embedder/modal_app.py` service is left in the repo as a documented, now-unused
legacy artifact. **Lesson: match the tool to the job — search by meaning, answer
by sight.**

### Engineering details worth noting
- **Idempotent, resumable ingestion:** each point's ID is a deterministic
  `uuid5(book|page)`. A re-run reads existing IDs from Qdrant and skips done pages,
  so a crash mid-run resumes cleanly. `upsert` + retry-with-backoff make network
  blips harmless. (Verified: re-running skipped 513 indexed pages and only embedded
  the 421 new ones.)
- **Streaming structured data:** the agent streams a custom `data-sources` part so
  the UI renders the exact pages the answer is grounded on, in real time.
- **Cost-aware:** one ~3 KB vector per page means the full 934-page corpus uses
  ~0.3% of Qdrant's free-tier RAM; per-chat LLM cost is a fraction of a cent.

## Skills this demonstrates
Backend integration design · external API/service orchestration · vector
databases & retrieval · multimodal RAG · LLM agent routing & grounding · prompt
design for grounding & refusal · Python + TypeScript · deployment to managed
cloud (Qdrant, Vercel) · **iterating on an architecture and justifying the change.**

## Honest scope & what I'd add for production
This is a focused demo, deliberately small. For production I would add:
- **Reranking + score thresholds** before answering, and answer-confidence signals.
- **Evaluation harness** (a held-out Q/A set; ViDoRe fits) to track retrieval
  quality across changes.
- **Caching** of query embeddings and observability/tracing on the agent steps.
- **Hybrid retrieval** (dense + keyword) for exact part numbers / model codes.

I built it this way on purpose: a working, deployed, end-to-end agent I can explain
in full — not a notebook. The patterns (router, retrieval, grounding, honest
refusal) transfer directly to business-facing agents that take actions in real
systems.
