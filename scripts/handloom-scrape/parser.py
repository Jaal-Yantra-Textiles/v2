from bs4 import BeautifulSoup
from typing import Optional
from pydantic import BaseModel
import re


class WeaverFamilyMember(BaseModel):
    name: str
    father_husband_name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    relationship: Optional[str] = None
    education: Optional[str] = None
    employment_status: Optional[str] = None
    nature_of_engagement: Optional[str] = None
    days_worked: Optional[int] = None
    mobile: Optional[str] = None
    aadhaar_issued: Optional[str] = None
    bank_account: Optional[str] = None
    account_number: Optional[str] = None
    ifsc: Optional[str] = None
    profile_photo_url: Optional[str] = None
    type: Optional[str] = None  # "weaver" or "allied"
    allied_activities: Optional[list[str]] = None  # for allied workers


class WeaverRecord(BaseModel):
    census_id: int
    name: str
    head_of_household: Optional[str] = None
    relation_to_head: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    education: Optional[str] = None
    religion: Optional[str] = None
    social_group: Optional[str] = None
    mobile: Optional[str] = None          # real number (stored privately)
    mobile_masked: Optional[str] = None   # portal's public mask, e.g. 91XXXXXXXXXX
    aadhaar_issued: Optional[bool] = None

    latitude: Optional[float] = None
    longitude: Optional[float] = None
    village: Optional[str] = None
    block: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None

    rural_urban: Optional[str] = None
    house_no: Optional[str] = None
    pin_code: Optional[str] = None
    household_size: Optional[int] = None
    household_type: Optional[str] = None
    monthly_income: Optional[str] = None
    handloom_income: Optional[str] = None
    dwelling_type: Optional[str] = None
    ownership_type: Optional[str] = None
    electricity: Optional[bool] = None

    # Loom details
    own_looms: Optional[bool] = None
    total_looms_owned: Optional[int] = None
    total_looms_worked: Optional[int] = None  # operated but not owned
    pit_loom_count: Optional[int] = 0
    frame_loom_count: Optional[int] = 0
    loin_loom_count: Optional[int] = 0
    other_loom_count: Optional[int] = 0

    # Production
    yarn_consumption: Optional[dict] = None
    dye_consumption_kg: Optional[float] = None
    chemical_consumption_kg: Optional[float] = None
    avg_production_meters: Optional[float] = None
    intricacy_level: Optional[str] = None
    natural_dye_used: Optional[bool] = None

    # Sales & marketing
    sells_local_market: Optional[bool] = None
    sells_master_weaver: Optional[bool] = None
    sells_cooperative: Optional[bool] = None
    sells_ecommerce: Optional[bool] = None
    support_requirements: Optional[list[str]] = None

    # Family weavers
    family_weavers: list[WeaverFamilyMember] = []
    family_allied: list[WeaverFamilyMember] = []

    # Photos
    profile_photo_url: Optional[str] = None
    aadhaar_photo_url: Optional[str] = None

    survey_date: Optional[str] = None


def parse_value(cell) -> str:
    text = cell.get_text(strip=True)
    return text


def _extract_mobile(html: str) -> tuple[Optional[str], Optional[str]]:
    """Return (real, masked) mobile.

    The portal renders a masked mobile and keeps the real number in an adjacent
    HTML comment: `<!-- <td...>8295880181</td> --> <td...>91XXXXXXXXXX</td>`.
    """
    m = re.search(
        r'Mobile no</td>\s*<!--\s*<td[^>]*>([0-9Xx]+)</td>\s*-->\s*<td[^>]*>([0-9Xx]+)</td>',
        html,
    )
    if m:
        return m.group(1), m.group(2)
    m2 = re.search(r'Mobile no</td>\s*<td[^>]*>([0-9Xx]+)</td>', html)
    if m2:
        return None, m2.group(1)
    return None, None


