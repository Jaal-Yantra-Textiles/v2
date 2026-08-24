import { extractFromPage } from "./extract.js";
import { extractImages, fetchImageDataUrls } from "./extract-images.js";
import { extractPartner } from "./extract-partner.js";
import {
  getSettings,
  splitName,
  createContact,
  logNote,
  listDesigns,
  getDesignMoodboard,
  updateDesignMoodboard,
  uploadMediaToFolder,
  uploadToExistingFolder,
  linkMediaFolder,
  listFolders,
  createPartner,
} from "./api.js";

const $ = (id) => document.getElementById(id);

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabs = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.tab;
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    panels.forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
    if (name === "moodboard") initMoodboard();
    if (name === "partner") initPartner();
  });
});

// ── Contact tab (existing logic) ──────────────────────────────────────────────

const setStatus = (msg, kind) => {
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
};

function fill(extracted) {
  $("page-url").textContent = extracted.url;

  const { first, last } = splitName(extracted.name);
  $("first_name").value = first;
  $("last_name").value = last;
  $("title").value = extracted.job_title || "";
  $("company").value = extracted.company || extracted.hostname || "";
  $("phone").value = extracted.phones[0] || "";
  $("email").value = extracted.emails[0] || "";

  if (extracted.emails.length > 1) {
    const pick = $("email-pick");
    pick.hidden = false;
    pick.innerHTML = extracted.emails
      .map((e) => `<option value="${e}">${e}</option>`)
      .join("");
    pick.addEventListener("change", () => {
      $("email").value = pick.value;
    });
  }

  const noteParts = [`Captured from ${extracted.url}`];
  if (extracted.selection) noteParts.push(`"${extracted.selection}"`);
  else if (extracted.description) noteParts.push(extracted.description);
  $("note").value = noteParts.join("\n\n");

  $("form").hidden = false;
}

async function initContact() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.token) {
    $("page-url").textContent = "";
    $("setup").hidden = false;
    $("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("No active tab to read.", "err");
    return;
  }

  let extracted;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractFromPage,
    });
    extracted = result && result.result;
  } catch (e) {
    setStatus(`Cannot read this page (${e.message}). Try a normal web page.`, "err");
    $("page-url").textContent = tab.url || "";
    return;
  }

  if (!extracted) {
    setStatus("Nothing could be read from this page.", "err");
    return;
  }

  fill(extracted);

  $("save").addEventListener("click", async () => {
    const first_name = $("first_name").value.trim();
    const email = $("email").value.trim().toLowerCase();

    if (!first_name) return setStatus("A first name is required.", "err");
    if (!email) return setStatus("An email is required.", "err");

    $("save").disabled = true;
    setStatus("Saving…");

    try {
      const contact = await createContact(settings, {
        first_name,
        last_name: $("last_name").value.trim() || null,
        email,
        phone: $("phone").value.trim() || null,
        title: $("title").value.trim() || null,
        metadata: {
          source: "extension",
          captured_at: new Date().toISOString(),
          page_url: extracted.url,
          page_title: extracted.page_title,
          company_name: $("company").value.trim() || null,
        },
      });

      const note = $("note").value.trim();
      if (note) {
        await logNote(settings, {
          body: note,
          related_type: "person",
          related_id: contact.id,
        }).catch(() => {});
      }

      setStatus(`Saved as ${contact.id}`, "ok");
      $("save").textContent = "Saved";
    } catch (e) {
      $("save").disabled = false;
      setStatus(e.message, "err");
    }
  });
}

// ── Moodboard tab ─────────────────────────────────────────────────────────────

const mbStatus = (msg, kind) => {
  const el = $("mb-status");
  el.textContent = msg;
  el.className = kind || "";
};

let mbState = {
  pageImages: [],
  selectedImages: new Set(),
  designs: [],
  selectedDesignId: null,
  initialised: false,
};

async function initMoodboard() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.token) {
    $("mb-setup").hidden = false;
    $("mb-content").hidden = true;
    $("mb-open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  $("mb-setup").hidden = true;
  $("mb-content").hidden = false;

  if (mbState.initialised) return;
  mbState.initialised = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    mbStatus("No active tab to read.", "err");
    return;
  }

  $("mb-page-url").textContent = tab.url || "";

  // Extract images from the page.
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractImages,
    });
    const { images } = (result && result.result) || { images: [] };
    mbState.pageImages = images;
    renderImageGrid();
  } catch (e) {
    mbStatus(`Cannot read this page (${e.message}).`, "err");
    return;
  }

  // Load designs.
  await loadDesigns(settings, "");

  // Wire up search.
  let searchTimer;
  $("design-search-input").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadDesigns(settings, $("design-search-input").value.trim()), 300);
  });

  // Wire up the inject button.
  $("mb-inject").addEventListener("click", () => doInject(settings, tab));
}

