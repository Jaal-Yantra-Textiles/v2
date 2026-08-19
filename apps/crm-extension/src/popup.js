import { extractFromPage } from "./extract.js";
import { getSettings, splitName, createContact, logNote } from "./api.js";

const $ = (id) => document.getElementById(id);

const setStatus = (msg, kind) => {
  const el = $("status");
  el.textContent = msg;
  el.className = kind || "";
};

/**
 * Populate the form from what the page yielded. Everything is a SUGGESTION —
 * the user sees each field before anything is sent, because a scraper is
 * guessing and a CRM full of confidently-wrong contacts is worse than an empty
 * one.
 */
function fill(extracted) {
  $("page-url").textContent = extracted.url;

  const { first, last } = splitName(extracted.name);
  $("first_name").value = first;
  $("last_name").value = last;
  $("title").value = extracted.job_title || "";
  $("company").value = extracted.company || extracted.hostname || "";
  $("phone").value = extracted.phones[0] || "";
  $("email").value = extracted.emails[0] || "";

  // More than one candidate email: let the user pick rather than silently
  // taking the first, which is often a generic info@ address.
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

async function main() {
  const settings = await getSettings();
  if (!settings.baseUrl || !settings.token) {
    $("page-url").textContent = "";
    $("setup").hidden = false;
    $("open-options").addEventListener("click", () =>
      chrome.runtime.openOptionsPage()
    );
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
    // Chrome refuses injection on its own pages, the Web Store, and PDFs.
    setStatus(
      `Cannot read this page (${e.message}). Try a normal web page.`,
      "err"
    );
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
        // Absent, not empty — matching how the backend models a missing surname.
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
        // Best-effort: the contact is the thing that matters, and a failed note
        // must not read as a failed capture.
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

main().catch((e) => setStatus(e.message, "err"));