def clean_phone(phone: str) -> Optional[str]:
    cleaned = re.sub(r'\D', '', phone)
    if len(cleaned) == 10:
        return cleaned
    if len(cleaned) > 10 and cleaned.startswith('91') and len(cleaned) == 12:
        return cleaned[2:]
    if len(cleaned) > 10 and cleaned.startswith('0'):
        return cleaned[1:]
    return cleaned if cleaned else None


def parse_weaver_page(html: str, census_id: int) -> Optional[WeaverRecord]:
    soup = BeautifulSoup(html, 'lxml')

    record = WeaverRecord(census_id=census_id, name="")

    td_pairs = {}
    for tr in soup.find_all('tr'):
        tds = tr.find_all('td')
        if len(tds) >= 3:
            label = tds[0].get_text(strip=True)
            question = tds[1].get_text(strip=True)
            value = tds[2].get_text(strip=True) if len(tds) > 2 else ""
            td_pairs[label] = value
        elif len(tds) == 2:
            label = tds[0].get_text(strip=True)
            value = tds[1].get_text(strip=True)
            td_pairs[label] = value

    # Simple key-value pairs table (Name, Lat/Lng, Village, etc.)
    key_table = {}
    for table in soup.find_all('table'):
        rows = table.find_all('tr')
        if not rows:
            continue
        for row in rows:
            cells = row.find_all('td')
            if len(cells) == 2:
                key = cells[0].get_text(strip=True)
                val = cells[1].get_text(strip=True)
                if key in ('Name', 'Start Time', 'Latitude', 'Longitude',
                           'Village', 'Block', 'District', 'State'):
                    key_table[key] = val

    record.name = key_table.get('Name', '')
    record.latitude = _parse_float(key_table.get('Latitude'))
    record.longitude = _parse_float(key_table.get('Longitude'))
    record.village = key_table.get('Village')
    record.block = key_table.get('Block')
    record.district = key_table.get('District')
    record.state = key_table.get('State')
    record.survey_date = key_table.get('Start Time')

    # Section 1: Respondent info
    record.head_of_household = td_pairs.get('1.2')
    record.relation_to_head = td_pairs.get('1.3')
    record.gender = td_pairs.get("1.4")
    record.age = _parse_int(td_pairs.get("1.5"))
    record.education = td_pairs.get("1.6")
    record.aadhaar_issued = _parse_bool(td_pairs.get("1.8"))

    # The portal masks the mobile in the rendered cell (e.g. "91XXXXXXXXXX")
    # and keeps the real number in an adjacent HTML comment. We store the real
    # number privately and the mask for public display (status quo preserved).
    real_mobile, masked_mobile = _extract_mobile(html)
    if real_mobile:
        record.mobile = clean_phone(real_mobile)
    record.mobile_masked = masked_mobile or (td_pairs.get("1.9") or None)

    # Section 2: Address
    record.rural_urban = td_pairs.get("2.1")
    record.house_no = td_pairs.get("2.2")
    record.pin_code = td_pairs.get("2.6")

    # Section 3: Household characteristics
    record.household_size = _parse_int(td_pairs.get("3.1"))
    record.religion = td_pairs.get("3.2")
    record.social_group = td_pairs.get("3.3")
    record.ownership_type = td_pairs.get("3.5")
    record.dwelling_type = td_pairs.get("3.6")
    record.electricity = _parse_bool(td_pairs.get("3.8"))
    record.monthly_income = td_pairs.get("3.9.1")
    record.handloom_income = td_pairs.get("3.9.2")

    # Section 4: Household type
    record.household_type = td_pairs.get("4.1")

    # Section 5: Loom details (parse from loom table)
    _parse_loom_details(soup, record)

    # Section 6: Production
    record.avg_production_meters = _parse_float(td_pairs.get("Meters"))
    record.intricacy_level = td_pairs.get("6.4")
    record.dye_consumption_kg = _parse_float(td_pairs.get("6.8"))
    record.chemical_consumption_kg = _parse_float(td_pairs.get("6.9"))

    dyetype_6_3_2 = td_pairs.get("6.3.2")
    record.natural_dye_used = (dyetype_6_3_2 == "Yes")

    # Parse yarn consumption
    record.yarn_consumption = _parse_yarn_consumption(td_pairs)

    # Section 6: Sales channels
    record.sells_local_market = _parse_bool(td_pairs.get("6.6.1"))
    record.sells_master_weaver = _parse_bool(td_pairs.get("6.6.2"))
    record.sells_cooperative = _parse_bool(td_pairs.get("6.6.3"))
    record.sells_ecommerce = _parse_bool(td_pairs.get("6.6.7"))

    # Section 6 input sources
    _parse_input_sources(soup, record)

    # Section 7: Support requirements
    record.support_requirements = _parse_support_requirements(td_pairs)

    # Section 8: Family members
    _parse_family_members(soup, record)

    # Photo
    _parse_photos(soup, record)

    return record


