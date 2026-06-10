# Setup — step by step

Order matters: the web app depends on the embedder and a populated Qdrant.

## 0. Accounts (all have free tiers)
- [Qdrant Cloud](https://cloud.qdrant.io) — create a free cluster → copy **URL** + **API key**
- [Modal](https://modal.com) — sign up, `pip install modal && modal setup`
- [Vercel](https://vercel.com) — for Blob storage + hosting
- [OpenAI](https://platform.openai.com) — API key (GPT-4o)

## 1. Deploy the ColPali embedder (Modal)
```bash
pip install modal
modal setup
modal deploy embedder/modal_app.py
```
Copy the two printed URLs → `MODAL_EMBED_IMAGES_URL` and `MODAL_EMBED_QUERIES_URL`.

## 2. Create a Vercel Blob store
Vercel dashboard → Storage → Blob → create → copy **BLOB_READ_WRITE_TOKEN**.

## 3. Fill the root `.env`
```bash
cp .env.example .env   # then edit
```

## 4. Get the corpus + ingest
Download 5–8 OpenStax PDFs (figure-rich) into `./pdfs/` (see `pdfs/README.md`), then:
```bash
cd ingestion
pip install -r requirements.txt
python ingest.py ../pdfs
```
This renders pages, embeds them via Modal, uploads images to Blob, and upserts
multivectors into Qdrant.

## 5. Run / deploy the web app
```bash
cd web
cp .env.local.example .env.local   # fill it
npm install
npm run dev                        # http://localhost:3000
```
Deploy: push to GitHub → import in Vercel → add the env vars from `.env.local`.

## Cost note
Modal scales to zero (you pay only while embedding). Qdrant/Blob free tiers and a
small OpenAI spend are enough for a demo.
