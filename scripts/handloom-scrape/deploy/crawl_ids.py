"""
Deterministic ID-driven detail crawler — the simplified path.

Because census_ids are deterministic, we skip district/subdistrict enumeration
entirely and just sweep weaverInfo/{id}. IDs (and real photo URLs) come from the
page's CSV export; or, if IDs are globally sequential, from a numeric --range.

  # from a CSV exported off the portal (census_id [+ photo] columns auto-detected)
  python crawl_ids.py --csv ../data/live/index/HARYANA.csv -o ../data/live/HARYANA.jsonl

  # or a pure numeric sweep (no CSV) — photo will be null
  python crawl_ids.py --range 2904500 2905000 -o ../data/live/AMBALA.jsonl

Resumable: on restart it reads the output jsonl (+ _dead file) and skips ids
already done, so a crash/reboot costs only the in-flight batch.

Creds: env CENSUS_USERNAME / CENSUS_PASSWORD, else apps/backend/.env.
"""

import csv
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
import typer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from crawl_subdistrict import BASE, UA, login, fetch_record  # noqa: E402
from crawl_state import _creds  # noqa: E402

cli = typer.Typer()


def _read_csv_ids(path: Path) -> list[tuple[str, str]]:
    """Return [(census_id, photo_url)] from an exported CSV, columns auto-detected."""
    rows = list(csv.reader(path.read_text().splitlines()))
    header = [h.strip().lower() for h in rows[0]]
    id_col = next((i for i, h in enumerate(header) if h in ("census_id", "id", "weaver_id", "censusid")), 0)
    photo_col = next((i for i, h in enumerate(header) if "photo" in h or "image" in h or "digitalocean" in h), None)
    out = []
    for r in rows[1:]:
        if id_col < len(r) and r[id_col].strip().isdigit():
            out.append((r[id_col].strip(), (r[photo_col].strip() if photo_col is not None and photo_col < len(r) else "")))
    return out


def _already_done(out_path: Path, dead_path: Path) -> set[str]:
    done: set[str] = set()
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            if line.strip():
                try:
                    done.add(str(json.loads(line).get("census_id")))
                except Exception:
                    pass
    if dead_path.exists():
        done |= {x.strip() for x in dead_path.read_text().splitlines() if x.strip()}
    return done


@cli.command()
def run(
    csv_path: Path = typer.Option(None, "--csv"),
    range_: tuple[int, int] = typer.Option((0, 0), "--range"),
    output: Path = typer.Option(..., "-o", "--output"),
    concurrency: int = typer.Option(4, "--concurrency", help="parallel detail fetches (keep modest — shared session)"),
    delay: float = typer.Option(0.1, "--delay", help="per-request pacing inside each worker"),
):
    output.parent.mkdir(parents=True, exist_ok=True)
    dead_path = output.with_suffix(".dead.txt")

    # build the id worklist (+photo where known)
    if csv_path:
        work = _read_csv_ids(csv_path)
    elif range_ != (0, 0):
        work = [(str(i), "") for i in range(range_[0], range_[1] + 1)]
    else:
        typer.echo("give --csv or --range", err=True); raise typer.Exit(2)

    done = _already_done(output, dead_path)
    work = [(cid, photo) for cid, photo in work if cid not in done]
    typer.echo(f"{len(work)} ids to fetch ({len(done)} already done); concurrency={concurrency}")

    # ONE logged-in session shared across the thread pool (httpx.Client is thread-safe)
    with httpx.Client(timeout=60.0) as client:
        if not login(client, *_creds()):
            typer.echo("login failed", err=True); raise typer.Exit(1)

        def task(cid: str, photo: str):
            time.sleep(delay)
            try:
                return cid, fetch_record(client, cid, photo)   # None on PHP-error/empty id
            except Exception as e:
                typer.echo(f"  {cid}: {e}", err=True)
                return cid, None

        ok = dead = 0
        with output.open("a") as fout, dead_path.open("a") as fdead, ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = [ex.submit(task, cid, photo) for cid, photo in work]
            for i, fut in enumerate(as_completed(futures), 1):
                cid, rec = fut.result()
                if rec is None:
                    fdead.write(cid + "\n"); dead += 1
                else:
                    fout.write(json.dumps(rec, ensure_ascii=False) + "\n"); ok += 1
                if i % 200 == 0:
                    fout.flush(); fdead.flush()
                    typer.echo(f"  {i}/{len(work)} (ok={ok} dead={dead})")
        typer.echo(f"done: {ok} records, {dead} dead/empty -> {output}")


if __name__ == "__main__":
    cli()
