/**
 * Partner info extractor, injected on demand via chrome.scripting.
 *
 * Entirely self-contained — no imports, no closure over the extension.
 * Returns company/partner info scraped from a web page: name, logo URL,
 * description, email candidates, phone candidates, and the page URL.
 *
 * Source priority (highest trust first):
 *   JSON-LD Organization → og:site_name → <h1> → <title>
 *   JSON-LD logo / og:image → <img class*="logo"> → favicon (large)
 */
export function extractPartner() {
  const meta = (name) => {
    const el =
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[name="${name}"]`);
    return el ? (el.getAttribute("content") || "").trim() : "";
  };

  const abs = (url) => {
    if (!url) return "";
    try { return new URL(url, location.href).href; } catch { return ""; }
  };

  // ---- JSON-LD -----------------------------------------------------------
  const jsonLd = [];
  for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(node.textContent || "");
      const items = Array.isArray(parsed) ? parsed
        : parsed && Array.isArray(parsed["@graph"]) ? parsed["@graph"]
        : [parsed];
      for (const item of items) if (item && typeof item === "object") jsonLd.push(item);
    } catch {}
  }

  const org = jsonLd.find((i) => {
    const t = i["@type"];
    return Array.isArray(t) ? t.some((x) => /organization|business|company/i.test(x)) : /organization|business|company/i.test(t);
  });

  // ---- Name --------------------------------------------------------------
  const name =
    (org && org.name) ||
    meta("og:site_name") ||
    meta("application-name") ||
    (document.querySelector("h1")?.innerText || "").trim() ||
    (document.title || "").replace(/\s*[|\-—·]\s*.+$/, "").trim() ||
    "";

  // ---- Logo --------------------------------------------------------------
  let logo = "";
  // 1. JSON-LD Organization logo
  if (org && org.logo) logo = abs(String(org.logo));
  // 2. og:image (usually the main brand image / share card)
  if (!logo) logo = abs(meta("og:image"));
  // 3. <img> with "logo" in class, alt, or src — the most reliable DOM signal
  if (!logo) {
    const logoImg = document.querySelector(
      'img[class*="logo" i], img[alt*="logo" i], img[src*="logo" i], header img, nav img'
    );
    if (logoImg) {
      const src = logoImg.currentSrc || logoImg.src || logoImg.getAttribute("data-src") || "";
      logo = abs(src);
    }
  }
  // 4. Apple touch icon (180x180, usually a good quality logo)
  if (!logo) {
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon) logo = abs(appleIcon.getAttribute("href") || "");
  }
  // 5. Favicon (last resort — skip if it's the generic favicon.ico)
  if (!logo) {
    const icon = document.querySelector('link[rel="icon"][sizes], link[rel="shortcut icon"], link[rel="icon"]');
    if (icon) {
      const href = icon.getAttribute("href") || "";
      if (!href.endsWith("favicon.ico")) logo = abs(href);
    }
  }

  // ---- Description -------------------------------------------------------
  const description =
    (org && org.description) ||
    meta("og:description") ||
    meta("description") ||
    "";

  // ---- Emails ------------------------------------------------------------
  const emails = [];
  const pushEmail = (raw) => {
    const e = (raw || "").trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return;
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return;
    if (/^(example|test|no-?reply|donotreply|noreply)@/i.test(e)) return;
    if (!emails.includes(e)) emails.push(e);
  };

  // 1. mailto: links — declared, not guessed.
  for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
    pushEmail((a.getAttribute("href") || "").slice(7).split("?")[0]);
  }

  // 2. JSON-LD Organization email + ContactPoint entries.
  if (org && org.email) pushEmail(String(org.email));
  if (org && Array.isArray(org.contactPoint)) {
    for (const cp of org.contactPoint) {
      if (cp && cp.email) pushEmail(String(cp.email));
    }
  }

  // 3. JSON-LD Person objects (contact persons on the page).
  let contactName = "";
  const person = jsonLd.find((i) => {
    const t = i["@type"];
    return Array.isArray(t) ? t.includes("Person") : t === "Person";
  });
  if (person) {
    if (person.email) pushEmail(String(person.email));
    if (person.name) contactName = String(person.name).trim();
  }

  // 4. <address> elements — semantically mark up contact info.
  for (const addr of document.querySelectorAll("address")) {
    const addrText = addr.innerText || "";
    for (const m of addrText.match(/[^\s<>()[\]{}]+@[^\s<>()[\]{}]+\.[a-z]{2,}/gi) || []) {
      pushEmail(m.replace(/[.,;:]+$/, ""));
    }
  }

  // 5. Visible page text — regex sweep (catches emails not wrapped in mailto:).
  const text = document.body?.innerText || "";
  for (const m of text.match(/[^\s<>()[\]{}]+@[^\s<>()[\]{}]+\.[a-z]{2,}/gi) || []) {
    pushEmail(m.replace(/[.,;:]+$/, ""));
  }

  // 6. Obfuscated emails: "name [at] domain [dot] com" — common on Indian sites.
  const obfText = text.replace(/\[at\]/gi, "@").replace(/\(at\)/gi, "@").replace(/\[dot\]/gi, ".").replace(/\(dot\)/gi, ".");
  for (const m of obfText.match(/[^\s<>()[\]{}]+@[^\s<>()[\]{}]+\.[a-z]{2,}/gi) || []) {
    pushEmail(m.replace(/[.,;:]+$/, ""));
  }

  // ---- Phones ------------------------------------------------------------
  const phones = [];
  const pushPhone = (raw) => {
    let p = (raw || "").trim();
    if (!p) return;
    const digits = p.replace(/[^\d]/g, "");
    if (digits.length < 8 || digits.length > 15) return;
    // Skip things that look like years, prices, or order numbers.
    if (/^\d{4}$/.test(p)) return;
    if (!phones.includes(p)) phones.push(p);
  };

  // 1. tel: links.
  for (const a of document.querySelectorAll('a[href^="tel:"]')) {
    pushPhone(decodeURIComponent((a.getAttribute("href") || "").slice(4)));
  }

  // 2. JSON-LD Organization telephone + ContactPoint entries.
  if (org && org.telephone) pushPhone(String(org.telephone));
  if (org && Array.isArray(org.contactPoint)) {
    for (const cp of org.contactPoint) {
      if (cp && cp.telephone) pushPhone(String(cp.telephone));
    }
  }
  if (person && person.telephone) pushPhone(String(person.telephone));

  // 3. <address> elements.
  for (const addr of document.querySelectorAll("address")) {
    const addrText = addr.innerText || "";
    // International: +91 98765 43210, +1 (555) 123-4567
    for (const m of addrText.match(/\+?[\d\s()\-\.]{8,18}/g) || []) {
      pushPhone(m.trim());
    }
  }

  // 4. Visible page text — phone regex (international + Indian formats).
  // Matches: +91 98765 43210, +1-555-123-4567, (555) 123-4567, 9876543210
  // Requires a + prefix or phone-format punctuation to avoid matching prices/dates.
  const phoneRe = /(?:\+?\d[\d\s\-().]{7,}\d)|(?:\+?\d{2,4}[\s\-]\d{3,4}[\s\-]\d{3,4})/g;
  const seen = new Set();
  for (const m of text.match(phoneRe) || []) {
    const cleaned = m.trim();
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    pushPhone(cleaned);
  }

  // ---- Contact person name (from visible text) ---------------------------
  if (!contactName) {
    // "Contact: John Doe", "Reach out to Jane Smith", "Email John Doe at"
    const contactMatch = text.match(/(?:contact|reach|email|call)\s+(?:us\s+at\s+|mr\.?\s+|mrs\.?\s+|ms\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i);
    if (contactMatch) contactName = contactMatch[1].trim();
  }

  // ---- Social handles (for metadata) -------------------------------------
  const handle =
    (org && (org.sameAs || org.url) && String(org.sameAs || org.url).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) ||
    location.hostname.replace(/^www\./, "");

  return {
    url: location.href,
    hostname: location.hostname,
    page_title: document.title || "",
    name: String(name).trim().slice(0, 200),
    logo,
    description: String(description).trim().slice(0, 500),
    emails: emails.slice(0, 15),
    phones: phones.slice(0, 10),
    contact_name: contactName.slice(0, 100),
    handle: String(handle).trim().slice(0, 100),
  };
}
