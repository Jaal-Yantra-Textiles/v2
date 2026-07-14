"""
Two-pass, resumable orchestrator for the deterministic ID crawl.

  PASS 1 — photos (minutes):  harvest_photos.py --all
      one list request per subdistrict → data/live/photos/<STATE>.csv
      (census_id,photo_url). The real profile photo lives only on the list page.
  PASS 2 — detail (days):     crawl_ids.py --range, swept in bounded chunks
      global ids START..END fetched via weaverInfo/{id}. Each chunk is its own
      resumable crawl_ids run → bounds memory (no 3.7M futures at once) and gives
      per-chunk checkpointing/progress.

  python orchestrate.py --start 1 --end 3700000 --chunk 25000 --concurrency 4 --delay 0.15

Resumable: PASS 1 and each crawl_ids run resume from their own on-disk
checkpoints; a chunk is marked 'done' only when crawl_ids exits 0. So a reboot
costs at most the in-flight chunk. Politeness: concurrency = simultaneous detail
fetches on ONE shared session — keep it modest.
"""

import json
import subprocess
import sys
from pathlib import Path

import typer

cli = typer.Typer()
HERE = Path(__file__).resolve().parent
LIVE = HERE.parent / "data" / "live"
STATUS = LIVE / "_orchestrator_status.json"
IDS_DIR = LIVE / "ids"


def _load_status() -> dict:
    return json.loads(STATUS.read_text()) if STATUS.exists() else {}


def _save_status(status: dict) -> None:
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(status, indent=0))


@cli.command()
def run(
    start: int = typer.Option(1, "--start"),
    end: int = typer.Option(3_700_000, "--end"),
    chunk: int = typer.Option(25_000, "--chunk", help="ids per crawl_ids run (bounds memory)"),
    concurrency: int = typer.Option(4, "--concurrency", help="parallel detail fetches per chunk"),
    delay: float = typer.Option(0.15, "--delay", help="per-request politeness delay"),
    skip_photos: bool = typer.Option(False, "--skip-photos", help="skip PASS 1"),
):
    LIVE.mkdir(parents=True, exist_ok=True)
    IDS_DIR.mkdir(parents=True, exist_ok=True)
    status = _load_status()

    # ── PASS 1: photos (cheap; resumes via harvest_photos' per-state checkpoints) ──
    if not skip_photos and status.get("photos") != "done":
        typer.echo("PASS 1: harvesting photo urls (harvest_photos --all)")
        with (LIVE / "photos.log").open("a") as log:
            rc = subprocess.call(
                [sys.executable, str(HERE / "harvest_photos.py"), "--all"],
                stdout=log, stderr=subprocess.STDOUT,
            )
        status["photos"] = "done" if rc == 0 else f"error:{rc}"
        _save_status(status)
        typer.echo(f"  photos → {status['photos']}")
        if status["photos"] != "done":
            typer.echo("  photo pass failed; continuing to detail (photos join later)", err=True)

    # ── PASS 2: detail sweep in bounded, resumable chunks ───────────────────────
    chunks = list(range(start, end + 1, chunk))
    pending = [s for s in chunks if status.get(f"chunk:{s}") != "done"]
    typer.echo(f"PASS 2: {len(pending)}/{len(chunks)} chunks pending "
               f"(ids {start}..{end}, chunk={chunk}, concurrency={concurrency}, delay={delay})")

    for s in pending:
        e = min(s + chunk - 1, end)
        out = IDS_DIR / f"chunk_{s:08d}.jsonl"
        typer.echo(f"  chunk {s}..{e} → {out.name}")
        with (LIVE / "detail.log").open("a") as log:
            rc = subprocess.call(
                [sys.executable, str(HERE / "crawl_ids.py"),
                 "--range", str(s), str(e), "-o", str(out),
                 "--concurrency", str(concurrency), "--delay", str(delay)],
                stdout=log, stderr=subprocess.STDOUT,
            )
        status[f"chunk:{s}"] = "done" if rc == 0 else f"error:{rc}"
        _save_status(status)
        if rc != 0:
            typer.echo(f"    chunk {s} → error:{rc} (will retry next run)", err=True)

    remaining = [s for s in chunks if status.get(f"chunk:{s}") != "done"]
    typer.echo("orchestrator: " + ("ALL CHUNKS DONE" if not remaining
               else f"{len(remaining)} chunk(s) still pending — rerun to resume"))


if __name__ == "__main__":
    cli()
