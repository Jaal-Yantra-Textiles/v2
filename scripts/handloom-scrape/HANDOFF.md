# Handloom Weaver Scrape — Agent Handoff

## Current State

**PRs merged:**
- #1029 — Initial scraper, parser, dashboard, import script (on `main`)
- #1030 — Fixes: PII lockdown, payload shape correction, HANDOFF.md (on `main`)

**What's done:** All code is written and on `main`. No data has been scraped yet.
**Next:** An agent needs credentials and must run the pipeline below.

## What we're building

Scrape all ~3.5M individual handloom weaver records from the Census Portal (tricorniotec.com/webapp), verify them through a dashboard, and import approved records into the Medusa Persons module so weavers appear on the `/map` page.

## Pipeline

```
Census Portal  ──►  scraper.py  ──►  data/batches/*.jsonl  ──►  dashboard  ──►  data/verified/approved.jsonl  ──►  import_to_persons.py  ──►  Medusa Persons API
```

## Required credentials (must be set before running)

| Variable | Where to get it | Purpose |
|----------|----------------|---------|
| `CENSUS_USERNAME` | Census Portal admin at tricorniotec.com | Login for scraping |
| `CENSUS_PASSWORD` | Census Portal admin | Login for scraping |
| `MEDUSA_ADMIN_URL` | Your Medusa deployment (e.g. http://localhost:9000) | API endpoint for import |
| `MEDUSA_API_KEY` | Medusa admin settings → API tokens | Auth for import API calls |

**Note:** The scraper login logic is unverified against the live portal. If scraping fails, first confirm the credentials work by logging in manually at tricorniotec.com/webapp, then update the scraper's `_login()` method if the form fields differ.

## Step-by-step execution

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

# 5. If smoke-test passes, run the full scrape
#    (estimated ~10 hours at 100 concurrent connections)
python scripts/handloom-scrape/scraper.py run --start 15000 --end 3850000

#    If interrupted, resume from checkpoint:
python scripts/handloom-scrape/scraper.py resume

#    Check progress at any time:
python scripts/handloom-scrape/scraper.py stats

# 6. Launch the verification dashboard (binds to localhost only — contains PII data!)
python scripts/handloom-scrape/dashboard/server.py --data ./data --port 8080
#    Open http://127.0.0.1:8080 in a browser
#    Browse, search, and click ✓ ! ✗ to approve/flag/reject records
#    Export approved records as CSV via the button in the header

# 7. Validate the import payload shape (no API calls made)
python scripts/handloom-scrape/import_to_persons.py --data ./data --dry-run --max 5

# 8. Import a tiny batch to test against the live API
python scripts/handloom-scrape/import_to_persons.py --data ./data --max 5

# 9. Import all approved records
python scripts/handloom-scrape/import_to_persons.py --data ./data
```

## Files

All under `scripts/handloom-scrape/`.

| File | What it does |
|------|-------------|
| `scraper.py` | Async scraper — commands: `run`, `resume`, `stats` |
| `parser.py` | HTML → WeaverRecord with 50+ extracted fields |
| `dashboard/server.py` | FastAPI + Tailwind verification UI |
| `import_to_persons.py` | Approved records → Medusa Persons API |
| `.env.example` | Credential template |
| `HANDOFF.md` | This file |

## How the import works (3-step per record)

The Medusa `personSchema` only accepts: `first_name`, `last_name`, `email`, `addresses[]`, `public_metadata`. It does NOT accept nested `contact_details` or `tags`.

So each record is created in three API calls:

```
1. POST /admin/persons
   Body: { first_name, last_name, email: "weaver.{census_id}@handloom.gov.in",
           addresses: [...], public_metadata: {...} }
   → Returns person { id: "..." }

2. POST /admin/persons/{id}/contacts
   Body: { phone_number: "...", type: "mobile" }
   → Adds phone number (if weaver has one)

3. POST /admin/persons/{id}/tags  (once per tag)
   Body: { name: "loom-owner" }
   → Adds inferred tags (state, gender, loom ownership, etc.)
```

## Error recovery guide

| Scenario | What to do |
|----------|-----------|
| Scraper fails on login | Check CENSUS_USERNAME/PASSWORD. Log in manually at tricorniotec.com to verify. If the portal login form changed, update `_login()` in `scraper.py`. |
| Scraper gets 302 on a batch | Auto re-login should handle it. If it loops, kill and restart with `--resume`. |
| Scraper interrupted (Ctrl+C, crash) | `python scraper.py resume` — picks up from last checkpoint |
| Some IDs fail to scrape | Failed IDs go to `data/failures/*.json`. They are NOT retried automatically. To retry, extract failed IDs and re-scrape just those: `python scraper.py run --start MIN --end MAX`. |
| Import gets 422 on tag | Tag may already exist (duplicate). Safe to ignore — logged as yellow warning. |
| Import gets 400 on person | Likely a schema validation error. Check the response body and adjust `map_weaver_to_person()` in `import_to_persons.py`. |

## PII warning

This pipeline handles ~3.5M people's names, phone numbers, Aadhaar flags, family bank details (account number, IFSC), and GPS coordinates.

- Dashboard binds to **127.0.0.1 only** — never expose it
- Do not commit `data/` directory or any raw JSONL files
- Destroy `data/` directory after import completes
- The dashboard server.py contains CORS locked to loopback — do not loosen it
