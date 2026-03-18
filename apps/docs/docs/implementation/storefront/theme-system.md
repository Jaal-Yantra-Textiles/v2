# Storefront Theme System

The storefront theme system allows per-partner customization of colors, branding, hero, navigation, footer, home layout, product pages, and cart.

## Data Flow

```
Partner saves theme (PUT /partners/storefront/website/theme)
  → stored in website.metadata.theme
  → exposed via GET /web/website/:domain (public API)
  → storefront fetches at render time
  → CSS variables injected via <ThemeStyles>
  → Components read theme props
```

## Theme Schema

Stored in `website.metadata.theme` as JSON. Schema defined in:
- Backend: `src/api/partners/storefront/website/theme/validators.ts`
- Storefront type: `apps/storefront-starter/src/lib/data/website.ts`
- Partner UI type: `apps/partner-ui/src/hooks/api/content.ts`

### Sections

| Section | Fields |
|---------|--------|
| `branding` | logo_url, store_name, favicon_url |
| `colors` | primary, background, text, accent (hex) |
| `hero` | layout, badge_text, title, subtitle, description, background_image_url, overlay_opacity, cta_text, cta_link, secondary_cta_text/link, features[] |
| `navigation` | links[], show_account_link |
| `footer` | text, social_links[] |
| `home_sections` | show_featured_collections, featured_collection_count, products_per_collection, collection_heading, empty_state_product_name, show_categories, category_heading, sections_order |
| `product_page` | show_related_products, related_heading, show_tabs, cta_text, sample_product_name/price |
| `cart` | heading, empty_message, empty_cta_text/link, show_sign_in_prompt, checkout_button_text |

## CSS Variables

Injected by `ThemeStyles` component (`src/modules/layout/components/theme-styles/index.tsx`):

```css
:root {
  --theme-primary: #7c3aed;
  --theme-background: #ffffff;
  --theme-text: #111827;
  --theme-accent: #f59e0b;
}
```

Tailwind mapping in `tailwind.config.js`:
```javascript
colors: {
  theme: {
    primary: "var(--theme-primary, #7c3aed)",
    background: "var(--theme-background, #ffffff)",
    text: "var(--theme-text, #111827)",
    accent: "var(--theme-accent, #f59e0b)",
  },
}
```

Usage: `bg-theme-primary`, `text-theme-text`, etc.

## Component Architecture

### Layout (`src/app/[countryCode]/(main)/layout.tsx`)
- Fetches website data via `getWebsite()`
- Renders `<ThemeStyles>` (CSS variables)
- Wraps children in `<ThemeProvider>` (React context)
- Passes `theme` prop to `<Nav>` and `<Footer>`
- Bypasses cache when loaded in iframe (`Sec-Fetch-Dest: iframe`)

### Nav (`src/modules/layout/templates/nav/`)
- Uses `theme.branding.store_name` or `STORE_NAME`
- Shows logo image if `theme.branding.logo_url` set
- Respects `theme.navigation.show_account_link`
- Passes theme to `<SideMenu>`

### SideMenu (`src/modules/layout/components/side-menu/`)
- Uses `theme.navigation.links` or default menu items
- Filters Account link based on `show_account_link`

### Hero (`src/modules/home/components/hero/`)
- Supports 4 layouts: center, left, right, split
- Badge text, description, dual CTAs, feature highlights bar
- Background image with configurable overlay opacity
- `isThemeEditor` prop adds `data-theme-section` attributes

### Footer (`src/modules/layout/templates/footer/`)
- Uses `theme.branding.store_name`, `theme.footer.text`
- Renders social links if configured

### Home Page (`src/app/[countryCode]/(main)/page.tsx`)
- Configurable section order via `home_sections.sections_order`
- Collections/categories can be toggled independently
- Shows sample product placeholders when no products exist

### Product Page (`src/modules/products/templates/`)
- Conditional tabs and related products
- Custom CTA text on add-to-cart button

### Cart (`src/modules/cart/templates/`)
- Custom heading, empty state message/CTA, checkout button text
- Sign-in prompt can be toggled

## Visual Editor Bridge

When `?theme_editor=true` is in the URL, the storefront mounts `ThemeEditorBridge`:

```
src/modules/layout/components/theme-editor-bridge/index.tsx
```

This client component:
- Listens for `UPDATE_THEME_PREVIEW` postMessages from the partner UI
- Applies changes in real-time (CSS variables, DOM text updates)
- Sends `THEME_EDITOR_READY` and `THEME_SECTION_CLICKED` back to parent
- Injects editor outline styles for clickable sections
- Disables navigation in editor mode

## Caching

- Normal browsing: `cache: "force-cache"` with cache tags
- Theme editor iframe: `cache: "no-store"` (detected via `Sec-Fetch-Dest: iframe` or `?theme_editor=true`)
- Middleware bypasses redirect loop for editor iframes (`?visual_editor=true` or `?theme_editor=true`)
