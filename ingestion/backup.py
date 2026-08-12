"""
Dump / restore the Qdrant collection to a local JSONL file.

Insurance against free-tier cluster deletion (Qdrant Cloud suspends free
clusters after 1 week idle and deletes them after 4): restoring from a dump
takes seconds and skips re-embedding entirely.

Usage:
    python backup.py dump               # -> ../backups/<collection>.jsonl
    python backup.py restore            # <- ../backups/<collection>.jsonl
    python backup.py dump my.jsonl      # custom path works for both commands

Each line is one point: {"id": ..., "vector": [...], "payload": {...}}.
"""
import json
import sys
from pathlib import Path

import config

BACKUP_DIR = Path(__file__).resolve().parent.parent / "backups"
RESTORE_BATCH = 64


def default_path() -> Path:
    return BACKUP_DIR / f"{config.QDRANT_COLLECTION}.jsonl"


def dump(path: Path):
    client = config.qdrant_client()
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as f:
        offset = None
        while True:
            points, offset = client.scroll(
                collection_name=config.QDRANT_COLLECTION,
                limit=256, offset=offset, with_payload=True, with_vectors=True,
            )
            for p in points:
                f.write(json.dumps(
                    {"id": str(p.id), "vector": p.vector, "payload": p.payload},
                    ensure_ascii=False,
                ) + "\n")
            count += len(points)
            if offset is None:
                break
    print(f"Dumped {count} points from '{config.QDRANT_COLLECTION}' to {path}")


def restore(path: Path):
    from qdrant_client import models

    if not path.exists():
        raise SystemExit(f"No dump file at {path}")
    client = config.qdrant_client()
    config.ensure_collection(client)
    batch: list = []
    count = 0

    def flush():
        nonlocal count
        if not batch:
            return
        client.upsert(collection_name=config.QDRANT_COLLECTION, points=list(batch))
        count += len(batch)
        batch.clear()

    with path.open("r", encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            batch.append(models.PointStruct(
                id=rec["id"], vector=rec["vector"], payload=rec["payload"],
            ))
            if len(batch) >= RESTORE_BATCH:
                flush()
    flush()
    print(f"Restored {count} points into '{config.QDRANT_COLLECTION}' from {path}")


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("dump", "restore"):
        raise SystemExit("usage: python backup.py dump|restore [path]")
    path = Path(sys.argv[2]) if len(sys.argv) > 2 else default_path()
    (dump if sys.argv[1] == "dump" else restore)(path)


if __name__ == "__main__":
    main()
