# Setup — step by step

Order matters: the web app depends on a populated Qdrant collection.

## 0. Accounts (all have free tiers)
- [Qdrant Cloud](https://cloud.qdrant.io) — create a free cluster → copy **URL** + **API key**
- [Vercel](https://vercel.com) — for Blob storage + hosting
- [Google AI Studio](https://aistudio.google.com/apikey) — Gemini API key

> No GPU service is required. Retrieval uses Gemini **text embeddings** (an API
> call), so there is nothing to host. (An older `embedder/modal_app.py` ColPali
> service exists as a legacy artifact but is **not** used.)

## 1. Create a Vercel Blob store
Vercel dashboard → Storage → Blob → create → copy **BLOB_READ_WRITE_TOKEN**.

## 2. Fill the root `.env`
```bash
cp .env.example .env   # then edit
```
Required: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `BLOB_READ_WRITE_TOKEN`.

## 3. Add the corpus + ingest
Drop figure-rich, public-domain PDFs into `./pdfs/` (see `pdfs/README.md`), then:
```bash
cd ingestion
pip install -r requirements.txt
python ingest.py ../pdfs
```
For each page this: renders a PNG + extracts text, embeds the **text** via Gemini
(`gemini-embedding-001`, 768-d), uploads the image to Vercel Blob, and upserts a
single-vector point `{ vector, payload:{book,page,image_url} }` into Qdrant.
Re-runnable: deterministic `uuid5(book|page)` IDs skip already-indexed pages.

## 4. Run / deploy the web app
```bash
cd web
cp .env.local.example .env.local   # fill it
npm install
npm run dev                        # http://localhost:3000
```
Deploy: push to GitHub → import in Vercel (**Root Directory: `web`**) → add the
env vars: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`,
`GOOGLE_GENERATIVE_AI_API_KEY`.

## Cost note
No GPU, no always-on services. Qdrant/Blob free tiers cover the demo; one ~3 KB
vector per page means a ~1,000-page corpus uses well under 1% of Qdrant's free
RAM. Gemini cost is a fraction of a cent per chat (router + embedding + one vision
answer over 3 page images).
