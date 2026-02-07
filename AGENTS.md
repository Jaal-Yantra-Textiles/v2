# AGENTS.md

This document provides guidelines for AI agents working on this codebase.

## Project Overview

This is a **JYT Commerce API** - a Medusa 2.x-based e-commerce platform extended for textile production. Built with TypeScript, it includes:
- Admin API with 150+ endpoints for managing designs, production, partners, inventory
- AI-powered features (image generation, query planning, RAG)
- Partner portal and storefront applications
- Workflows for business processes (production runs, publishing campaigns)

## Build Commands

```bash
# Development
yarn dev                    # Start Medusa development server
yarn partner-ui:dev         # Start partner UI dev server

# Build
yarn build                  # Build Medusa and resolve TypeScript aliases
yarn partner-ui:build       # Build partner UI preview

# Database
yarn predeploy              # Run migrations before deployment
yarn seed                   # Seed database with test data

# Generate UI
yarn generate-ui            # Generate admin UI components from schema
```

## Testing

```bash
# Run all test types
yarn test:integration:http              # HTTP integration tests
yarn test:integration:modules           # Module unit tests
yarn test:unit                          # Unit tests

# Run specific test files
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="orders"
TEST_TYPE=integration:modules NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="company"

# Run single test
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testNamePattern="should create order"

# Run tests with verbose output
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --silent=false --runInBand

# Batched integration tests
yarn test:integration:http:batched
yarn test:integration:http:shared
```

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2021
- Module: Node16 with Node16 resolution
- Strict null checks enabled
- Decorators enabled (experimentalDecorators, emitDecoratorMetadata)
- Paths: `@/*` maps to `./src/admin/*`

### Imports and Organization

**Import Order:**
1. External framework/library imports (@medusajs/*, @tanstack/*, ai, zod)
2. Internal module imports (`@/*`)
3. Relative imports (`./*`, `../*`)

**Example:**
```typescript
import { generateText } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { z } from "zod"
import { MedusaService } from "@medusajs/framework/utils"
import Company from "./models/company"
```

### Naming Conventions

| Pattern | Convention | Example |
|---------|------------|---------|
| Files | kebab-case | `company-service.ts` |
| Classes | PascalCase | `CompanyService` |
| Variables/functions | camelCase | `createCompany()` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Private methods | prefix with `_` | `_internalMethod()` |
| Interfaces | PascalCase (no `I` prefix) | `CompanyConfig` |
| Types | PascalCase | `QueryStep` |
| Module constants | SCREAMING_SNAKE_CASE | `COMPANY_MODULE` |

### Error Handling

```typescript
// Use MedusaError from @medusajs/framework/utils
import { MedusaError } from "@medusajs/framework/utils"

throw new MedusaError(MedusaError.Types.NOT_FOUND, "Company not found")

// Error types: NOT_FOUND, INVALID_DATA, CONFLICT, UNAUTHORIZED, FORBIDDEN
```

### TypeScript Best Practices

- Use explicit types for function parameters and return types
- Use interfaces for object shapes, types for unions/primitives
- Prefer `zod` for runtime validation schemas
- Use `Record<K, V>` for map-like objects, not `{[key: string]: V}`
- Use `Partial<T>`, `Required<T>`, `Readonly<T>` for type modifiers

### Module Structure

```
src/modules/{module}/
├── index.ts              # Module definition with Module()
├── models/
│   └── {module}.ts       # DML model using model.define()
├── service.ts            # Service extending MedusaService()
├── migrations/           # MikroORM migrations
└── __tests__/            # Unit tests

src/api/
├── admin/                # Admin API routes
│   └── {resource}/
│       ├── route.ts      # Route handlers
│       └── validators.ts # Zod validation schemas
├── store/                # Storefront API routes
├── partners/             # Partner portal routes
└── middlewares.ts        # Global middleware definitions

src/workflows/
└── {workflow-name}/
    ├── index.ts          # Workflow definition
    └── steps/            # Step implementations

src/subscribers/
└── {event}.ts            # Event handlers
```

### Model Definition (DML)

```typescript
// src/modules/{module}/models/{module}.ts
import { model } from "@medusajs/framework/utils"

const Company = model.define("company", {
  id: model.id().primaryKey(),
  name: model.text(),
  email: model.text().optional(),
  created_at: model.dateTime().default("now"),
})

export default Company
```

### Service Definition

```typescript
// src/modules/{module}/service.ts
import { MedusaService } from "@medusajs/framework/utils"
import Company from "./models/company"

class CompanyService extends MedusaService({
  Company,
}) {}

export default CompanyService
```

### Module Definition

```typescript
// src/modules/{module}/index.ts
import { Module } from "@medusajs/framework/utils"
import CompanyService from "./service"

export const COMPANY_MODULE = "company"

export default Module(COMPANY_MODULE, {
  service: CompanyService,
})
```

### Zod Validators

```typescript
// src/api/admin/{resource}/validators.ts
import { z } from "zod"

export const companySchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
})

export type CreateCompanyInput = z.infer<typeof companySchema>

// Helper to wrap schema for Medusa validation
const wrapSchema = <T extends z.ZodType>(schema: T) => {
  return z.preprocess((obj) => obj, schema) as any
}
```

### API Route Patterns

```typescript
// src/api/admin/{resource}/route.ts
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { validateAndTransformBody } from "@medusajs/framework/http"
import { companySchema } from "./validators"

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const companyData = req.validatedBody
  // ... handle request
  res.json({ company: /* ... */ })
}
```

### Middleware Definition

```typescript
// src/api/middlewares.ts
import { defineMiddlewares, validateAndTransformBody } from "@medusajs/framework/http"
import { companySchema } from "./admin/companies/validators"

