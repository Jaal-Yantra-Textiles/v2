"""
Import verified weaver records from scrape data into Medusa Persons API.

Reads approved records from data/verified/approved.jsonl, maps them to the
Persons module schema, and creates/updates them via the Medusa admin API.

Usage:
    python import_to_persons.py --data ./data --api-url https://admin.jyt.com
    python import_to_persons.py --data ./data --api-url http://localhost:9000 --dry-run
    python import_to_persons.py --help
"""

import json
import os
from pathlib import Path
from typing import Optional

import httpx
import typer
from rich.console import Console
from rich.progress import Progress, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

cli = typer.Typer()
console = Console()

DATA_DIR = Path("data")
BATCH_SIZE = 50  # Persons per API batch request


def load_approved_records(data_dir: Path) -> list[dict]:
    ver_path = data_dir / "verified" / "approved.jsonl"
    if not ver_path.exists():
        console.print("[yellow]No approved records found[/yellow]")
        return []
    records = []
    for line in ver_path.read_text().splitlines():
        if line.strip():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def map_weaver_to_person(weaver: dict) -> dict:
    """Map census weaver record to Person API payload.

    The POST /admin/persons schema (personSchema) only accepts:
      first_name*, last_name*, email*, addresses[], state, public_metadata
      (* = required)

    contact_details and tags must be created via separate endpoints
    after the person record exists.
    """
    name = (weaver.get("name") or "").strip()
    name_parts = name.split(" ", 1)
    first_name = name_parts[0] if name_parts else name
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    census_id = weaver.get("census_id")

    person = {
        "first_name": first_name,
        "last_name": last_name,
        "email": f"weaver.{census_id}@handloom.gov.in",
        "state": "Onboarding",
        "public_metadata": {
            "source": "census_portal",
            "census_id": census_id,
            "survey_date": weaver.get("survey_date"),
            "age": weaver.get("age"),
            "gender": weaver.get("gender"),
            "education": weaver.get("education"),
            "religion": weaver.get("religion"),
            "social_group": weaver.get("social_group"),
            "head_of_household": weaver.get("head_of_household"),
            "relation_to_head": weaver.get("relation_to_head"),
            "rural_urban": weaver.get("rural_urban"),
            "household_size": weaver.get("household_size"),
            "monthly_income": weaver.get("monthly_income"),
            "handloom_income": weaver.get("handloom_income"),
            "household_type": weaver.get("household_type"),
            "dwelling_type": weaver.get("dwelling_type"),
            "ownership_type": weaver.get("ownership_type"),
            "electricity": weaver.get("electricity"),
            "aadhaar_issued": weaver.get("aadhaar_issued"),
            "own_looms": weaver.get("own_looms"),
            "total_looms_owned": weaver.get("total_looms_owned"),
            "pit_loom_count": weaver.get("pit_loom_count"),
            "frame_loom_count": weaver.get("frame_loom_count"),
            "loin_loom_count": weaver.get("loin_loom_count"),
            "other_loom_count": weaver.get("other_loom_count"),
            "avg_production_meters": weaver.get("avg_production_meters"),
            "intricacy_level": weaver.get("intricacy_level"),
            "natural_dye_used": weaver.get("natural_dye_used"),
            "yarn_consumption": weaver.get("yarn_consumption"),
            "dye_consumption_kg": weaver.get("dye_consumption_kg"),
            "chemical_consumption_kg": weaver.get("chemical_consumption_kg"),
            "sells_local_market": weaver.get("sells_local_market"),
            "sells_master_weaver": weaver.get("sells_master_weaver"),
            "sells_cooperative": weaver.get("sells_cooperative"),
            "sells_ecommerce": weaver.get("sells_ecommerce"),
            "support_requirements": weaver.get("support_requirements"),
            "family_weavers": weaver.get("family_weavers"),
            "family_allied": weaver.get("family_allied"),
            "profile_photo_url": weaver.get("profile_photo_url"),
            "aadhaar_photo_url": weaver.get("aadhaar_photo_url"),
        },
    }

    addresses = []
    street_parts = []
    if weaver.get("house_no"):
        street_parts.append(weaver["house_no"])
    address = {
        "street": ", ".join(street_parts) if street_parts else None,
        "city": weaver.get("village") or weaver.get("block"),
        "state": weaver.get("district") or weaver.get("state"),
        "postal_code": weaver.get("pin_code"),
        "country": "India",
        "latitude": weaver.get("latitude"),
        "longitude": weaver.get("longitude"),
    }
    if address["street"] or address["city"]:
        addresses.append(address)

    if addresses:
        person["addresses"] = addresses

    return person


def build_contact_payload(weaver: dict) -> Optional[dict]:
    phone = weaver.get("mobile")
    if phone and phone != "91XXXXXXXXXX":
        return {"phone_number": phone, "type": "mobile"}
    return None


