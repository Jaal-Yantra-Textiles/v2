# Dashboard "What's new" media

GIF/still assets for the partner dashboard changelog carousel
(`src/routes/home/whats-new/`). Each `WHATS_NEW_ENTRIES` entry's `media`
points here, e.g. `media: "/whats-new/orders-unified.gif"`.

- Drop `.gif` (or `.png`/`.jpg`) files named to match the entry's `media`.
- Missing/broken media falls back to the entry's `icon` automatically —
  so entries can ship before their recording lands.
- Keep GIFs small (aim <2 MB, ~640px wide) — they load on the dashboard.
