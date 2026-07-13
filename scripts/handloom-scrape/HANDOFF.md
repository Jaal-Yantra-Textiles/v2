# Handloom Weaver Scrape — Agent Handoff

## What we're doing

Scraping all ~3.5M individual handloom weaver records from the Census Portal (tricorniotec.com/webapp), verifying them through a dashboard, and importing approved records into the Medusa Persons module so weavers appear on the `/map` page and can be onboarded as partners.

## Pipeline

```
Census Portal  ──►  scraper.py  ──►  data/batches/*.jsonl  ──►  dashboard  ──►  data/verified/approved.jsonl  ──►  import_to_persons.py  ──►  Medusa Persons API
      │                    │                    │                         │                            │                              │
  HTML pages          checkpoint           3.5M raw                 browse/search/              approved subset               email + name + address
  (92KB each)        every 10 batches      records                  approve/flag/reject          + phone + tags                + public_metadata JSON
```

## Required credentials

| Variable | Source | Purpose |
|----------|--------|---------|
| `CENSUS_USERNAME` | Census Portal admin at tricorniotec.com | Login for scraping |
| `CENSUS_PASSWORD` | Census Portal admin | Login for scraping |
| `MEDUSA_ADMIN_URL` | Your Medusa deployment (e.g. http://localhost:9000) | Import target |
| `MEDUSA_API_KEY` | Medusa admin settings → API tokens | Auth for import |

## Step-by-step

```bash
# 1. Install Python dependencies
pip install -r scripts/handloom-scrape/requirements.txt

# 2. Set credentials
export CENSUS_USERNAME="your_username"
export CENSUS_PASSWORD="your_password"
export MEDUSA_ADMIN_URL="http://localhost:9000"
export MEDUSA_API_KEY="your_api_key"

# 3. IMPORTANT: Smoke-test with a tiny range first
python scripts/handloom-scrape/scraper.py run --start 15000 --end 16000

# 4. Check the output
python scripts/handloom-scrape/scraper.py stats

# 5. If that works, run the full scrape
python scripts/handloom-scrape/scraper.py run --start 15000 --end 3850000
#   - ~10 hours at 100 concurrent connections
#   - Resume if interrupted: python scraper.py resume
#   - Check progress anytime: python scraper.py stats

# 6. Launch the verification dashboard (binds to localhost only — PII data!)
python scripts/handloom-scrape/dashboard/server.py --data ./data --port 8080
#   Open http://127.0.0.1:8080 in a browser
#   Browse, search, and click ✓ ! ✗ to approve/flag/reject records
#   Export approved records as CSV via the button in the header

# 7. Validate the import payload shape
python scripts/handloom-scrape/import_to_persons.py --data ./data --dry-run --max 5

# 8. If payload is valid, import a tiny batch to test the live API
python scripts/handloom-scrape/import_to_persons.py --data ./data --max 5

# 9. Import all approved records
python scripts/handloom-scrape/import_to_persons.py --data ./data
```

## Files

| File | Purpose |
|------|---------|
| `scraper.py` | Async scraper with checkpointing, retry, session management |
| `parser.py` | HTML → WeaverRecord extraction (50+ fields) |
| `dashboard/server.py` | FastAPI + Tailwind verification UI |
| `import_to_persons.py` | Approved records → Medusa Persons API (3-step: person, contact, tags) |
| `.env.example` | Credential template |
| `requirements.txt` | Python dependencies |

## Known issues / pre-flight checks

1. **Session login** — scraper's re-login logic is UNVERIFIED against the live portal. Always run with `--limit` first (e.g. `--start 15000 --end 16000`) to confirm login + data extraction work before the full run.

2. **Import payload** — the import script calls three separate endpoints per record:
   - `POST /admin/persons` — creates person with first_name, last_name, email (auto-generated `weaver.{census_id}@handloom.gov.in`), addresses, public_metadata
   - `POST /admin/persons/{id}/contacts` — adds phone as contact_detail
   - `POST /admin/persons/{id}/tags` — adds inferred tags one by one
   
   Always `--dry-run` + `--max 5` against the live API before bulk import.

3. **PII sensitivity** — this pipeline handles ~3.5M people's names, phone numbers, Aadhaar flags, family bank details, and GPS coordinates:
   - Dashboard binds to **127.0.0.1 only** (never expose)
   - Do not commit raw data or logs
   - Destroy `data/` directory after import

4. **Empty pages** — IDs before ~15000 return HTTP 200 with no data. Scraper logs these as "empty" not "failed".