def build_tag_payloads(weaver: dict) -> list[dict]:
    tags = []
    if weaver.get("own_looms") is True:
        tags.append({"name": "loom-owner"})
    if weaver.get("own_looms") is False:
        tags.append({"name": "contract-weaver"})
    if weaver.get("natural_dye_used"):
        tags.append({"name": "natural-dye"})
    if weaver.get("social_group"):
        tags.append({"name": weaver["social_group"].lower().replace(" ", "-")})
    if weaver.get("religion"):
        tags.append({"name": weaver["religion"].lower().replace(" ", "-")})
    if weaver.get("gender"):
        tags.append({"name": weaver["gender"].lower()})
    if weaver.get("state"):
        tags.append({"name": f"state-{weaver['state'].lower().replace(' ', '-')}"})
    return tags


async def import_persons(
    api_url: str,
    api_key: str,
    records: list[dict],
    persons: list[dict],
    dry_run: bool = False,
) -> tuple[int, int]:
    created = 0
    errors = 0

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }
    if not api_key.startswith("Bearer "):
        headers["Authorization"] = f"Bearer {api_key}"

    console.print(f"[dim]API calls per record:[/dim]")
    console.print(f"[dim]  1. POST /admin/persons (basic fields + addresses + public_metadata)[/dim]")
    console.print(f"[dim]  2. POST /admin/persons/{{id}}/contacts (phone, if available)[/dim]")
    console.print(f"[dim]  3. POST /admin/persons/{{id}}/tags (inferred tags, if any)[/dim]")
    console.print()

    async with httpx.AsyncClient(timeout=60.0, headers=headers) as client:
        for record, person in zip(records, persons):
            name = f"{person['first_name']} {person['last_name']}"

            if dry_run:
                console.print(f"[dim]DRY RUN: {name} → email={person['email']}, "
                              f"addr={len(person.get('addresses', []))}, "
                              f"contact={bool(build_contact_payload(record))}, "
                              f"tags={len(build_tag_payloads(record))}[/dim]")
                continue

            try:
                # Step 1: Create person
                resp = await client.post(f"{api_url}/admin/persons", json=person)
                if resp.status_code not in (200, 201):
                    console.print(f"[red]Error creating {name}: {resp.status_code} {resp.text[:200]}[/red]")
                    errors += 1
                    continue

                person_id = resp.json().get("person", {}).get("id")
                if not person_id:
                    console.print(f"[red]No person ID returned for {name}, response: {resp.text[:200]}[/red]")
                    errors += 1
                    continue

                # Step 2: Create contact detail (phone)
                contact = build_contact_payload(record)
                if contact:
                    cr = await client.post(
                        f"{api_url}/admin/persons/{person_id}/contacts",
                        json=contact,
                    )
                    if cr.status_code not in (200, 201):
                        console.print(f"[yellow]Warn: contact failed for {name}: {cr.status_code}[/yellow]")

                # Step 3: Create tags
                tags = build_tag_payloads(record)
                for tag in tags:
                    tr = await client.post(
                        f"{api_url}/admin/persons/{person_id}/tags",
                        json=tag,
                    )
                    if tr.status_code not in (200, 201):
                        if tr.status_code == 422:
                            pass  # tag may already exist
                        else:
                            console.print(f"[yellow]Warn: tag '{tag['name']}' failed for {name}: {tr.status_code}[/yellow]")

                created += 1

            except httpx.RequestError as e:
                console.print(f"[red]Request failed for {name}: {e}[/red]")
                errors += 1

    return created, errors


@cli.command()
def run(
    data: str = typer.Option("./data", "--data", "-d", help="Scrape data directory"),
    api_url: str = typer.Option("http://localhost:9000", "--api-url", envvar="MEDUSA_ADMIN_URL", help="Medusa admin API URL"),
    api_key: str = typer.Option("", "--api-key", envvar="MEDUSA_API_KEY", help="Medusa API key"),
    dry_run: bool = typer.Option(False, "--dry-run", "-n", help="Dry run (validate only, no API calls)"),
    max_records: int = typer.Option(0, "--max", "-m", help="Max records to import"),
):
    records = load_approved_records(Path(data))
    if not records:
        raise typer.Exit(1)

    if max_records > 0:
        records = records[:max_records]

    console.print(f"[bold]Importing {len(records)} approved weaver records[/bold]")
    console.print(f"  API URL: {api_url}")
    console.print(f"  Dry Run: {dry_run}")

    persons = []
    for r in records:
        try:
            persons.append(map_weaver_to_person(r))
        except Exception as e:
            console.print(f"[red]Error mapping record {r.get('census_id')}: {e}[/red]")

    console.print(f"  Mapped {len(persons)} persons for import")

    import asyncio

    created, errors = asyncio.run(import_persons(api_url, api_key, records, persons, dry_run))

    table = Table(title="Import Results")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")
    table.add_row("Total Records", str(len(records)))
    table.add_row("Mapped to Persons", str(len(persons)))
    table.add_row("Created", str(created))
    table.add_row("Errors", str(errors))
    console.print(table)


@cli.command()
def validate(
    data: str = typer.Option("./data", "--data", "-d", help="Scrape data directory"),
):
    """Validate approved records without importing."""
    run.callback(data=data, api_url="", api_key="", dry_run=True, max_records=0)


if __name__ == "__main__":
    cli()
