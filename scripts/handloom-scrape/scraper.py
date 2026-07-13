"""
Handloom Weaver Census Scraper

Scrapes all ~3.5M weaver records from the Census Portal (tricorniotec.com/webapp)
into local JSONL files with checkpointing, retry, and failure handling.

Usage:
    python scraper.py --start 15000 --end 3850000 --output ./data --concurrent 100
    python scraper.py --resume --output ./data                # Resume from checkpoint
    python scraper.py --stats --output ./data                  # Show scrape stats
"""

import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from httpx import AsyncClient, Response
from rich.console import Console
from rich.progress import (
    BarColumn,
    Progress,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.table import Table
from rich.live import Live
from rich.layout import Layout
from rich.panel import Panel
import typer

from parser import parse_weaver_page, WeaverRecord

app = typer.Typer()
console = Console()

BASE_URL = "https://tricorniotec.com/webapp"
LOGIN_URL = f"{BASE_URL}/portal/login"
DASHBOARD_URL = f"{BASE_URL}/ministry/dashboard"
WEAVER_URL = f"{BASE_URL}/Master/weaverInfo"

BATCH_SIZE = 1000
MAX_RETRIES = 3
RETRY_DELAY = 2

DATA_DIR = Path("data")


class ScrapeStats:
    def __init__(self):
        self.processed = 0
        self.success = 0
        self.failed = 0
        self.empty = 0
        self.retried = 0
        self.start_time = time.time()
        self.last_batch_time = time.time()

    @property
    def elapsed(self) -> float:
        return time.time() - self.start_time

    @property
    def rate(self) -> float:
        elapsed = self.elapsed
        return self.success / elapsed if elapsed > 0 else 0

    def summary(self) -> dict:
        return {
            "processed": self.processed,
            "success": self.success,
            "failed": self.failed,
            "empty": self.empty,
            "retried": self.retried,
            "elapsed_seconds": self.elapsed,
            "rate_per_second": round(self.rate, 2),
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }


class SessionManager:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.cookies: dict = {}
        self._lock = asyncio.Lock()

    async def ensure_session(self, client: AsyncClient) -> bool:
        async with self._lock:
            if self._check_session_valid(client):
                return True
            return await self._login(client)

    def _check_session_valid(self, client: AsyncClient) -> bool:
        return bool(self.cookies)

    async def _login(self, client: AsyncClient) -> bool:
        login_data = {
            "username": self.username,
            "password": self.password,
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        login_resp = await client.post(
            LOGIN_URL, data=login_data, headers=headers, follow_redirects=True
        )
        if login_resp.status_code == 200 and "dashboard" in login_resp.url.path:
            self.cookies = dict(login_resp.cookies)
            console.print("[green]Login successful[/green]")
            return True
        console.print(f"[red]Login failed: {login_resp.status_code}[/red]")
        return False

    def get_cookie_header(self) -> dict:
        ci_session = self.cookies.get("ci_session", "")
        return {"Cookie": f"ci_session={ci_session}"}


async def fetch_weaver(
    client: AsyncClient, census_id: int, session: SessionManager, sem: asyncio.Semaphore
) -> Optional[WeaverRecord]:
    async with sem:
        for attempt in range(MAX_RETRIES):
            try:
                await session.ensure_session(client)

                resp = await client.get(
                    WEAVER_URL,
                    params={"Id": census_id},
                    headers={
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                        **session.get_cookie_header(),
                    },
                    follow_redirects=True,
                    timeout=30.0,
                )

                if resp.status_code == 302:
                    await session.ensure_session(client)
                    continue

                if resp.status_code != 200:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                    continue

                if len(resp.text) < 1000:
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                        continue
                    return None

                record = parse_weaver_page(resp.text, census_id)
                return record

            except (httpx.TimeoutException, httpx.HTTPStatusError,
                    httpx.ConnectError, httpx.RemoteProtocolError) as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                return None

        return None


async def process_batch(
    client: AsyncClient,
    ids: list[int],
    session: SessionManager,
    sem: asyncio.Semaphore,
    stats: ScrapeStats,
    output_dir: Path,
    batch_num: int,
) -> tuple[int, int, int]:
    results = await asyncio.gather(
        *[fetch_weaver(client, cid, session, sem) for cid in ids],
        return_exceptions=True,
    )

    records = []
    failures = []
    success_count = 0
    empty_count = 0
    fail_count = 0

    for cid, result in zip(ids, results):
        if isinstance(result, WeaverRecord) and result.name:
            records.append(result.model_dump(mode="json"))
            success_count += 1
        elif isinstance(result, WeaverRecord) and not result.name:
            records.append(result.model_dump(mode="json"))
            empty_count += 1
        else:
            failures.append({"id": cid, "error": str(result) if result else "timeout/empty"})
            fail_count += 1

    if records:
        batch_file = output_dir / "batches" / f"{batch_num:06d}.jsonl"
        batch_file.parent.mkdir(parents=True, exist_ok=True)
        with open(batch_file, "w") as f:
            for r in records:
                f.write(json.dumps(r, default=str) + "\n")

    if failures:
        fail_file = output_dir / "failures" / f"{batch_num:06d}.json"
        fail_file.parent.mkdir(parents=True, exist_ok=True)
        with open(fail_file, "w") as f:
            json.dump(failures, f, indent=2)

    stats.processed += len(ids)
    stats.success += success_count
    stats.empty += empty_count
    stats.failed += fail_count

    return success_count, fail_count, empty_count


def save_checkpoint(output_dir: Path, last_id: int, stats: ScrapeStats):
    cp = output_dir / "checkpoint.json"
    cp.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "last_id": last_id,
        "stats": stats.summary(),
    }
    with open(cp, "w") as f:
        json.dump(data, f, indent=2)


def load_checkpoint(output_dir: Path) -> Optional[int]:
    cp = output_dir / "checkpoint.json"
    if cp.exists():
        data = json.loads(cp.read_text())
        return data.get("last_id")
    return None


@app.command()
def run(
    start: int = typer.Option(15000, "--start", "-s", help="Starting census ID"),
    end: int = typer.Option(3850000, "--end", "-e", help="Ending census ID"),
    output: str = typer.Option("./data", "--output", "-o", help="Output directory"),
    concurrent: int = typer.Option(100, "--concurrent", "-c", help="Concurrent requests"),
    username: str = typer.Option("", "--username", "-u", envvar="CENSUS_USERNAME", help="Census portal username"),
    password: str = typer.Option("", "--password", "-p", envvar="CENSUS_PASSWORD", help="Census portal password"),
    resume: bool = typer.Option(False, "--resume", "-r", help="Resume from checkpoint"),
    stats_only: bool = typer.Option(False, "--stats", help="Show stats and exit"),
    limit: int = typer.Option(0, "--limit", "-l", help="Limit total IDs to scrape (for testing)"),
):
    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "batches").mkdir(parents=True, exist_ok=True)
    (output_dir / "failures").mkdir(parents=True, exist_ok=True)

    if stats_only:
        show_stats(output_dir)
        raise typer.Exit()

    if not username or not password:
        console.print("[red]Error: CENSUS_USERNAME and CENSUS_PASSWORD must be set[/red]")
        console.print("  Set via --username/--password flags or CENSUS_USERNAME/CENSUS_PASSWORD env vars")
        raise typer.Exit(1)

    if resume:
        checkpoint = load_checkpoint(output_dir)
        if checkpoint:
            start = checkpoint + 1
            console.print(f"[yellow]Resuming from ID {start}[/yellow]")
        else:
            console.print("[yellow]No checkpoint found, starting from --start[/yellow]")

    ids_to_scrape = list(range(start, end + 1))
    if limit > 0:
        ids_to_scrape = ids_to_scrape[:limit]

    total = len(ids_to_scrape)
    console.print(f"[bold]Scraping {total} weaver IDs[/bold]")
    console.print(f"  Range: {ids_to_scrape[0]} - {ids_to_scrape[-1]}")
    console.print(f"  Concurrent: {concurrent}")
    console.print(f"  Batch size: {BATCH_SIZE}")
    console.print(f"  Output: {output_dir.resolve()}")
    console.print()

    stats = ScrapeStats()
    session = SessionManager(username, password)
    sem = asyncio.Semaphore(concurrent)

    batches = [ids_to_scrape[i:i + BATCH_SIZE] for i in range(0, len(ids_to_scrape), BATCH_SIZE)]

    progress = Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        TextColumn("[bold]{task.completed}/{task.total}[/bold]"),
        TextColumn("•"),
        TimeElapsedColumn(),
        TimeRemainingColumn(),
        TextColumn("• [cyan]{task.fields[rate]} IDs/s[/cyan]"),
        TextColumn("• [red]{task.fields[fails]} fails[/red]"),
    )

    async def run_scraper():
        async with AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_keepalive_connections=concurrent, max_connections=concurrent * 2),
        ) as client:
            task = progress.add_task(
                "[cyan]Scraping weavers...[/cyan]",
                total=len(batches),
                rate="0.0",
                fails="0",
            )

            with progress:
                for i, batch_ids in enumerate(batches):
                    s, f, e = await process_batch(
                        client, batch_ids, session, sem, stats, output_dir, i + 1
                    )

                    progress.update(
                        task,
                        advance=1,
                        rate=f"{stats.rate:.1f}",
                        fails=str(stats.failed),
                    )

                    if (i + 1) % 10 == 0:
                        save_checkpoint(output_dir, batch_ids[-1], stats)

            save_checkpoint(output_dir, batches[-1][-1], stats)

        print_summary(stats)

    asyncio.run(run_scraper())


