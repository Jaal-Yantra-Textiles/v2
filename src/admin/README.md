# Admin Customizations

You can extend the Medusa Admin to add widgets and new pages. Your customizations interact with API routes to provide merchants with custom functionalities.

## Environment Variables

### `VITE_MEDUSA_BACKEND_URL`

The backend API URL for the admin UI. This is used for:
- API requests via the Medusa SDK
- Server-Sent Events (SSE) for live analytics

**Development:**
```bash
# Uses localhost by default
VITE_MEDUSA_BACKEND_URL=http://localhost:9000
```

**Production:**
```bash
# Use relative path (empty string) to use same domain as admin
VITE_MEDUSA_BACKEND_URL=

# Or specify full URL
VITE_MEDUSA_BACKEND_URL=https://v3.jaalyantra.com
```

**Note:** In production, if not set, the admin will use relative paths (`/admin/...`) which works when the admin is served from the same domain as the API.

## Example: Create a Widget

A widget is a React component that can be injected into an existing page in the admin dashboard.

For example, create the file `src/admin/widgets/product-widget.tsx` with the following content:

```tsx title="src/admin/widgets/product-widget.tsx"
import { defineWidgetConfig } from "@medusajs/admin-sdk"

// The widget
const ProductWidget = () => {
  return (
    <div>
      <h2>Product Widget</h2>
    </div>
  )
}

// The widget's configurations
export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductWidget
```

This inserts a widget with the text “Product Widget” at the end of a product’s details page.