const wrapSchema = <T extends z.ZodType>(schema: T) => {
  return z.preprocess((obj) => obj, schema) as any
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/companies",
      method: "POST",
      middlewares: [
        validateAndTransformBody(wrapSchema(companySchema)),
      ],
    },
  ],
})
```

### Workflow Patterns

```typescript
// src/workflows/{workflow-name}/index.ts
import { 
  createWorkflow, 
  createStep, 
  StepResponse, 
  WorkflowResponse 
} from "@medusajs/framework/workflows-sdk"

const createCompanyStep = createStep(
  "create-company",
  async (input: { name: string }, context) => {
    const companyModuleService = context.container.resolve("company")
    const company = await companyModuleService.createCompanies(input)
    return new StepResponse({ company })
  },
  async (input: { company: { id: string } }, context) => {
    // Compensation function (optional)
    const companyModuleService = context.container.resolve("company")
    await companyModuleService.deleteCompanies(input.company.id)
  }
)

export const createCompanyWorkflow = createWorkflow(
  "create-company",
  function (input) {
    const company = createCompanyStep(input)
    return new WorkflowResponse({ company })
  }
)
```

### Subscriber/Event Patterns

```typescript
// src/subscribers/{event}.ts
import { 
  SubscriberArgs, 
  SubscriberConfig 
} from "@medusajs/medusa"

export const handler = async ({ 
  event, 
  container 
}: SubscriberArgs<"order.placed">) => {
  // Handle event
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
```

### React/UI Conventions (apps/*)

- Use `eslint-config-expo` for React Native/Expo apps
- Tailwind CSS with shadcn/ui components
- React Query for server state
- Zod + react-hook-form for forms

## Git Workflow

- Conventional commits: `feat(scope): description`, `fix(scope): description`
- Semantic release enabled - commits trigger automatic releases
- Release rules:
  - `feat` → minor release
  - `fix`, `refactor`, `perf` → patch release
  - `BREAKING CHANGE` → major release

## Common Operations

```bash
# Database migrations
npx mikro-orm migration:create --name=init
npx mikro-orm migration:up

# Resolve TypeScript path aliases
yarn resolve:aliases

# Generate admin UI
yarn generate-ui

# Build analytics
yarn build:analytics
```

## Key Dependencies

- **Framework**: Medusa 2.12.5 (e-commerce backend)
- **AI**: AI SDK, Mastra (agents), OpenRouter
- **Database**: PostgreSQL via MikroORM
- **Testing**: Jest with @swc/jest
- **Validation**: Zod
- **UI**: React, Tailwind, Radix UI

## Important Notes

- Node.js >=20 required
- All paths in tsconfig exclude: `apps/*`, `src/mastra/*`, `.medusa/*`
- Module services extend `MedusaService`
- Use `wrapSchema()` for Zod schemas with `validateAndTransformBody`
- Multer for file uploads - distinguish between small (memory) and large (disk) uploads
- CORS configured per route via `createCorsMiddleware()` and `createCorsPartnerMiddleware()`
- Models use `model.define()` from `@medusajs/framework/utils` (DML syntax)
- Modules export `Module(MODULE_NAME, { service: ServiceClass })` in index.ts
