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
For each page this: renders a PNG + extracts text, asks Gemini vision
(`gemini-2.5-flash`) for a short description of the page (figures, tables, key
terms — set `DESCRIBE_MODEL=""` to skip), embeds **text + description** via
Gemini (`gemini-embedding-001`, 768-d), uploads the image to Vercel Blob, and
upserts a single-vector point
`{ vector, payload:{book,page,image_url,description} }` into Qdrant.
Re-runnable: deterministic `uuid5(book|page)` IDs skip already-indexed pages.

### 3b. Back up the collection (recommended)
Qdrant Cloud **suspends** free clusters after 1 idle week and **deletes** them
after 4. Two layers of protection:
```bash
python backup.py dump      # local snapshot -> ../backups/<collection>.jsonl
python backup.py restore   # seconds to rebuild a new cluster, no re-embedding
```
Plus a scheduled keep-alive (`.github/workflows/qdrant-keepalive.yml`) that
queries the cluster every 3 days. Enable it by adding repo secrets
`QDRANT_URL` + `QDRANT_API_KEY` (Settings → Secrets and variables → Actions),
then trigger it once manually (Actions → *Qdrant keep-alive* → Run workflow)
to verify. Note: GitHub pauses scheduled workflows in repos with no activity
for 60 days — re-enable from the Actions tab if you see that banner.

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
