# Render Static Hosting Guide

Your Medusa backend already runs elsewhere (Railway), so the only thing Render needs to host is the public gallery at `apps/media-gallery/index.html`. The gallery is a plain HTML file with Tailwind via CDN, so Render’s Static Site product is enough—no Node build or backend required.

## 1. Prepare the repo

The gallery lives at `apps/media-gallery/`. Keep `index.html` (and any supporting assets you add later) committed to Git so Render can pull them.

## 2. Create a Render Static Site

1. Log into Render → **New +** → **Static Site**.
2. Pick your GitHub/GitLab repo.
3. When prompted:
   - **Name**: e.g. `media-gallery`.
   - **Root Directory**: leave empty (repo root).
   - **Publish Directory**: `apps/media-gallery`.
   - **Build Command**: leave blank (Render will just copy the directory). If you prefer to be explicit, use:
     ```bash
     mkdir -p $RENDER_OUTPUT && cp -R apps/media-gallery/* $RENDER_OUTPUT
     ```
4. Click **Create Static Site**. Render will deploy as soon as the repo syncs.

## 3. Configure share links

Once the static site URL is live (e.g. `https://media-gallery-yourteam.onrender.com`):

1. Set `VITE_MEDIA_GALLERY_BASE_URL` in your admin UI environment (or `.env`) to that domain.
2. Newly generated share links will embed this base, so copying from the admin opens the Render-hosted gallery.

## 4. Updating the gallery

- Any commit touching `apps/media-gallery` will trigger a redeploy.
- If you need to hotfix without a build, use Render’s **Manual Deploy** → **Sync from Repo** or upload assets through the dashboard.

## 5. Troubleshooting

- **Blank page**: Make sure `index.html` is at the publish directory root.
- **Mixed content warnings**: The gallery calls your Railway backend via `fetch('/api/web/media/folder/...')`. Ensure the backend is HTTPS and CORS allows the Render domain.
- **Bad share links**: Re-check `VITE_MEDIA_GALLERY_BASE_URL` matches the Render static site URL exactly (no trailing slash).

That’s all you need on Render—just a static site that serves `index.html`, while Railway continues to run the Medusa API powering the gallery.*** End Patch
