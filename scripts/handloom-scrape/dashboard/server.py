"""
Verification Dashboard — browse, search, and approve/flag/reject scraped weaver records.

Usage:
    python dashboard/server.py --data ../data --port 8080
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import typer

cli = typer.Typer()
DATA_DIR = Path("data")


def load_all_records(data_dir: Path, max_files: int = 0) -> list[dict]:
    records = []
    batches_dir = data_dir / "batches"
    if not batches_dir.exists():
        return records
    files = sorted(batches_dir.glob("*.jsonl"))
    if max_files > 0:
        files = files[:max_files]
    for f in files:
        for line in f.read_text().splitlines():
            if line.strip():
                try:
                    records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return records


def get_app(data_dir: Path):
    app = FastAPI(title="Handloom Weaver Verification Dashboard")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    records_cache: list[dict] = []
    verified: dict[int, str] = {}  # census_id -> verdict (approved/flagged/rejected)
    notes: dict[int, str] = {}

    @app.on_event("startup")
    async def load_data():
        nonlocal records_cache
        records_cache = load_all_records(data_dir)
        print(f"Loaded {len(records_cache)} records")

        ver_path = data_dir / "verified"
        ver_path.mkdir(parents=True, exist_ok=True)
        if (ver_path / "approved.jsonl").exists():
            for line in (ver_path / "approved.jsonl").read_text().splitlines():
                if line.strip():
                    try:
                        r = json.loads(line)
                        verified[r.get("census_id")] = "approved"
                    except Exception:
                        pass
        if (ver_path / "flags.jsonl").exists():
            for line in (ver_path / "flags.jsonl").read_text().splitlines():
                if line.strip():
                    try:
                        r = json.loads(line)
                        verified[r.get("census_id")] = "flagged"
                    except Exception:
                        pass
        if (ver_path / "rejected.jsonl").exists():
            for line in (ver_path / "rejected.jsonl").read_text().splitlines():
                if line.strip():
                    try:
                        r = json.loads(line)
                        verified[r.get("census_id")] = "rejected"
                    except Exception:
                        pass

    @app.get("/", response_class=HTMLResponse)
    async def index():
        total = len(records_cache)
        approved_count = sum(1 for v in verified.values() if v == "approved")
        flagged_count = sum(1 for v in verified.values() if v == "flagged")
        rejected_count = sum(1 for v in verified.values() if v == "rejected")
        pending = total - len(verified)

        return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Handloom Weaver Verification Dashboard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
const API = '';
let allRecords = [];
let filteredRecords = [];
let currentPage = 1;
const PER_PAGE = 25;

async function loadStats() {{
    const r = await fetch(API + '/api/stats');
    const s = await r.json();
    document.getElementById('stats-total').textContent = s.total;
    document.getElementById('stats-approved').textContent = s.approved;
    document.getElementById('stats-pending').textContent = s.pending;
    document.getElementById('stats-flagged').textContent = s.flagged;
    document.getElementById('stats-rejected').textContent = s.rejected;
    document.getElementById('stats-failures').textContent = s.failures;
    document.getElementById('search-count').textContent =
        filteredRecords.length > 0 ? `Showing {{filteredRecords.length}} of {{s.total}}` : '';
}}

async function fetchRecords() {{
    const r = await fetch(API + '/api/records?limit=500');
    allRecords = await r.json();
    filteredRecords = [...allRecords];
    renderTable();
    loadStats();
}}

function renderTable() {{
    const start = (currentPage - 1) * PER_PAGE;
    const page = filteredRecords.slice(start, start + PER_PAGE);
    const tbody = document.getElementById('records-body');
    tbody.innerHTML = '';
    page.forEach(r => {{
        const verdict = r._verdict || '';
        const name = r.name || 'N/A';
        const state = r.state || '';
        const district = r.district || '';
        const phone = r.mobile || '';
        const age = r.age ?? '';
        const gender = r.gender || '';
        const hasLoom = r.own_looms ? 'Yes' : (r.own_looms === false ? 'No' : '');
        const income = r.monthly_income || '';
        const bg = verdict === 'approved' ? 'bg-green-50' :
                   verdict === 'flagged' ? 'bg-yellow-50' :
                   verdict === 'rejected' ? 'bg-red-50' : '';
        const btnDisabled = verdict ? 'opacity-50 cursor-not-allowed' : '';
        tr = document.createElement('tr');
        tr.className = `hover:bg-gray-100 ${{bg}}`;
        tr.innerHTML = `
            <td class="px-2 py-1 text-xs font-mono"><a href="javascript:void(0)" onclick='showDetail(${{JSON.stringify(r).replace(/'/g,"&#39;")}})' class="text-blue-600 hover:underline">${{r.census_id}}</a></td>
            <td class="px-2 py-1">${{esc(name)}}</td>
            <td class="px-2 py-1 text-xs">${{esc(state)}}</td>
            <td class="px-2 py-1 text-xs">${{esc(district)}}</td>
            <td class="px-2 py-1 text-xs">${{phone}}</td>
            <td class="px-2 py-1 text-xs">${{gender}}</td>
            <td class="px-2 py-1 text-xs">${{age}}</td>
            <td class="px-2 py-1 text-xs">${{hasLoom}}</td>
            <td class="px-2 py-1 text-xs">${{income}}</td>
            <td class="px-2 py-1 whitespace-nowrap">
                <button onclick="verdict(${{r.census_id}},'approved')" class="text-xs px-2 py-0.5 rounded bg-green-500 text-white ${{btnDisabled}}">✓</button>
                <button onclick="verdict(${{r.census_id}},'flagged')" class="text-xs px-2 py-0.5 rounded bg-yellow-500 text-white ${{btnDisabled}}">!</button>
                <button onclick="verdict(${{r.census_id}},'rejected')" class="text-xs px-2 py-0.5 rounded bg-red-500 text-white ${{btnDisabled}}">✗</button>
            </td>
        `;
        tbody.appendChild(tr);
    }});
    document.getElementById('page-info').textContent =
        `Page ${{currentPage}} of ${{Math.ceil(filteredRecords.length/PER_PAGE)}} (${{filteredRecords.length}} total)`;
}}

function esc(s) {{ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }}

async function verdict(id, v) {{
    await fetch(API + '/api/verdict', {{
        method: 'POST',
        headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{census_id: id, verdict: v}})
    }});
    const r = allRecords.find(x => x.census_id === id);
    if (r) r._verdict = v;
    renderTable();
    loadStats();
}}

function showDetail(r) {{
    const d = document.getElementById('detail-panel');
    const sections = [];
    const add = (label, val) => {{
        if (val !== null && val !== undefined && val !== '') {{
            sections.push(`<div class="flex py-1"><span class="w-1/3 text-gray-500 text-xs">${{label}}</span><span class="w-2/3 text-xs">${{esc(val)}}</span></div>`);
        }}
    }};
    add('Name', r.name);
    add('Census ID', r.census_id);
    add('Mobile', r.mobile);
    add('Gender', r.gender);
    add('Age', r.age);
    add('Education', r.education);
    add('State', r.state);
    add('District', r.district);
    add('Block', r.block);
    add('Village', r.village);
    add('House', r.house_no);
    add('Pin Code', r.pin_code);
    add('Rural/Urban', r.rural_urban);
    add('Latitude', r.latitude);
    add('Longitude', r.longitude);
    add('Head of Household', r.head_of_household);
    add('Relation to Head', r.relation_to_head);
    add('Religion', r.religion);
    add('Social Group', r.social_group);
    add('Household Size', r.household_size);
    add('Monthly Income', r.monthly_income);
    add('Handloom Income', r.handloom_income);
    add('Household Type', r.household_type);
    add('Own Looms', r.own_looms);
    add('Total Looms', r.total_looms_owned);
    add('Pit Looms', r.pit_loom_count);
    add('Frame Looms', r.frame_loom_count);
    add('Avg Production (m)', r.avg_production_meters);
    add('Intricacy', r.intricacy_level);
    add('Natural Dye', r.natural_dye_used);
    add('Survey Date', r.survey_date);
    if (r.support_requirements && r.support_requirements.length) {{
        add('Support Needed', r.support_requirements.join(', '));
    }}
    if (r.family_weavers && r.family_weavers.length) {{
        sections.push('<div class="mt-2 pt-2 border-t"><span class="text-xs font-bold">Family Weavers:</span></div>');
        r.family_weavers.forEach(fw => {{
            sections.push(`<div class="flex py-0.5"><span class="w-1/3 text-gray-500 text-xs">${{esc(fw.name)}}</span><span class="w-2/3 text-xs">Age: ${{fw.age ?? '?'}} | ${{esc(fw.gender)}} | ${{esc(fw.mobile || '')}}</span></div>`);
        }});
    }}
    d.innerHTML = sections.join('');
    document.getElementById('detail-title').textContent = `Weaver #${{r.census_id}} - ${{esc(r.name)}}`;
    document.getElementById('detail-view').classList.remove('hidden');
}}

function search() {{
    const q = document.getElementById('search-input').value.toLowerCase();
    if (!q) {{
        filteredRecords = [...allRecords];
    }} else {{
        filteredRecords = allRecords.filter(r =>
            (r.name || '').toLowerCase().includes(q) ||
            (r.state || '').toLowerCase().includes(q) ||
            (r.district || '').toLowerCase().includes(q) ||
            (r.village || '').toLowerCase().includes(q) ||
            (r.mobile || '').includes(q) ||
            String(r.census_id).includes(q)
        );
    }}
    currentPage = 1;
    renderTable();
    document.getElementById('search-count').textContent = `Found ${{filteredRecords.length}} records`;
}}

function filterState() {{
    const state = document.getElementById('state-filter').value;
    if (!state) {{
        filteredRecords = [...allRecords];
    }} else {{
        filteredRecords = allRecords.filter(r => (r.state || '') === state);
    }}
    currentPage = 1;
    renderTable();
}}

function filterVerdict() {{
    const v = document.getElementById('verdict-filter').value;
    if (!v) {{
        filteredRecords = [...allRecords];
    }} else if (v === 'pending') {{
        filteredRecords = allRecords.filter(r => !r._verdict);
    }} else {{
        filteredRecords = allRecords.filter(r => r._verdict === v);
    }}
    currentPage = 1;
    renderTable();
}}

async function exportApproved() {{
    const r = await fetch(API + '/api/export/approved');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'approved-weavers.csv';
    a.click();
    URL.revokeObjectURL(url);
}}

function prevPage() {{ if (currentPage > 1) {{ currentPage--; renderTable(); }} }}
function nextPage() {{ if (currentPage * PER_PAGE < filteredRecords.length) {{ currentPage++; renderTable(); }} }}

window.onload = fetchRecords;
</script>
</head>
<body class="bg-gray-50 text-gray-800">
<div class="max-w-7xl mx-auto px-4 py-4">
    <div class="flex justify-between items-center mb-4">
        <h1 class="text-2xl font-bold">🪡 Handloom Weaver Verification</h1>
        <button onclick="exportApproved()" class="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700">Export Approved CSV</button>
    </div>

    <div class="grid grid-cols-5 gap-3 mb-4 text-center">
        <div class="bg-white p-3 rounded shadow"><div class="text-2xl font-bold" id="stats-total">-</div><div class="text-xs text-gray-500">Total</div></div>
        <div class="bg-green-50 p-3 rounded shadow"><div class="text-2xl font-bold text-green-700" id="stats-approved">-</div><div class="text-xs text-gray-500">Approved</div></div>
        <div class="bg-gray-50 p-3 rounded shadow"><div class="text-2xl font-bold" id="stats-pending">-</div><div class="text-xs text-gray-500">Pending</div></div>
        <div class="bg-yellow-50 p-3 rounded shadow"><div class="text-2xl font-bold text-yellow-700" id="stats-flagged">-</div><div class="text-xs text-gray-500">Flagged</div></div>
        <div class="bg-red-50 p-3 rounded shadow"><div class="text-2xl font-bold text-red-700" id="stats-rejected">-</div><div class="text-xs text-gray-500">Rejected</div></div>
    </div>

    <div class="flex gap-2 mb-3 items-center">
        <input id="search-input" onkeyup="search()" placeholder="Search name, state, district, phone, ID..." class="flex-1 p-2 border rounded text-sm">
        <select id="state-filter" onchange="filterState()" class="p-2 border rounded text-sm">
            <option value="">All States</option>
        </select>
        <select id="verdict-filter" onchange="filterVerdict()" class="p-2 border rounded text-sm">
            <option value="">All Verdicts</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
            <option value="rejected">Rejected</option>
        </select>
        <span id="search-count" class="text-xs text-gray-500"></span>
    </div>

    <div class="flex gap-4">
        <div class="flex-1">
            <div class="bg-white rounded shadow overflow-x-auto">
                <table class="w-full text-sm">
                    <thead><tr class="bg-gray-100 text-left text-xs uppercase">
                        <th class="px-2 py-2">ID</th>
                        <th class="px-2 py-2">Name</th>
                        <th class="px-2 py-2">State</th>
                        <th class="px-2 py-2">District</th>
                        <th class="px-2 py-2">Phone</th>
                        <th class="px-2 py-2">Gender</th>
                        <th class="px-2 py-2">Age</th>
                        <th class="px-2 py-2">Loom</th>
                        <th class="px-2 py-2">Income</th>
                        <th class="px-2 py-2">Verdict</th>
                    </tr></thead>
                    <tbody id="records-body"></tbody>
                </table>
            </div>
            <div class="flex justify-between items-center mt-2 text-sm">
                <span id="page-info" class="text-gray-500"></span>
                <div class="flex gap-1">
                    <button onclick="prevPage()" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-xs">← Prev</button>
                    <button onclick="nextPage()" class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-xs">Next →</button>
                </div>
            </div>
        </div>

        <div id="detail-view" class="hidden w-96 bg-white rounded shadow p-4">
            <h2 id="detail-title" class="text-sm font-bold mb-2"></h2>
            <div id="detail-panel" class="text-sm max-h-[70vh] overflow-y-auto"></div>
        </div>
    </div>
</div>
</body>
</html>"""

    @app.get("/api/stats")
    async def api_stats():
        total = len(records_cache)
        approved = sum(1 for v in verified.values() if v == "approved")
        flagged = sum(1 for v in verified.values() if v == "flagged")
        rejected = sum(1 for v in verified.values() if v == "rejected")
        pending = total - approved - flagged - rejected
        failures_dir = data_dir / "failures"
        failures = 0
        if failures_dir.exists():
            for f in failures_dir.glob("*.json"):
                try:
                    failures += len(json.loads(f.read_text()))
                except Exception:
                    failures += 1
        return {
            "total": total,
            "approved": approved,
            "flagged": flagged,
            "rejected": rejected,
            "pending": pending,
            "failures": failures,
        }

    @app.get("/api/records")
    async def api_records(limit: int = Query(500, le=5000), offset: int = Query(0)):
        records = records_cache[offset:offset + limit]
        for r in records:
            r["_verdict"] = verified.get(r.get("census_id"), "")
        return records

    @app.get("/api/states")
    async def api_states():
        states = sorted(set(r.get("state", "") for r in records_cache if r.get("state")))
        return states

    @app.post("/api/verdict")
    async def api_verdict(data: dict):
        cid = data.get("census_id")
        v = data.get("verdict")
        if not cid or v not in ("approved", "flagged", "rejected"):
            raise HTTPException(400, "Invalid data")
        verified[cid] = v
        ver_path = data_dir / "verified"
        ver_path.mkdir(parents=True, exist_ok=True)
        record = next((r for r in records_cache if r.get("census_id") == cid), None)
        if record:
            filename = {"approved": "approved.jsonl", "flagged": "flags.jsonl", "rejected": "rejected.jsonl"}[v]
            with open(ver_path / filename, "a") as f:
                f.write(json.dumps(record, default=str) + "\n")
        return {"ok": True}

    @app.get("/api/export/approved")
    async def export_approved():
        import csv
        from io import StringIO
        approved_records = [r for r in records_cache if verified.get(r.get("census_id")) == "approved"]
        output = StringIO()
        fieldnames = [
            "census_id", "name", "mobile", "gender", "age", "education",
            "state", "district", "block", "village", "house_no", "pin_code",
            "latitude", "longitude", "religion", "social_group",
            "household_size", "monthly_income", "handloom_income",
            "own_looms", "total_looms_owned", "pit_loom_count", "frame_loom_count",
            "avg_production_meters", "natural_dye_used",
            "support_requirements", "survey_date",
        ]
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in approved_records:
            writer.writerow(r)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=approved-weavers.csv"},
        )

    @app.get("/health")
    async def health():
        return {"ok": True, "records_loaded": len(records_cache)}

    return app


@cli.command()
def serve(
    data: str = typer.Option("./data", "--data", "-d", help="Scrape data directory"),
    port: int = typer.Option(8080, "--port", "-p", help="Dashboard port"),
    reload: bool = typer.Option(False, "--reload", help="Auto-reload on changes"),
):
    app = get_app(Path(data))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=reload)


if __name__ == "__main__":
    cli()