function renderImageGrid() {
  const grid = $("img-grid");
  if (mbState.pageImages.length === 0) {
    grid.innerHTML = '<div class="empty">No images found on this page.</div>';
    return;
  }
  grid.innerHTML = mbState.pageImages
    .map((img, i) => {
      const sel = mbState.selectedImages.has(i) ? "selected" : "";
      const safeAlt = String(img.alt || "").replace(/"/g, "&quot;").slice(0, 60);
      return `<div class="img-cell ${sel}" data-idx="${i}" title="${safeAlt}">
        <img src="${img.url}" loading="lazy" />
        <div class="check">&#10003;</div>
      </div>`;
    })
    .join("");
  grid.querySelectorAll(".img-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const idx = Number(cell.dataset.idx);
      if (mbState.selectedImages.has(idx)) {
        mbState.selectedImages.delete(idx);
        cell.classList.remove("selected");
      } else {
        mbState.selectedImages.add(idx);
        cell.classList.add("selected");
      }
      updateInjectButton();
    });
  });
}

function updateInjectButton() {
  $("mb-inject").disabled = mbState.selectedImages.size === 0 || !mbState.selectedDesignId;
}

async function loadDesigns(settings, q) {
  const list = $("design-list");
  list.innerHTML = '<div class="loading">Loading designs…</div>';
  try {
    const data = await listDesigns(settings, { q, limit: 50, offset: 0 });
    mbState.designs = data.designs || [];
    renderDesignList();
  } catch (e) {
    list.innerHTML = `<div class="empty err">${e.message}</div>`;
  }
}

