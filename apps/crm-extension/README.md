# JYT CRM Capture — Chrome extension

Capture a contact from any web page into the JYT CRM in two clicks, or inject
inspiration images from any page (Pinterest, fabric sites, lookbooks) directly
into a design's Excalidraw moodboard.

No build step, no dependencies, no bundler. It is plain ES modules that Chrome
loads directly, so what you read here is exactly what runs.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → select this folder (`apps/crm-extension`)
4. Click the extension → **Open settings**, and set:
   - **Backend URL** — `https://v3.jaalyantra.com` (the prod backend)
   - **Admin API key** — a Medusa admin secret key

Works in Chrome, Edge, Brave and Arc.

## Use

On any page with contact details, click the toolbar button. The popup shows
what it found, pre-filled and **editable**. Correct anything, then **Save to
CRM**.

Selecting text before you click seeds the note with your selection — the
fastest way to capture "they asked about 40 stoles in undyed pashmina".

## What it reads

In rough order of trust:

| Source | Used for |
|---|---|
| JSON-LD `Person` / `Organization` | name, company, job title, email, phone |
| `mailto:` / `tel:` links | email, phone |
| Open Graph / meta tags | name, company, description |
| First `<h1>` | name |
| Visible page text | emails (regex, filtered) |
| Your text selection | the note |

Everything is a **suggestion**. Nothing is sent until you press Save, because a
scraper is guessing and a CRM full of confidently-wrong contacts is worse than
an empty one.

Email candidates are filtered for the usual false positives — asset filenames
that look like addresses, `no-reply@`, `example@`. When a page yields more than
one, you get a picker rather than a silent "first one wins", since the first is
so often a generic `info@`.

## Privacy

`activeTab` + `scripting`, so the extension can read **no page at all** until
you click its button, and then only that tab. There is no content script
running in the background and no host permission for arbitrary sites.

## ⚠️ About the API key

A Medusa admin secret key is **not scoped to the CRM** — it reaches the whole
admin API, and it sits in this browser profile's local storage.

- Create a key **specifically for this extension** so it can be revoked alone.
- Treat it like a password.

The per-token scopes built for MCP (#1306 Track C) do not help here: a scope row
is only written for a `user` actor, and an `sk_` key is not one. Narrowing this
properly means either giving the extension an OAuth flow against the MCP front
door (#1306 Track B, already live and proven) or adding a dedicated
capture-only credential. Both are follow-ups, not v0.1.

## Endpoints used

### Contact capture

- `POST /admin/crm/people` — creates the contact
- `POST /admin/crm/notes` — attaches the note (best-effort; a failed note never
  reads as a failed capture)

Contacts are stamped `metadata.source = "extension"` with the page URL and
title, so a captured contact is traceable to where it came from — the same way
an imported ad-lead carries its campaign.

### Moodboard inject

- `GET /admin/designs` — list designs (paginated, searchable) for the table
- `POST /admin/medias` — multipart upload: creates a folder named
  `Design: <name> — moodboard` and uploads the selected images into it
- `POST /admin/designs/:id/link-media-folder` — links the new folder to the
  design (best-effort; the injection still succeeds if this fails)
- `GET /admin/designs/:id?fields=moodboard` — reads the current Excalidraw
  scene
- `PUT /admin/designs/:id` — saves the updated moodboard with new image
  elements appended to the right of existing elements

Images are uploaded through the backend (multipart), so the S3 host never
needs to be in the manifest's `host_permissions`. The Excalidraw scene gets a
new `files[fileId]` entry per image (with `dataURL` set to the uploaded CDN URL)
and a matching `image` element with `status: "saved"`.

## Safari

This is Chrome MV3. Safari can run it via Apple's converter:

```
xcrun safari-web-extension-converter apps/crm-extension
```

That produces an Xcode project. Running it outside a development machine needs
a paid Apple Developer account, which is why Chrome ships first.

## Known limits (v0.1)

- Company is captured into the contact's metadata as text, not linked to a
  `crm_company` record — linking happens in the admin.
- No duplicate check before saving. The backend rejects a duplicate email and
  the popup shows that message, so nothing is silently double-written, but the
  extension does not warn you in advance.
- Chrome refuses script injection on `chrome://` pages, the Web Store and PDFs.
  The popup says so rather than failing silently.
- Moodboard inject fetches images from the page context. Cross-origin images
  without CORS headers (rare for CDNs like `i.pinimg.com` which send them) fall
  back to a canvas draw; if that also fails the image is skipped.
- New moodboard images are appended to the right of existing elements at a
  fixed 300px width. Resizing and positioning happen in the admin editor.
- No duplicate image detection — if you inject the same image twice it appears
  twice. The folder upload itself does dedupe by filename though.
