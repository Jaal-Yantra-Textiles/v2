#!/usr/bin/env python3
"""Census data-integrity audit with auto-repair feed (#1031).

Verifies that the crawled census faithfully reflects the SOURCE portal, and emits
a repair feed the Node applier (hyperbee-slice/apply_repairs.mjs) folds back into
the PUBLIC core with agg/idx consistency.

How it works:
  1. Stratified-sample census_ids across the crawled id range (even coverage —
     each stratum sampled independently so a bad region can't hide behind good
     ones).
  2. Re-fetch each sampled id from the source portal (reuses the scraper's
     authenticated fetch + parser — the exact path the crawl used).
  3. Diff the fresh record against what was stored in the crawl output, field by
     field. Classify: OK / MISMATCH / MISSING_IN_STORE / MISSING_AT_SOURCE /
     UNREACHABLE.
  4. Write a report (markdown + json): sample size, error rates, per-field
     mismatch tally, coverage, and the suspect ids.
  5. With --repair, write the CORRECTED full records (source-truth) to
     repairs/<ts>.jsonl. Apply them agg/idx-safely with:
        sudo systemctl stop handloom-seed
        cd hyperbee-slice
        P2P_STORE=/opt/handloom/p2p-store node apply_repairs.mjs ../<repairs.jsonl> --apply
        sudo systemctl start handloom-seed

Run gently — this hits the live source. Default concurrency is low on purpose.

  CENSUS_USERNAME=… CENSUS_PASSWORD=… \
    python audit_census.py --sample 500 --strata 50 \
      --stored-dir ./data/live --out ./audit-out --repair

Designed to run slow over a long window (e.g. a nightly cron sampling a slice),
so a full-corpus faithfulness picture builds up without hammering the source.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import httpx

from scraper import SessionManager, fetch_weaver

# Fields compared for faithfulness. Volatile / presentation-only fields (photo
# urls, survey_date, family member ordering) are excluded so we flag real data
# drift, not churn. Extend as needed.
COMPARE_FIELDS = [
    "name", "head_of_household", "relation_to_head", "gender", "age", "education",
    "religion", "social_group", "mobile", "village", "block", "district", "state",
    "rural_urban", "pin_code", "household_size", "household_type", "dwelling_type",
    "ownership_type", "electricity", "own_looms", "total_looms_owned",
    "pit_loom_count", "frame_loom_count", "loin_loom_count", "other_loom_count",
    "natural_dye_used", "sells_local_market", "sells_master_weaver",
    "sells_cooperative", "sells_ecommerce",
]


def stratified_sample(max_id: int, sample: int, strata: int, min_id: int = 1) -> list[int]:
    """Even coverage: split [min_id, max_id] into `strata` buckets and draw
    round(sample/strata) distinct ids from each."""
    strata = max(1, min(strata, sample))
    per = max(1, round(sample / strata))
    span = max_id - min_id + 1
    width = max(1, span // strata)
    ids: set[int] = set()
    for s in range(strata):
        lo = min_id + s * width
        hi = min_id + (s + 1) * width - 1 if s < strata - 1 else max_id
        if hi < lo:
            continue
        k = min(per, hi - lo + 1)
        ids.update(random.sample(range(lo, hi + 1), k))
    return sorted(ids)


def load_stored(stored_dir: Path, wanted: set[int]) -> dict[int, dict]:
    """One pass over the crawl jsonl, collecting only the sampled ids."""
    found: dict[int, dict] = {}
    if not stored_dir.exists():
        return found
    for path in stored_dir.rglob("*.jsonl"):
        with path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                cid = rec.get("census_id")
                if cid in wanted:
                    found[cid] = rec
        if len(found) == len(wanted):
            break
    return found


def diff_record(stored: dict, fresh: dict) -> list[dict]:
    """Field-level differences on COMPARE_FIELDS (normalised to strings)."""
    diffs = []
    for field in COMPARE_FIELDS:
        a = stored.get(field)
        b = fresh.get(field)
        if (a is None and b is None):
            continue
        if str(a) != str(b):
            diffs.append({"field": field, "stored": a, "source": b})
    return diffs


async def audit(args) -> dict:
    username = os.environ.get("CENSUS_USERNAME")
    password = os.environ.get("CENSUS_PASSWORD")
    if not username or not password:
        raise SystemExit("Set CENSUS_USERNAME and CENSUS_PASSWORD (source portal login).")

    max_id = args.max_id
    if not max_id:
        cp = Path(args.stored_dir) / "checkpoint.json"
        if cp.exists():
            max_id = int(json.loads(cp.read_text()).get("last_id", 0))
    if not max_id:
        raise SystemExit("Provide --max-id (or a checkpoint.json with last_id).")

    ids = stratified_sample(max_id, args.sample, args.strata, args.min_id)
    print(f"→ sampling {len(ids)} ids across [{args.min_id}, {max_id}] in {args.strata} strata")

    stored = load_stored(Path(args.stored_dir), set(ids))
    print(f"→ loaded {len(stored)} stored records for the sample")

    session = SessionManager(username, password)
    sem = asyncio.Semaphore(args.concurrency)

    buckets = {"OK": [], "MISMATCH": [], "MISSING_IN_STORE": [], "MISSING_AT_SOURCE": [], "UNREACHABLE": []}
    field_tally: dict[str, int] = {}
    repairs: list[dict] = []

    async with httpx.AsyncClient(follow_redirects=True) as client:
        for cid in ids:
            fresh_rec = await fetch_weaver(client, cid, session, sem)
            fresh = asdict(fresh_rec) if fresh_rec else None
            st = stored.get(cid)

            if fresh is None and st is None:
                buckets["MISSING_AT_SOURCE"].append(cid)  # neither has it → likely a real gap
            elif fresh is None:
                buckets["MISSING_AT_SOURCE"].append(cid)   # we stored it but source no longer serves it
            elif st is None:
                buckets["MISSING_IN_STORE"].append(cid)    # source has it, crawl missed it → repair
                repairs.append(fresh)
            else:
                diffs = diff_record(st, fresh)
                if not diffs:
                    buckets["OK"].append(cid)
                else:
                    buckets["MISMATCH"].append({"census_id": cid, "diffs": diffs})
                    for d in diffs:
                        field_tally[d["field"]] = field_tally.get(d["field"], 0) + 1
                    repairs.append(fresh)   # source is truth → repair with the fresh record

            # gentle pacing so a long run never hammers the source
            if args.delay:
                await asyncio.sleep(args.delay)

    checked = len(ids)
    ok = len(buckets["OK"])
    mism = len(buckets["MISMATCH"])
    miss_store = len(buckets["MISSING_IN_STORE"])
    result = {
        "generated_at": int(time.time()),
        "sampled": checked,
        "id_range": [args.min_id, max_id],
        "strata": args.strata,
        "counts": {k: len(v) for k, v in buckets.items()},
        "mismatch_rate": round(mism / checked, 4) if checked else 0,
        "missing_in_store_rate": round(miss_store / checked, 4) if checked else 0,
        "field_mismatch_tally": dict(sorted(field_tally.items(), key=lambda kv: -kv[1])),
        "suspect_ids": {
            "mismatch": [m["census_id"] for m in buckets["MISMATCH"]],
            "missing_in_store": buckets["MISSING_IN_STORE"],
            "missing_at_source": buckets["MISSING_AT_SOURCE"],
        },
        "details": buckets["MISMATCH"],
        "repairs_written": len(repairs) if args.repair else 0,
    }
    return result, repairs


def write_reports(result: dict, repairs: list[dict], out: Path, do_repair: bool):
    out.mkdir(parents=True, exist_ok=True)
    ts = result["generated_at"]
    (out / f"audit-{ts}.json").write_text(json.dumps(result, indent=2, default=str))

    c = result["counts"]
    lines = [
        f"# Census integrity audit — {ts}",
        "",
        f"- Sampled: **{result['sampled']}** ids across {result['id_range']} in {result['strata']} strata",
        f"- OK: **{c['OK']}**  ·  Mismatch: **{c['MISMATCH']}** ({result['mismatch_rate']:.2%})  ·  "
        f"Missing-in-store: **{c['MISSING_IN_STORE']}** ({result['missing_in_store_rate']:.2%})  ·  "
        f"Missing-at-source: **{c['MISSING_AT_SOURCE']}**  ·  Unreachable: **{c['UNREACHABLE']}**",
        "",
        "## Field mismatch tally",
        "",
        "| field | mismatches |",
        "| --- | --- |",
    ]
    for field, n in result["field_mismatch_tally"].items():
        lines.append(f"| {field} | {n} |")
    if not result["field_mismatch_tally"]:
        lines.append("| _none_ | 0 |")
    lines += ["", "## Suspect ids", "",
              f"- mismatch: `{result['suspect_ids']['mismatch']}`",
              f"- missing_in_store: `{result['suspect_ids']['missing_in_store']}`",
              f"- missing_at_source: `{result['suspect_ids']['missing_at_source']}`", ""]
    if do_repair:
        lines += [f"- Repairs written: **{result['repairs_written']}** → apply with `apply_repairs.mjs --apply`", ""]
    (out / f"audit-{ts}.md").write_text("\n".join(lines))

    if do_repair and repairs:
        rp = out / f"repairs-{ts}.jsonl"
        with rp.open("w") as f:
            for r in repairs:
                f.write(json.dumps(r, default=str) + "\n")
        print(f"→ wrote {len(repairs)} repairs → {rp}")

    print(f"→ report → {out / f'audit-{ts}.md'}")


def main():
    ap = argparse.ArgumentParser(description="Census data-integrity audit + auto-repair feed")
    ap.add_argument("--sample", type=int, default=500, help="total ids to sample")
    ap.add_argument("--strata", type=int, default=50, help="coverage buckets across the id range")
    ap.add_argument("--min-id", type=int, default=1)
    ap.add_argument("--max-id", type=int, default=0, help="0 → read checkpoint.json last_id")
    ap.add_argument("--stored-dir", default="./data/live", help="crawl jsonl dir")
    ap.add_argument("--out", default="./audit-out")
    ap.add_argument("--concurrency", type=int, default=2, help="in-flight source fetches (keep low)")
    ap.add_argument("--delay", type=float, default=0.25, help="seconds between fetches (be gentle)")
    ap.add_argument("--repair", action="store_true", help="emit corrected records to a repairs.jsonl")
    ap.add_argument("--seed", type=int, default=0, help="RNG seed for a reproducible sample (0 = random)")
    args = ap.parse_args()

    if args.seed:
        random.seed(args.seed)

    result, repairs = asyncio.run(audit(args))
    write_reports(result, repairs, Path(args.out), args.repair)
    c = result["counts"]
    print(f"\n✅ audit done — OK={c['OK']} mismatch={c['MISMATCH']} missing_in_store={c['MISSING_IN_STORE']} "
          f"missing_at_source={c['MISSING_AT_SOURCE']}")


if __name__ == "__main__":
    main()
