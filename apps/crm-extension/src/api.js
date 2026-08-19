/**
 * The extension's whole backend surface: two admin routes, plus settings.
 *
 * ## Authentication
 *
 * A Medusa admin secret API key, sent as HTTP Basic with the key as the
 * username and an empty password — the same scheme the admin API already
 * accepts everywhere else.
 *
 * ⚠️ An admin secret key is NOT scoped to the CRM. Anything holding it can
 * reach the whole admin API, and it lives in extension storage on this machine.
 * Use a key created FOR this extension so it can be revoked on its own, and
 * treat it like a password. The per-token scopes built for MCP (#1306 Track C)
 * do not apply here: scope rows are only written for a `user` actor, and an
 * `sk_` key is not one.
 */

const DEFAULT_BASE_URL = "https://v3.jaalyantra.com";

export async function getSettings() {
  const { baseUrl, token } = await chrome.storage.local.get([
    "baseUrl",
    "token",
  ]);
  return { baseUrl: baseUrl || DEFAULT_BASE_URL, token: token || "" };
}

export async function saveSettings(baseUrl, token) {
  await chrome.storage.local.set({
    baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: token || "",
  });
}

/**
 * Split a scraped display name into {first,last}.
 *
 * Mirrors the backend's `splitFullName`: the first token is the given name and
 * everything after it is the surname. A single-token name yields an EMPTY
 * surname, not a duplicated one — the CRM models a missing surname as absent,
 * and inventing one here would put a guess into the record permanently.
 */
export function splitName(full) {
  const parts = String(full || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function request(settings, path, body) {
  let res;
  try {
    res = await fetch(`${settings.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // btoa is fine here: an API key is ASCII by construction.
        authorization: `Basic ${btoa(`${settings.token}:`)}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Could not reach ${settings.baseUrl}. Check the URL in settings and that the host is allowed in the manifest.`
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("Rejected: the API key is wrong, revoked, or lacks access.");
  }

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // A non-JSON body on an error status is usually a proxy or WAF page; the
    // status is the only trustworthy part of it.
    throw new Error(`Unexpected response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    // Surface what the server said. A duplicate email is the common case and
    // the message names it, which is far more useful than "save failed".
    throw new Error(data.message || `Save failed (HTTP ${res.status}).`);
  }
  return data;
}

export async function createContact(settings, contact) {
  const data = await request(settings, "/admin/crm/people", contact);
  const person = data.crm_person || data.person || data;
  if (!person || !person.id) throw new Error("Saved, but no contact id came back.");
  return person;
}

export async function logNote(settings, note) {
  return request(settings, "/admin/crm/notes", note);
}