def _parse_float(val: Optional[str]) -> Optional[float]:
    if not val or not val.strip():
        return None
    try:
        return float(val.strip())
    except ValueError:
        return None


def _parse_int(val: Optional[str]) -> Optional[int]:
    if not val or not val.strip():
        return None
    try:
        return int(val.strip())
    except ValueError:
        return None


def _parse_bool(val: Optional[str]) -> Optional[bool]:
    if not val or not val.strip():
        return None
    v = val.strip().lower()
    return v == 'yes'


def _parse_yarn_consumption(td_pairs: dict) -> dict:
    yarn = {}
    for key in ('6.7.1', '6.7.2', '6.7.3', '6.7.4', '6.7.5', '6.7.6', '6.7.7',
                '6.7.8', '6.7.9', '6.7.10', '6.7.11', '6.7.12', '6.7.13',
                '6.7.14', '6.7.15', '6.7.16'):
        val = td_pairs.get(key)
        if val and val.strip():
            yarn[key] = val.strip()
    return yarn if yarn else None


def _parse_loom_details(soup: BeautifulSoup, record: WeaverRecord):
    """Parse the loom table (section 5.1).

    Live layout (a category cell rowspans, so column count is 6 or 7):
      [category?] | Type | Code | Own(Yes/No) | No.Owned | No.Working | No.Idle
    We key off the trailing 4 columns [own, owned, working, idle] rather than
    fixed indices, and categorise from the row's leading text.
    """
    total_owned = 0
    total_worked = 0
    found = False

    for tr in soup.find_all('tr'):
        texts = [c.get_text(strip=True) for c in tr.find_all(['td', 'th'])]
        if len(texts) < 5:
            continue
        own, owned_s, working_s, idle_s = texts[-4:]
        if own.strip().lower() not in ('yes', 'no'):
            continue
        owned = _parse_int(owned_s)
        working = _parse_int(working_s)
        if owned is None or working is None:
            continue  # trailing cells aren't the loom count triplet
        label = " ".join(texts[:-4]).lower()
        if 'loom' not in label:
            continue

        found = True
        total_owned += owned
        total_worked += working
        if 'pit' in label:
            record.pit_loom_count = (record.pit_loom_count or 0) + owned
        elif 'frame' in label:
            record.frame_loom_count = (record.frame_loom_count or 0) + owned
        elif 'loin' in label:
            record.loin_loom_count = (record.loin_loom_count or 0) + owned
        else:
            record.other_loom_count = (record.other_loom_count or 0) + owned

    if found:
        record.total_looms_owned = total_owned
        record.total_looms_worked = total_worked
        record.own_looms = total_owned > 0

    # Fallback from household type when the table is absent/ambiguous.
    if record.own_looms is None and record.household_type:
        ht = record.household_type.lower()
        if "don" in ht and "own loom" in ht:      # "Don't own looms ..."
            record.own_looms = False
        elif "own loom" in ht:
            record.own_looms = True