function renderDesignList() {
  const list = $("design-list");
  if (mbState.designs.length === 0) {
    list.innerHTML = '<div class="empty">No designs found.</div>';
    return;
  }
  list.innerHTML = mbState.designs
    .map((d) => {
      const sel = d.id === mbState.selectedDesignId ? "selected" : "";
      const thumb = d.thumbnail_url
        ? `<img class="design-thumb" src="${d.thumbnail_url}" />`
        : `<div class="design-thumb"></div>`;
      return `<div class="design-row ${sel}" data-id="${d.id}">
        ${thumb}
        <div class="design-meta">
          <div class="design-name">${escapeHtml(d.name || d.id)}</div>
          <div class="design-status">${d.status || ""}</div>
        </div>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".design-row").forEach((row) => {
    row.addEventListener("click", () => {
      mbState.selectedDesignId = row.dataset.id;
      list.querySelectorAll(".design-row").forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      updateInjectButton();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── The inject flow ──────────────────────────────────────────────────────────

async function doInject(settings, tab) {
  const btn = $("mb-inject");
  const indices = [...mbState.selectedImages];
  const imageUrls = indices.map((i) => mbState.pageImages[i].url);
  const designId = mbState.selectedDesignId;
  const designName = mbState.designs.find((d) => d.id === designId)?.name || designId;

  btn.disabled = true;
  mbStatus(`Fetching ${imageUrls.length} image(s) from the page…`);

  // Step 1: Fetch the selected images as data URLs (with natural dimensions) from the page context.
  let fetched;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fetchImageDataUrls,
      args: [imageUrls],
    });
    fetched = (result && result.result?.results) || [];
  } catch (e) {
    mbStatus(`Cannot fetch images from the page (${e.message}).`, "err");
    btn.disabled = false;
    return;
  }

  const okImages = fetched.filter((r) => r.ok && r.dataUrl);
  if (okImages.length === 0) {
    mbStatus("Could not fetch any of the selected images (CORS or load failure).", "err");
    btn.disabled = false;
    return;
  }

  // Step 2: Convert data URLs to Blobs.
  const files = okImages.map((img, i) => {
    const blob = dataUrlToBlob(img.dataUrl);
    const ext = img.mimeType.split("/")[1] || "jpg";
    return {
      blob,
      filename: `moodboard-${designName.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 30)}-${Date.now()}-${i + 1}.${ext}`,
      mimeType: img.mimeType,
      width: img.width || 0,
      height: img.height || 0,
    };
  });

  // Step 3: Load the design — get both moodboard and any linked folder in one call.
  mbStatus("Loading design…");
  let design;
  try {
    const resp = await getDesignMoodboard(settings, designId);
    design = resp?.design || resp;
  } catch (e) {
    mbStatus(`Could not load the design: ${e.message}`, "err");
    btn.disabled = false;
    return;
  }

  const existingFolderId = design?.folder?.id;

  // Step 4: Upload — reuse the linked folder if one exists, otherwise create + link.
  // If creation hits a slug collision (folder from a previous run), fall back to
  // finding the existing folder by name and uploading into it.
  let mediaFiles;
  let linkedFolderId = existingFolderId || null;

  if (existingFolderId) {
    mbStatus(`Uploading ${files.length} image(s) to existing folder…`);
    try {
      const res = await uploadToExistingFolder(settings, existingFolderId, files);
      mediaFiles = res?.result?.mediaFiles || [];
    } catch (e) {
      mbStatus(`Upload failed: ${e.message}`, "err");
      btn.disabled = false;
      return;
    }
  } else {
    const folderName = `Design: ${designName} — moodboard`;
    mbStatus(`Uploading ${files.length} image(s) to new folder…`);
    try {
      const mediaResult = await uploadMediaToFolder(settings, files, folderName);
      mediaFiles = mediaResult?.result?.mediaFiles || [];
      linkedFolderId = mediaResult?.result?.folder?.id;
    } catch (e) {
      // Slug collision — the folder was created on a previous run but never linked.
      // Find it by name and upload into it.
      if (/already exists/i.test(e.message)) {
        mbStatus(`Folder exists, uploading to it…`);
        try {
          const { folders } = await listFolders(settings);
          const existing = (folders || []).find(
            (f) => f.name === folderName || f.name?.toLowerCase() === folderName.toLowerCase()
          );
          if (!existing) {
            mbStatus(`Could not create or find the folder: ${e.message}`, "err");
            btn.disabled = false;
            return;
          }
          linkedFolderId = existing.id;
          const res = await uploadToExistingFolder(settings, existing.id, files);
          mediaFiles = res?.result?.mediaFiles || [];
        } catch (e2) {
          mbStatus(`Upload failed: ${e2.message}`, "err");
          btn.disabled = false;
          return;
        }
      } else {
        mbStatus(`Upload failed: ${e.message}`, "err");
        btn.disabled = false;
        return;
      }
    }

    // Link the folder to the design (best-effort).
    if (linkedFolderId) {
      try {
        await linkMediaFolder(settings, designId, linkedFolderId);
      } catch {
        // The moodboard injection is the primary goal; folder linking is a bonus.
      }
    }
  }

  // Step 5: Build the updated moodboard scene with the new image elements.
  const mediaUrls = mediaFiles.map((f) => f.file_path || f.url || f.file_url).filter(Boolean);
  const imageInfo = files.map((f) => ({ width: f.width, height: f.height, mimeType: f.mimeType }));
  const updatedMoodboard = addImagesToMoodboard(design.moodboard, mediaUrls, imageInfo);

  // Step 6: Save the updated moodboard.
  mbStatus("Saving moodboard…");
  try {
    await updateDesignMoodboard(settings, designId, updatedMoodboard);
    const count = mediaUrls.length;
    mbStatus(`Done — ${count} image${count > 1 ? "s" : ""} added to "${designName}" moodboard.`, "ok");
    btn.textContent = "Added";
  } catch (e) {
    mbStatus(`Save failed: ${e.message}`, "err");
    btn.disabled = false;
  }
}

// ── Excalidraw scene helpers ──────────────────────────────────────────────────

/**
 * Add image elements to an Excalidraw moodboard scene.
 * If the scene is null, creates a fresh one.
 * `dims` is an array of { width, height } matching `urls` — used to preserve
 * the natural aspect ratio of each image.
 */
function addImagesToMoodboard(existing, urls, dims) {
  const scene = existing || {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null, theme: "light" },
    files: {},
  };

  // Deep clone so we never mutate the caller's object.
  const board = JSON.parse(JSON.stringify(scene));
  board.files = board.files || {};
  board.elements = board.elements || [];

  // Find the rightmost edge of existing elements to stack new images to the right.
  const maxX = board.elements.reduce((mx, el) => {
    return el.isDeleted ? mx : Math.max(mx, (el.x || 0) + (el.width || 0));
  }, 0);

  const MAX_W = 320;
  let cursorX = maxX + 40;
  const cursorY = 40;

  urls.forEach((url, i) => {
    const fileId = `ext-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const mime = dims[i]?.mimeType || "image/jpeg";

    // Compute scaled dimensions preserving the natural aspect ratio.
    const naturalW = dims[i]?.width || 0;
    const naturalH = dims[i]?.height || 0;
    let elW = MAX_W;
    let elH = MAX_W;
    if (naturalW > 0 && naturalH > 0) {
      const scale = MAX_W / Math.max(naturalW, naturalH);
      elW = Math.round(naturalW * scale);
      elH = Math.round(naturalH * scale);
    }

    board.files[fileId] = {
      id: fileId,
      dataURL: url,
      mimeType: mime,
      created: 1,
      lastRetrieved: 1,
    };

    board.elements.push({
      type: "image",
      id: fileId,
      x: cursorX,
      y: cursorY,
      width: elW,
      height: elH,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 2000000000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 2000000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      fileId,
      status: "saved",
      scale: [1, 1],
    });

    cursorX += elW + 24;
  });

  return board;
}

