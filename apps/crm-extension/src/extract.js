/**
 * The page scraper, injected on demand.
 *
 * This function is stringified and run in the page by `chrome.scripting`, so it
 * must be entirely self-contained — no imports, no closure over anything in the
 * extension. It returns plain data; every judgement about what to keep is made
 * back in the popup, where the user can see and correct it.
 *
 * Runs only when the user clicks the toolbar button (activeTab), so the
 * extension can read no page until it is explicitly invoked on that page.
 */
export function extractFromPage() {
  const text = document.body ? document.body.innerText || "" : "";

  const meta = (name) => {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el ? (el.getAttribute("content") || "").trim() : "";
  };

  // ---- JSON-LD -----------------------------------------------------------
  // The richest source when present: many company and profile pages publish a
  // fully-formed Person or Organization here.
  const jsonLd = [];
  for (const node of document.querySelectorAll(
    'script[type="application/ld+json"]'
  )) {
    try {
      const parsed = JSON.parse(node.textContent || "");
      // A page may publish a single object, an array, or an @graph wrapper.
      const items = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];
      for (const item of items) if (item && typeof item === "object") jsonLd.push(item);
    } catch {
      // A malformed block on somebody else's page must not stop the capture.
    }
  }

  const ldOfType = (type) =>
    jsonLd.find((i) => {
      const t = i["@type"];
      return Array.isArray(t) ? t.includes(type) : t === type;
    });

  const person = ldOfType("Person");
  const org = ldOfType("Organization") || ldOfType("LocalBusiness");

  // ---- Emails ------------------------------------------------------------
  // mailto: links first — they are declared, not guessed.
  const emails = [];
  const pushEmail = (raw) => {
    const e = (raw || "").trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return;
    // Tracking pixels and asset filenames produce convincing false positives.
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return;
    if (/^(example|test|no-?reply|donotreply)@/i.test(e)) return;
    if (!emails.includes(e)) emails.push(e);
  };

  for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
    pushEmail((a.getAttribute("href") || "").slice(7).split("?")[0]);
  }
  for (const m of text.match(/[^\s<>()[\]{}]+@[^\s<>()[\]{}]+\.[a-z]{2,}/gi) || []) {
    pushEmail(m.replace(/[.,;:]+$/, ""));
  }
  if (person && person.email) pushEmail(String(person.email).replace(/^mailto:/, ""));
  if (org && org.email) pushEmail(String(org.email).replace(/^mailto:/, ""));

  // ---- Phones ------------------------------------------------------------
  const phones = [];
  const pushPhone = (raw) => {
    const p = (raw || "").trim();
    if (!p) return;
    const digits = p.replace(/[^\d]/g, "");
    // Below 8 digits it is far more likely a price, a year or an order number.
    if (digits.length < 8 || digits.length > 15) return;
    if (!phones.includes(p)) phones.push(p);
  };
  for (const a of document.querySelectorAll('a[href^="tel:"]')) {
    pushPhone(decodeURIComponent((a.getAttribute("href") || "").slice(4)));
  }
  if (person && person.telephone) pushPhone(String(person.telephone));
  if (org && org.telephone) pushPhone(String(org.telephone));

  // ---- Name / company / title -------------------------------------------
  const h1 = document.querySelector("h1");
  const name =
    (person && person.name) ||
    meta("profile:first_name") ||
    (h1 ? (h1.innerText || "").trim() : "") ||
    meta("og:title") ||
    "";

  const company =
    (org && org.name) ||
    (person && person.worksFor && person.worksFor.name) ||
    meta("og:site_name") ||
    "";

  const jobTitle = (person && person.jobTitle) || meta("profile:title") || "";

  // A deliberate selection is the strongest signal of intent on the page, so
  // it seeds the note rather than the generic description.
  const selection = String(window.getSelection ? window.getSelection() : "").trim();

  return {
    url: location.href,
    origin: location.origin,
    hostname: location.hostname,
    page_title: document.title || "",
    name: String(name).trim().slice(0, 200),
    company: String(company).trim().slice(0, 200),
    job_title: String(jobTitle).trim().slice(0, 200),
    emails: emails.slice(0, 10),
    phones: phones.slice(0, 10),
    description: meta("og:description") || meta("description") || "",
    selection: selection.slice(0, 2000),
  };
}
