# AGENTS.md

This document provides guidelines for agentic coding agents operating in this repository.

## Commands

- `yarn dev` - Start Next.js dev server with Turbopack (port 8000)
- `yarn build` - Production build
- `yarn start` - Production server (port 8000)
- `yarn lint` - Run ESLint
- `yarn analyze` - Bundle analysis

## Code Style

### Imports & Path Aliases

Use path aliases for cleaner imports:

- `@lib/*` - Library utilities and data access layer (`src/lib/*`)
- `@modules/*` - Feature modules (`src/modules/*`)
- `@pages/*` - Pages directory (`src/pages/*`)

Import order: external libs first, then internal aliases, then relative imports.

### TypeScript

- Strict mode enabled - no `any` without explicit annotation
- Use `@medusajs/types` for commerce types (HttpTypes.StoreProduct, etc.)
- Define Props types for components: `type Props = { ... }`
- Avoid type assertions; prefer inferred types

### Component Patterns

- Server components: Add `"use server"` directive at top
- Client components: Add `"use client"` directive at top
- Page/templates: Default export (`export default function ...`)
- UI components: Named exports (`export function Button(...)`)
- Hooks: Named exports, camelCase (`export function useToggleState(...)`)
- Utilities: Named exports, camelCase

### Formatting (Prettier)

- Semicolons: No
- Single quotes: No (use double quotes)
- Arrow parens: Always
- Trailing commas: ES5 compatible
- Tab width: 2

### Error Handling

- Use `MedusaHttpError` from `@lib/util/medusa-error` for API errors
- Use `medusaError()` to normalize and throw errors
- Use `serializeMedusaError()` for returning errors from server actions
- Client components: handle errors with local state, show friendly messages

### Naming Conventions

- Components: PascalCase (ProductCard, CartItem)
- Functions/hooks: camelCase (useToggleState, formatPrice)
- Constants: SCREAMING_SNAKE_CASE for config values
- Files: kebab-case for utilities, index files for barrels

### UI Framework

- Use `@medusajs/ui` components (Button, Table, Text, clx)
- Tailwind CSS for styling with design system classes
- Follow existing patterns: `text-ui-fg-base`, `txt-medium-plus`, `data-testid`

### Data Layer

- SDK calls in `@lib/data/*` files (server-side)
- HTTP client via `@lib/config` (sdk object)
- Auth/cache headers via `@lib/data/cookies`
- Region handling via `@lib/data/regions`

## Architecture

- `/src/app` - Next.js App Router pages
- `/src/lib` - Config, utilities, and data access
- `/src/modules` - Feature-based modules with components/templates
- `/src/types` - Global TypeScript definitions

## Notes

- No test framework configured (no vitest/jest)
- Medusa e-commerce backend integration
- Stripe payment processing
- Design tool features with Konva canvas
