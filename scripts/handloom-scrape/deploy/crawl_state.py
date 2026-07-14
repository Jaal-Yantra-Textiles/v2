"""
Resumable STATE-level crawler for the Handloom Census portal.

Reuses the VERIFIED per-subdistrict logic from crawl_subdistrict.py
(login / list_subdistrict / fetch_record) and adds:
  - district + subdistrict ENUMERATION for a whole state
  - a checkpoint so a crash/restart skips already-crawled subdistricts
  - append-only per-state output (data/live/<STATE>.jsonl)

Usage:
  python crawl_state.py HARYANA --delay 0.3

Creds: env CENSUS_USERNAME / CENSUS_PASSWORD, else apps/backend/.env.

⚠️ ENUMERATION PARSING (list_districts / list_subdistricts below) is derived
from the documented URL patterns; verify the two regexes on the first live run
of a fresh state and adjust if a state returns 0 districts.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
import typer

# reuse the verified navigation from the sibling module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from crawl_subdistrict import BASE, UA, login, list_subdistrict, fetch_record  # noqa: E402

cli = typer.Typer()
DATA = Path(__file__).resolve().parents[1] / "data" / "live"


def _creds() -> tuple[str, str]:
    user, pw = os.environ.get("CENSUS_USERNAME"), os.environ.get("CENSUS_PASSWORD")
    if user and pw:
        return user, pw
    # walk up to find apps/backend/.env (robust to how deep this file lives)
    env = None
    for parent in Path(__file__).resolve().parents:
        cand = parent / "apps" / "backend" / ".env"
        if cand.exists():
            env = cand
            break
    if env and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("CENSUS_USERNAME="):
                user = line.split("=", 1)[1].strip()
            elif line.startswith("CENSUS_PASSWORD="):
                pw = line.split("=", 1)[1].strip()
    if not (user and pw):
        typer.echo("missing CENSUS_USERNAME / CENSUS_PASSWORD", err=True)
        raise typer.Exit(2)
    return user, pw


def list_districts(client: httpx.Client, state: str) -> list[str]:
    html = client.get(f"{BASE}/ministry/districts/{state}", headers={"User-Agent": UA}).text
    # links point at ministry/subdistricts/{STATE}/{DISTRICT}
    return sorted(set(re.findall(rf"subdistricts/{re.escape(state)}/([^\"'/><]+)", html)))


def list_subdistricts(client: httpx.Client, state: str, district: str) -> list[str]:
    html = client.get(f"{BASE}/ministry/subdistricts/{state}/{district}", headers={"User-Agent": UA}).text
    # links point at ministry/viewAlliedWeaver/{STATE}/{DISTRICT}/{SUB}
    return sorted(set(re.findall(rf"viewAlliedWeaver/{re.escape(state)}/{re.escape(district)}/([^\"'/><]+)", html)))


@cli.command()
def run(state: str, delay: float = typer.Option(0.3, "--delay"), retries: int = 3):
    state = state.upper()
    DATA.mkdir(parents=True, exist_ok=True)
    ckpt_path = DATA / f"_checkpoint_{state}.json"
    done: set[str] = set(json.loads(ckpt_path.read_text())) if ckpt_path.exists() else set()
    out_path = DATA / f"{state}.jsonl"

    with httpx.Client(timeout=60.0) as client:
        for attempt in range(retries):
            if login(client, *_creds()):
                break
            typer.echo(f"login attempt {attempt+1} failed; backing off", err=True)
            time.sleep(5 * (attempt + 1))
        else:
            raise typer.Exit(1)

        districts = list_districts(client, state)
        typer.echo(f"{state}: {len(districts)} districts")
        total_ok = 0
        with out_path.open("a") as f:
            for di, dist in enumerate(districts, 1):
                for sub in list_subdistricts(client, state, dist):
                    key = f"{dist}/{sub}"
                    if key in done:
                        continue
                    try:
                        ids = list_subdistrict(client, state, dist, sub)
                        ok = 0
                        for cid, photo in ids:
                            try:
                                rec = fetch_record(client, cid, photo)
                            except Exception as e:  # transient network/portal error
                                typer.echo(f"  {cid}: {e}", err=True)
                                rec = None
                            if rec is not None:
                                rec["region_state"] = state
                                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                                ok += 1
                            time.sleep(delay)
                        f.flush()
                        total_ok += ok
                        done.add(key)
                        ckpt_path.write_text(json.dumps(sorted(done)))
                        typer.echo(f"  [{di}/{len(districts)}] {key}: {ok} recs (state total {total_ok})")
                    except Exception as e:
                        typer.echo(f"  {key}: FAILED {e} — will retry next run", err=True)
                        time.sleep(2)
        typer.echo(f"{state} DONE: {total_ok} records -> {out_path}")


if __name__ == "__main__":
    cli()