@app.command()
def resume(
    output: str = typer.Option("./data", "--output", "-o"),
    concurrent: int = typer.Option(100, "--concurrent", "-c"),
    username: str = typer.Option("", "--username", "-u", envvar="CENSUS_USERNAME"),
    password: str = typer.Option("", "--password", "-p", envvar="CENSUS_PASSWORD"),
):
    run.callback(
        start=15000, end=3850000, output=output, concurrent=concurrent,
        username=username, password=password, resume=True, stats_only=False, limit=0,
    )


@app.command()
def stats(
    output: str = typer.Option("./data", "--output", "-o"),
):
    show_stats(Path(output))


def show_stats(output_dir: Path):
    cp = output_dir / "checkpoint.json"
    if not cp.exists():
        console.print("[red]No checkpoint found[/red]")
        raise typer.Exit(1)

    data = json.loads(cp.read_text())
    stats = data.get("stats", {})
    batches_dir = output_dir / "batches"
    failures_dir = output_dir / "failures"

    batch_count = len(list(batches_dir.glob("*.jsonl"))) if batches_dir.exists() else 0
    fail_count = len(list(failures_dir.glob("*.json"))) if failures_dir.exists() else 0

    total_records = 0
    if batches_dir.exists():
        for f in sorted(batches_dir.glob("*.jsonl")):
            total_records += sum(1 for _ in f.read_text().splitlines() if _.strip())

    total_failures = 0
    if failures_dir.exists():
        for f in sorted(failures_dir.glob("*.json")):
            try:
                total_failures += len(json.loads(f.read_text()))
            except Exception:
                total_failures += 1

    table = Table(title="Scrape Statistics")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Last ID", str(data.get("last_id", "?")))
    table.add_row("Total Records Scraped", str(total_records))
    table.add_row("Total Failures", str(total_failures))
    table.add_row("Batch Files", str(batch_count))
    table.add_row("Failure Files", str(fail_count))
    table.add_row("Elapsed (s)", str(round(stats.get("elapsed_seconds", 0), 1)))
    table.add_row("Rate (IDs/s)", str(stats.get("rate_per_second", 0)))
    table.add_row("Last Updated", stats.get("last_updated", "?"))

    console.print(table)


def print_summary(stats: ScrapeStats):
    table = Table(title="Scrape Complete")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Total Processed", str(stats.processed))
    table.add_row("Successful", str(stats.success))
    table.add_row("Empty", str(stats.empty))
    table.add_row("Failed", str(stats.failed))
    table.add_row("Elapsed", f"{stats.elapsed:.1f}s")
    table.add_row("Average Rate", f"{stats.rate:.1f} IDs/s")

    console.print(table)


if __name__ == "__main__":
    app()
