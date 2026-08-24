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

async function request(settings, path, body, opts = {}) {
  const method = opts.method || "POST";
  const isForm = opts.formData !== undefined;

  const headers = {
    // btoa is fine here: an API key is ASCII by construction.
    authorization: `Basic ${btoa(`${settings.token}:`)}`,
  };
  if (!isForm) headers["content-type"] = "application/json";

  let res;
  try {
    res = await fetch(`${settings.baseUrl}${path}`, {
      method,
      headers,
      body: isForm ? opts.formData : body !== undefined ? JSON.stringify(body) : undefined,
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
    throw new Error(`Unexpected response (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed (HTTP ${res.status}).`);
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

// ── Designs ──────────────────────────────────────────────────────────────────

/**
 * List designs, paginated. Returns { designs, count, offset, limit }.
 */
export async function listDesigns(settings, { q, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (q) params.set("q", q);
  return request(settings, `/admin/designs?${params}`, undefined, { method: "GET" });
}

/**
 * Get a single design, requesting the moodboard and linked folder.
 * Returns the design object; moodboard is at .moodboard (may be null),
 * linked folder (if any) at .folder.id.
 */
export async function getDesignMoodboard(settings, designId) {
  return request(settings, `/admin/designs/${designId}?fields=moodboard,folder.id`, undefined, {
    method: "GET",
  });
}

/**
 * Update a design's moodboard via the general PUT /admin/designs/:id route.
 */
export async function updateDesignMoodboard(settings, designId, moodboard) {
  return request(settings, `/admin/designs/${designId}`, { moodboard }, { method: "PUT" });
}

// ── Media ─────────────────────────────────────────────────────────────────────

/**
 * Create a folder and upload files in one request.
 * `files` is an array of { blob, filename, mimeType }.
 * Returns { message, result: { folder, mediaFiles, uploadedFileCount } }.
 */
export async function uploadMediaToFolder(settings, files, folderName) {
  const form = new FormData();
  for (const f of files) {
    form.append("files", f.blob, f.filename);
  }
  form.append(
    "folder",
    JSON.stringify({ name: folderName, description: "Moodboard inspiration captured by extension" })
  );
  form.append("metadata", JSON.stringify({ source: "extension" }));
  return request(settings, "/admin/medias", undefined, { method: "POST", formData: form });
}

/**
 * Upload files into an EXISTING folder by id.
 * Returns { result: { uploaded: [...] } }.
 */
export async function uploadToExistingFolder(settings, folderId, files) {
  const form = new FormData();
  for (const f of files) {
    form.append("files", f.blob, f.filename);
  }
  return request(settings, `/admin/medias/folder/${folderId}/upload`, undefined, {
    method: "POST",
    formData: form,
  });
}

/**
 * List all media folders (lightweight). Returns { folders, count }.
 */
export async function listFolders(settings) {
  return request(settings, "/admin/medias/folders", undefined, { method: "GET" });
}

/**
 * Link a media folder to a design (one-to-one, replaces existing).
 */
export async function linkMediaFolder(settings, designId, folderId) {
  return request(settings, `/admin/designs/${designId}/link-media-folder`, { folder_id: folderId });
}

// ── Partners ──────────────────────────────────────────────────────────────────

/**
 * Create a partner with its primary admin.
 * `input` is { partner: { name, handle?, logo?, workspace_type? }, admin: { email, first_name, last_name, phone?, role? } }.
 */
export async function createPartner(settings, input) {
  return request(settings, "/admin/partners", input);
}
