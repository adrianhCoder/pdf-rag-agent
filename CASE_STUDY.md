# Case Study — Visual RAG Agent over Illustrated Documents

**Author:** Adrianh de Lucio Chavero
**Type:** Personal project (built as proof of work; no confidential or client material)
**Live demo:** _<add Vercel URL>_  ·  **Repo:** https://github.com/adrianhCoder/pdf-rag-agent

---

## TL;DR
An **agentic, multimodal question-answering system** over a corpus of illustrated
textbooks. The agent decides *how* to handle each question, retrieves the most
relevant **pages as images** (so it can reason over figures and diagrams, not
just text), answers grounded on those pages with a vision model, and **cites its
sources**. Out-of-scope questions are refused honestly instead of hallucinated.

Built end-to-end and deployed: ingestion pipeline, a GPU embedding service, a
vector database, and a Next.js app on Vercel.

## Why this is an *agent*, not just a chatbot
The `/api/chat` endpoint runs a small decision loop rather than a single LLM call:

```
user message
  └─▶ ROUTER (LLM)  ── decides: search / chit-chat / refuse
        ├─ search ─▶ TOOL: retrieve pages (visual search) ─▶ emit sources
        │             └─▶ GROUND: vision model answers ONLY from retrieved pages
        ├─ chit-chat ─▶ direct reply
        └─ refuse ─▶ honest "out of scope"
```

It exhibits the properties that matter for autonomous agents:
- **Context-based decisions** — routes each request to the right behaviour.
- **Tool use** — calls an external retrieval tool over a vector DB.
- **Grounded action** — answers are constrained to retrieved evidence and cited.
- **Honest failure** — refuses when the corpus can't answer, instead of inventing.

This is the same backbone I'd extend for business agents: swap the "retrieve
pages" tool for tools that hit a CRM, a messaging API, or an internal service,
and let the router orchestrate multi-step actions.

## Architecture

```
INGESTION (run once)                                   web/ingestion
  PDF ──render pages──▶ PNG ──▶ [ColPali embed] ──▶ multivectors ──▶ Qdrant
                         └──▶ Vercel Blob (public image URLs) ──────▶ payload

RUNTIME (Vercel · Next.js)                             web/
  question ─▶ /api/chat
     router (gpt-4o-mini) ─▶ tool: ColPali(query) ─▶ Qdrant MaxSim search (top-k)
        ─▶ retrieved page images ─▶ GPT-4o (vision) ─▶ streamed answer + citations
        ─▶ source pages streamed to the UI as thumbnails

EMBEDDER (Modal · Python · GPU, scale-to-zero)        embedder/
  hosts ColPali/ColQwen2 (no JS port exists); the only Python at runtime
```

## Key technical decisions
| Decision | Choice | Rationale |
|---|---|---|
| Retrieval over figures | **ColPali / ColQwen2** | Embeds page *images* directly (late interaction), so charts and diagrams are first-class — no brittle OCR pipeline |
| Vector DB | **Qdrant** | One of the few with native **multivector + MaxSim**, which ColPali requires; generous free tier |
| Hosting the model | **Modal** (GPU, scale-to-zero) | ColPali is Python/GPU-only; Modal keeps it in one place and costs ~nothing when idle |
| App + agent | **Next.js + Vercel AI SDK** | Native Vercel deploy, streaming, GPT-4o tool/▶ loop; gives a clean TypeScript surface |
| Image storage | **Vercel Blob** | Serves retrieved pages to both the vision model and the UI |
| Answering model | **GPT-4o (vision)** | Reads the retrieved page images to answer figure/diagram questions |
| Corpus | **OpenStax (CC-licensed)** | Figure-dense textbooks; fully shareable, no IP concerns |

### Engineering details worth noting
- **Polyglot, honest boundaries:** TypeScript for the app/agent; Python only where
  it must be (the GPU model). A single HTTP contract between them.
- **Multivector search by hand over REST** to keep the Vercel runtime dependency-light.
- **Streaming structured data:** the agent streams a custom `data-sources` part so
  the UI renders the exact pages the answer is grounded on, in real time.
- **Cost-aware:** Modal scales to zero; vectors stored on disk in Qdrant; the
  corpus is sized to stay within free tiers.

## Skills this demonstrates
Backend integration design · external API/service orchestration · vector
databases & retrieval · multimodal RAG · LLM tool-calling / agent routing ·
prompt design for grounding & refusal · Python + TypeScript · deployment to
managed cloud (Modal, Qdrant, Vercel).

## Honest scope & what I'd add for production
This is a focused demo, deliberately small. For a production deployment I would add:
- **Reranking + score thresholds** before answering, and answer confidence signals.
- **Auth on the embedder endpoint** (currently open for demo simplicity).
- **Evaluation harness** (e.g., a held-out Q/A set; the ViDoRe benchmark fits) to
  track retrieval quality across changes.
- **Caching** of query embeddings and observability/tracing on the agent steps.

I built it this way on purpose: a working, deployed, end-to-end agent I can
explain in full — not a notebook. The patterns (router, tool use, grounding,
honest refusal) transfer directly to business-facing agents that take actions in
real systems.
