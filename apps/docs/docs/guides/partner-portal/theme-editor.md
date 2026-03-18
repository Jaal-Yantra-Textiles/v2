# Partner Theme Editor

Partners can customize their storefront appearance from the partner dashboard without writing code.

## Accessing the Theme Editor

1. Log in to the Partner Dashboard
2. Navigate to **WebStore > Theme** in the sidebar
3. The visual theme editor opens in a full-screen modal with a live iframe preview

## Editor Layout

The editor has three panels:

- **Left sidebar** — Section tabs (Branding, Colors, Hero, Navigation, Footer, Home Layout, Product Page, Cart)
- **Center** — Live iframe preview of your storefront homepage
- **Right panel** — Property editor for the selected section

Changes are previewed instantly in the iframe and auto-saved with a 1.5s debounce.

## Sections

### Branding

| Field | Description |
|-------|-------------|
| Store Name | Displayed in nav bar and footer |
| Logo | Upload or paste URL. Shown in nav bar (recommended: PNG/SVG, 200x60px) |
| Favicon | Browser tab icon (ICO/PNG/SVG, 32x32px) |

### Colors

Four color values that map to CSS variables used throughout the storefront:

| Color | CSS Variable | Used for |
|-------|-------------|----------|
| Primary | `--theme-primary` | CTA buttons, links, badges |
| Background | `--theme-background` | Page background |
| Text | `--theme-text` | Body text |
| Accent | `--theme-accent` | Highlights, secondary actions |

Use the color picker or enter hex values directly.

### Hero

| Field | Description |
|-------|-------------|
| Layout | Center, Left, Right, or Split (text left, image right) |
| Badge Text | Small pill label above the title (e.g. "New Collection") |
| Title | Main heading |
| Subtitle | Secondary heading |
| Description | Longer paragraph below subtitle |
| Background Image | Upload or URL (1920x1080px recommended) |
| Overlay Opacity | Dark overlay slider (0-100%) for text readability |
| Primary CTA | Button text and link |
| Secondary CTA | Outline button text and link |
| Feature Highlights | Icon + title + description cards below the hero |

### Navigation

- **Show Account Link** — Toggle the "Account" link in the header
- **Menu Links** — Add/remove custom navigation links with label and path

### Footer

- **Footer Text** — Custom copyright/legal text
- **Social Links** — Add social media links with platform dropdown

### Home Layout

| Field | Description |
|-------|-------------|
| Show Collections | Toggle featured product collections |
| Collection Heading | Optional heading above collections |
| Max Collections | Number of collections to show (1-10) |
| Products per Collection | Products per rail (1-12) |
| Sample Product Name | Placeholder name when no products exist |
| Show Categories | Toggle category grid on homepage |
| Category Heading | Heading for category section |
| Sections Order | Comma-separated order: `hero, collections, categories` |

### Product Page

| Field | Description |
|-------|-------------|
| Show Tabs | Toggle Product Info / Shipping tabs |
| Show Related Products | Toggle related products section |
| Related Heading | Custom heading (default: "Related products") |
| Add to Cart Text | Custom CTA button text |

### Cart

| Field | Description |
|-------|-------------|
| Heading | Cart page heading |
| Empty Message | Message when cart is empty |
| Empty CTA Text/Link | Button text and destination for empty cart |
| Checkout Button Text | Custom checkout button label |
| Show Sign-in Prompt | Toggle guest sign-in prompt |

## Image Uploads

Logo, Favicon, and Hero Background support direct file upload:
- Drag and drop or click to browse
- Supported formats: JPEG, PNG, GIF, WebP, SVG, ICO
- Max file size: 10MB
- Toggle "Use URL" to paste an external image URL instead

## Technical Notes

- Theme data is stored in `website.metadata.theme` (no separate model needed)
- Changes are applied via CSS variables and server-side rendering
- The iframe preview bypasses the storefront's `force-cache` to show fresh data
- The storefront detects `?theme_editor=true` query param and mounts a `ThemeEditorBridge` client component for postMessage communication