/**
 * Convert a base64 data URL to a Blob for multipart upload.
 */
function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = (meta.match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ── Partner tab ────────────────────────────────────────────────────────────────

const ptStatus = (msg, kind) => {
  const el = $("pt-status");
  el.textContent = msg;
  el.className = kind || "";
};

let ptInitialised = false;

async function initPartner() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.token) {
    $("pt-setup").hidden = false;
    $("pt-content").hidden = true;
    $("pt-open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  $("pt-setup").hidden = true;
  $("pt-content").hidden = false;

  if (ptInitialised) return;
  ptInitialised = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    ptStatus("No active tab to read.", "err");
    return;
  }

  $("pt-page-url").textContent = tab.url || "";

  let info;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPartner,
    });
    info = result && result.result;
  } catch (e) {
    ptStatus(`Cannot read this page (${e.message}). Try a normal web page.`, "err");
    return;
  }

  if (!info) {
    ptStatus("Nothing could be read from this page.", "err");
    return;
  }

  // Pre-fill partner fields.
  $("pt-name").value = info.name || "";
  $("pt-handle").value = (info.handle || info.hostname || "").replace(/^www\./, "");
  $("pt-logo").value = info.logo || "";
  updateLogoPreview(info.logo);

  $("pt-logo").addEventListener("input", () => updateLogoPreview($("pt-logo").value.trim()));

  // Pre-fill admin contact fields.
  $("pt-email").value = info.emails[0] || "";
  if (info.emails.length > 1) {
    const pick = $("pt-email-pick");
    pick.hidden = false;
    pick.innerHTML = info.emails.map((e) => `<option value="${e}">${e}</option>`).join("");
    pick.addEventListener("change", () => { $("pt-email").value = pick.value; });
  }

  const { first, last } = splitName(info.contact_name || info.name);
  $("pt-first-name").value = first || "";
  $("pt-last-name").value = last || "";
  $("pt-phone").value = info.phones[0] || "";

  // Wire up the create button.
  $("pt-create").addEventListener("click", async () => {
    const name = $("pt-name").value.trim();
    const email = $("pt-email").value.trim().toLowerCase();
    const first_name = $("pt-first-name").value.trim();
    const last_name = $("pt-last-name").value.trim();

    if (!name) return ptStatus("A partner name is required.", "err");
    if (!email) return ptStatus("An admin email is required.", "err");
    if (!first_name) return ptStatus("An admin first name is required.", "err");
    if (!last_name) return ptStatus("An admin last name is required.", "err");

    $("pt-create").disabled = true;
    ptStatus("Creating partner…");

    const body = {
      partner: {
        name,
        handle: $("pt-handle").value.trim() || undefined,
        logo: $("pt-logo").value.trim() || undefined,
        workspace_type: $("pt-workspace-type").value,
      },
      admin: {
        email,
        first_name,
        last_name,
        phone: $("pt-phone").value.trim() || undefined,
      },
    };

    try {
      const res = await createPartner(settings, body);
      const partnerId = res?.partner?.id || res?.id || "unknown";
      ptStatus(`Created partner ${partnerId}`, "ok");
      $("pt-create").textContent = "Created";
    } catch (e) {
      $("pt-create").disabled = false;
      ptStatus(e.message, "err");
    }
  });
}

function updateLogoPreview(url) {
  const img = $("pt-logo-preview");
  const value = (url || "").trim();

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      img.src = parsed.href;
      img.hidden = false;
      img.onerror = () => { img.hidden = true; };
      return;
    }
  } catch (_) {
    // Invalid URL; fall through to hide preview.
  }

  img.hidden = true;
}

// ── Boot ─────────────────────────────────────────────────────────────────────

initContact().catch((e) => setStatus(e.message, "err"));