def _parse_input_sources(soup: BeautifulSoup, record: WeaverRecord):
    pass  # Complex table parsing, can add later


def _parse_support_requirements(td_pairs: dict) -> list[str]:
    requirements = []
    support_map = {
        "7.3.1": "Marketing Support",
        "7.3.2": "Management Training",
        "7.3.3": "Technical Training",
        "7.3.4": "Design Support",
        "7.3.5": "Technology Upgradation",
        "7.3.6": "Raw Material Support",
        "7.3.7": "Credit Support",
        "7.3.8": "Calendaring",
        "7.3.9": "Dyeing",
    }
    for key, label in support_map.items():
        val = td_pairs.get(key)
        if val and val.strip().lower() == 'yes':
            requirements.append(label)
    return requirements if requirements else None


def _parse_family_members(soup: BeautifulSoup, record: WeaverRecord):
    tables = soup.find_all('table')
    for table in tables:
        prev = table.find_previous(['h4', 'h5'])
        if not prev:
            continue
        heading = prev.get_text(strip=True)

        if 'Profile of Family Members engaged in Weaving' in heading:
            rows = table.find_all('tr')
            member = WeaverFamilyMember(name="")
            member.type = "weaver"
            for row in rows:
                cells = row.find_all('td')
                if len(cells) < 3:
                    continue
                label = cells[0].get_text(strip=True)
                key = cells[1].get_text(strip=True) if len(cells) >= 3 else ""
                value = cells[2].get_text(strip=True) if len(cells) >= 3 else ""

                if label == "8.3.2":
                    member.name = value
                elif label == "8.3.3":
                    member.father_husband_name = value
                elif label == "8.3.11":
                    member.age = _parse_int(value)
                elif label == "8.3.12":
                    member.gender = value
                elif label == "8.3.14":
                    member.mobile = clean_phone(value)
                elif label == "8.3.15":
                    member.education = value
                elif label == "8.3.16":
                    member.employment_status = value
                elif label == "8.3.17":
                    member.nature_of_engagement = value
                elif label == "8.3.18":
                    member.days_worked = _parse_int(value)
                elif label == "8.3.19":
                    member.bank_account = value
                elif label == "8.3.20":
                    member.account_number = value
                elif label == "8.3.21":
                    member.ifsc = value

            if member.name:
                record.family_weavers.append(member)

        elif 'Profile of Family Members engaged in Allied activities' in heading:
            rows = table.find_all('tr')
            member = WeaverFamilyMember(name="")
            member.type = "allied"
            for row in rows:
                cells = row.find_all('td')
                if len(cells) < 3:
                    continue
                label = cells[0].get_text(strip=True)
                value = cells[2].get_text(strip=True) if len(cells) >= 3 else ""

                if label == "8.4.2":
                    member.name = value
                elif label == "8.4.3":
                    member.father_husband_name = value
                elif label == "8.4.11":
                    member.age = _parse_int(value)
                elif label == "8.4.12":
                    member.gender = value
                elif label == "8.4.14":
                    member.mobile = clean_phone(value)
                elif label == "8.4.15":
                    member.education = value
                elif label == "8.4.16":
                    member.employment_status = value
                elif label == "8.4.17":
                    member.nature_of_engagement = value
                elif label == "8.4.18":
                    member.days_worked = _parse_int(value)
                elif label == "8.4.19":
                    member.bank_account = value
                elif label == "8.4.20":
                    member.account_number = value
                elif label == "8.4.21":
                    member.ifsc = value
                elif label == "8.4.22":
                    member.type = "allied"

            if member.name:
                record.family_allied.append(member)


def _parse_photos(soup: BeautifulSoup, record: WeaverRecord):
    imgs = soup.find_all('img')
    for img in imgs:
        src = img.get('src', '')
        if 'Profile Photo' in src and not record.profile_photo_url:
            record.profile_photo_url = src
        elif 'Front Image' in src and not record.aadhaar_photo_url:
            record.aadhaar_photo_url = src
