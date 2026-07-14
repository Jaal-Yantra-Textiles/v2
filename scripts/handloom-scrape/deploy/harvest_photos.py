"""
Cheap photo-URL harvester — the SECOND pass (join to detail records by census_id).

The real profile photo lives ONLY on the list page (viewAlliedWeaver); it is NOT
derivable from census_id (the URL also carries a survey date + a non-derivable
internal id) and is absent from the detail page. But one list request returns
EVERY weaver in a subdistrict with its photo URL — so this pass is small
(~one request per subdistrict) vs the 3.7M-request detail sweep.

  python harvest_photos.py HARYANA                 # one state
  python harvest_photos.py --all --states-file states.txt

Output: data/live/photos/<STATE>.csv  (census_id,photo_url) — join to records by
census_id. Resumable: checkpoints completed subdistricts.
"""

import csv
import json
import sys
from pathlib import Path
from urllib.parse import quote

import httpx
import typer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from crawl_subdistrict import BASE, UA, login, list_subdistrict  # noqa: E402
from crawl_state import _creds, list_districts, list_subdistricts  # noqa: E402

cli = typer.Typer()
PHOTOS = Path(__file__).resolve().parents[1] / "data" / "live" / "photos"


def harvest_state(client: httpx.Client, state: str) -> int:
    PHOTOS.mkdir(parents=True, exist_ok=True)
    ckpt = PHOTOS / f"_checkpoint_{state}.json"
    done: set[str] = set(json.loads(ckpt.read_text())) if ckpt.exists() else set()
    out = PHOTOS / f"{state}.csv"
    new_file = not out.exists()

    n = 0
    with out.open("a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["census_id", "photo_url"])
        for dist in list_districts(client, state):
            for sub in list_subdistricts(client, state, dist):
                key = f"{dist}/{sub}"
                if key in done:
                    continue
                # URL-encode segments (subdistrict names have spaces/parens)
                pairs = list_subdistrict(client, quote(state), quote(dist), quote(sub))
                for cid, photo in pairs:
                    w.writerow([cid, photo])
                    n += 1
                f.flush()
                done.add(key)
                ckpt.write_text(json.dumps(sorted(done)))
                typer.echo(f"  {state}/{key}: {len(pairs)} photos (state total {n})")
    return n


@cli.command()
def run(
    state: str = typer.Argument(None),
    all_: bool = typer.Option(False, "--all"),
    states_file: Path = typer.Option(Path(__file__).resolve().parent / "states.txt", "--states-file"),
):
    states = ([s.strip().upper() for s in states_file.read_text().splitlines() if s.strip() and not s.startswith("#")]
              if all_ else [state.upper()])
    with httpx.Client(timeout=60.0) as client:
        if not login(client, *_creds()):
            typer.echo("login failed", err=True); raise typer.Exit(1)
        for st in states:
            typer.echo(f"== {st} ==")
            total = harvest_state(client, st)
            typer.echo(f"{st} DONE: {total} photo urls -> {PHOTOS / (st + '.csv')}")


if __name__ == "__main__":
    cli()
