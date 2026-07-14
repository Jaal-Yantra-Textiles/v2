"""
Crawl one subdistrict of the Handloom Census portal and emit parsed records.

Uses the VERIFIED live navigation (not the stale scraper.py contract):
  login: GET /portal (ci_session) -> POST /portal/index
  list:  ministry/viewAlliedWeaver/{STATE}/{DISTRICT}/{SUBDISTRICT}  -> ids + photo urls
  detail: ministry/weaverInfo/{id}  (path segment, NOT ?Id=)

Real mobile is un-commented by parser.py and stored alongside the portal mask.

Usage:
  python crawl_subdistrict.py HARYANA AMBALA AMBALA -o data/live/ambala_full.jsonl
"""

import json
import re
import sys
import time
from pathlib import Path

import httpx
import typer

from parser import parse_weaver_page

BASE = "https://tricorniotec.com/webapp"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

cli = typer.Typer()


def login(client: httpx.Client, user: str, pw: str) -> bool:
    client.get(f"{BASE}/portal", headers={"User-Agent": UA})  # seeds ci_session
    r = client.post(
        f"{BASE}/portal/index",
        data={"username": user, "password": pw},
        headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"},
        follow_redirects=True,
    )
    # authed session can read a real weaver page (non-authed -> empty body)
    probe = client.get(f"{BASE}/ministry/dashboard", headers={"User-Agent": UA})
    return len(probe.content) > 1000


def list_subdistrict(client: httpx.Client, state: str, district: str, sub: str):
    url = f"{BASE}/ministry/viewAlliedWeaver/{state}/{district}/{sub}"
    html = client.get(url, headers={"User-Agent": UA}).text
    pairs = re.findall(
        r'weaverInfo/(\d+).*?<img[^>]+src="([^"]+digitaloceanspaces[^"]+)"', html, re.S
    )
    seen, out = set(), []
    for cid, photo in pairs:
        if cid not in seen:
            seen.add(cid)
            out.append((cid, photo))
    return out


def fetch_record(client: httpx.Client, cid: str, photo: str) -> dict | None:
    html = client.get(f"{BASE}/ministry/weaverInfo/{cid}", headers={"User-Agent": UA}).text
    if "A PHP Error" in html and html.count("A PHP Error") > 10:
        return None  # empty/broken record
    rec = parse_weaver_page(html, int(cid))
    d = rec.model_dump()
    d["profile_photo_url"] = photo  # real photo from the list page
    d.pop("aadhaar_photo_url", None)
    # family_weavers/allied on the detail page are static template samples -> drop
    d.pop("family_weavers", None)
    d.pop("family_allied", None)
    return d


@cli.command()
def run(
    state: str,
    district: str,
    subdistrict: str,
    output: str = typer.Option("data/live/subdistrict.jsonl", "-o", "--output"),
    delay: float = typer.Option(0.15, "--delay", help="Politeness delay between fetches"),
):
    import os
    # creds from the backend .env (grep only the two we need; that file has values
    # with spaces/& that break `source`, so parse the lines directly).
    env = Path(__file__).resolve().parents[2] / "apps" / "backend" / ".env"
    user = pw = None
    for line in env.read_text().splitlines():
        if line.startswith("CENSUS_USERNAME="):
            user = line.split("=", 1)[1].strip()
        elif line.startswith("CENSUS_PASSWORD="):
            pw = line.split("=", 1)[1].strip()

    with httpx.Client(timeout=60.0) as client:
        if not login(client, user, pw):
            typer.echo("login failed", err=True)
            raise typer.Exit(1)
        typer.echo(f"logged in; listing {state}/{district}/{subdistrict}")
        ids = list_subdistrict(client, state, district, subdistrict)
        typer.echo(f"{len(ids)} weaver ids")

        out_path = Path(output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        ok = skip = 0
        with out_path.open("w") as f:
            for i, (cid, photo) in enumerate(ids, 1):
                try:
                    rec = fetch_record(client, cid, photo)
                except Exception as e:
                    typer.echo(f"  {cid}: error {e}", err=True)
                    rec = None
                if rec is None:
                    skip += 1
                else:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    ok += 1
                if i % 20 == 0:
                    typer.echo(f"  {i}/{len(ids)} (ok={ok} skip={skip})")
                time.sleep(delay)
        typer.echo(f"done: {ok} records -> {out_path}  (skipped {skip})")


if __name__ == "__main__":
    cli()
