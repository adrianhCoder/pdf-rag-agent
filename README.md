# Visual RAG Agent — Multimodal Q&A over illustrated PDFs

**🔗 Live demo: https://pdf-rag-agent.vercel.app**

An **agentic, multimodal RAG** system that answers questions about a corpus of
illustrated PDF books — reasoning over **figures and diagrams**, not just text.
Built as a portfolio proof-of-work: it retrieves the most relevant pages, reads
those page **images** with a vision LLM, and answers with the source pages cited.

> **Design in one line:** *text to search, vision to answer.* Retrieval runs on
> **text embeddings** (precise for labelled technical pages); the answer is
> grounded by a **vision model that reads the page images** (so charts and
> diagrams are first-class).

> **Why "agent" and not just a RAG chatbot:** `/api/chat` runs a small decision
> loop. A router LLM first decides **search / chit-chat / refuse**; only on
> *search* does it embed the query, retrieve pages, and ground a vision answer on
> them with `book · page` citations. Out-of-scope questions are refused honestly
> instead of hallucinated.

## Architecture

```
INGESTION  (run once, locally)                         ── ingestion/ingest.py
  PDF ──render each page──┬──> text ──> Gemini text embedding (768-d) ──> Qdrant
                          │                                                  ▲
                          └──> PNG image ──> Vercel Blob (public URL) ───────┘
                                              (URL stored in the point payload)

RUNTIME    (Vercel · Next.js)                          ── web/
  user question
    └─> /api/chat
         ├─ ROUTER            (Gemini 2.5 Flash-Lite) → search / chit-chat / refuse
         ├─ EMBED QUERY       (Gemini text embedding, RETRIEVAL_QUERY)
         ├─ SEARCH            (Qdrant cosine, top-k) → pages + payload{book,page,url}
         ├─ SURFACE           top-3 page images streamed to the UI as thumbnails
         └─ ANSWER            (Gemini 2.5 Flash VISION) reads those page images
                              → grounded answer + per-page bullets + citations
```

Retrieval stores **one single vector per page** (the page text) plus a payload
with `{ book, page, image_url }`. The image itself is **never embedded** — it is
read directly by the vision model at answer time.

### Components & why
| Concern | Choice | Why |
|---|---|---|
| Retrieval | **Gemini text embeddings** (`gemini-embedding-001`, 768-d, cosine) | Precise for labelled technical pages; one API call, no GPU, no infra |
| Vector DB | **Qdrant Cloud** | Fast cosine search + payload stored next to each vector; generous free tier |
| Router | **Gemini 2.5 Flash-Lite** | Cheap/fast structured-output routing; separate quota from the vision model |
| Answering LLM | **Gemini 2.5 Flash (vision)** | Reads the retrieved page images to answer figure/diagram questions |
| App + agent | **Next.js 15 + Vercel AI SDK v5** | Native Vercel deploy, streaming chat, custom streamed data parts |
| Image storage | **Vercel Blob** | Serves page images to both the vision model and the UI |
| Corpus | **US-government PDFs (public domain)** | Figure-dense manuals, fully shareable — no IP concerns |

### Why not ColPali? (an honest design note)
The first version used **ColPali / ColQwen2** — visual late-interaction
embeddings (multivector + MaxSim) hosted on a **Modal** GPU service — to retrieve
by page *appearance*. I dropped it: for a labelled technical corpus it retrieved
by visual similarity rather than meaning (e.g. a *helicopter* query returned an
*engine* page), the multivector index was heavy on the free tier, and it added a
GPU dependency. Switching retrieval to **Gemini text embeddings** made it more
precise, cheaper, and infra-free — while keeping the **vision model for
answering**. The `embedder/modal_app.py` service remains as a (now unused) legacy
artifact. Takeaway: *match the tool to the job — search by meaning, answer by
sight.*

## Setup (summary)
1. **Qdrant Cloud** free cluster → get URL + API key.
2. **Vercel Blob** store → get `BLOB_READ_WRITE_TOKEN`.
3. **Google Gemini** API key: https://aistudio.google.com/apikey
4. Fill `.env` (see `.env.example`), then:
   - `cd ingestion && pip install -r requirements.txt && python ingest.py ./pdfs`
   - `cd web && npm install && npm run dev`
5. Deploy `web/` to Vercel; set the same env vars in the Vercel dashboard.

See [`SETUP.md`](SETUP.md) for the full step-by-step.

## Honesty note
Original work built from scratch for portfolio/evaluation purposes. The corpus is
public-domain (US-government publications). No confidential or client material is
used.
