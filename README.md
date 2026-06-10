# Visual RAG Agent — Multimodal Q&A over illustrated PDFs

An **agentic, multimodal RAG** system that answers questions about a corpus of
illustrated PDF books (text **and** figures/diagrams). Built as a portfolio
proof-of-work: it demonstrates retrieval over visually rich documents using
**ColPali late-interaction embeddings**, a vector database, and a vision LLM,
wrapped in an **agent** that decides how to answer each question.

> Why "agent" and not just "RAG chatbot": the `/api/chat` endpoint runs a
> Gemini 2.5 Flash tool-calling loop. The model decides *when* to retrieve, issues the
> `searchDocuments` tool, grounds its answer on the retrieved **page images**,
> and cites `book · page`. Out-of-scope questions are refused honestly instead
> of hallucinated.

## Architecture

```
INGESTION  (run once, locally or in Colab)            ── ingestion/ingest.py
  PDF pages ──render──> PNG ──> [Modal: ColPali embed] ──> multivectors
                          │                                    │
                          └──> Vercel Blob (image URLs)        └──> Qdrant (multivector, MaxSim)

RUNTIME    (Vercel — Next.js)                          ── web/
  user question
    └─> /api/chat  (Gemini 2.5 Flash agent, tool-calling)
          └─ tool: searchDocuments(query)
               └─> [Modal: ColPali encode query] ─> Qdrant search (MaxSim, top-k)
                   └─> fetch top page images (Vercel Blob URLs)
                       └─> Gemini 2.5 Flash VISION answers, grounded, with citations

EMBEDDER   (Modal — Python, GPU, scale-to-zero)       ── embedder/modal_app.py
  the ONLY Python component at runtime; hosts ColPali (no JS port exists)
```

### Components & why
| Concern | Choice | Why |
|---|---|---|
| Visual retrieval | **ColPali / ColQwen2** | State of the art for documents with figures; embeds page *images* directly, no brittle OCR |
| Vector DB | **Qdrant Cloud** | Native **multivector** support (required for ColPali's late-interaction MaxSim); generous free tier |
| Embedder host | **Modal** | ColPali is Python+GPU only; Modal scales to zero (cheap for a demo), keeps the model in one place |
| App + agent | **Next.js + Vercel AI SDK** | Native Vercel deploy, streaming chat, Gemini 2.5 Flash tool-calling |
| Image storage | **Vercel Blob** | Serve retrieved page images to the vision model and the UI |
| Answering LLM | **Gemini 2.5 Flash (vision)** | Reads the retrieved page images to answer figure/diagram questions |
| Corpus | **OpenStax PDFs** | CC-licensed textbooks dense with diagrams — ideal for multimodal RAG |

## Setup (summary)
1. **Qdrant Cloud** free cluster → get URL + API key.
2. **Modal** account → `modal deploy embedder/modal_app.py` → copy the endpoint URL.
3. **Vercel Blob** store → get `BLOB_READ_WRITE_TOKEN`.
4. **Google Gemini** API key (free, no card): https://aistudio.google.com/apikey
5. Fill `.env` (see `.env.example`), then:
   - `cd ingestion && pip install -r requirements.txt && python ingest.py ./pdfs`
   - `cd web && npm install && npm run dev`
6. Deploy `web/` to Vercel; set the same env vars in the Vercel dashboard.

See per-folder READMEs for details.

## Honesty note
This is original work built from scratch for portfolio/evaluation purposes; the
corpus is CC-licensed (OpenStax). No confidential or client material is used.
