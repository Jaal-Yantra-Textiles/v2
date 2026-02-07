---
title: "Spec Generator Enhancements"
sidebar_label: "Spec Generator"
sidebar_position: 7
---

# Spec Generator Enhancements

## Overview

This document describes the enhancements made to the module spec generator for the AI Chat V3 RAG system. These changes improve the accuracy of generated specifications and add real API usage examples from integration tests.

## Key Features

1. **Medusa Type Extraction** - Uses `.medusa/types/query-entry-points.d.ts` for accurate type information
2. **Workflow Directory Attribution Fix** - Strict directory-based workflow matching
3. **API Example Extraction** - Real examples from integration tests

## Key Changes

### 1. Medusa Type Extraction (NEW - Fastest & Most Accurate)

**Problem:** Manual source code scanning was slow and missed fields, enums, and relation cardinalities.

**Solution:** Extract types directly from `.medusa/types/query-entry-points.d.ts` - the pre-generated type definitions that Medusa creates.

**New File:** [src/scripts/extract-medusa-types.ts](src/scripts/extract-medusa-types.ts)

#### Benefits

| Aspect | Manual Scanning | Medusa Types |
|--------|-----------------|--------------|
| Speed | Slow (reads all .ts files) | Fast (single 185KB file) |
| Fields | Regex-based (may miss) | 100% accurate |
| Types | Basic inference | Exact types (string, number, Date, JSON) |
| Nullable | Pattern matching | Explicit `Maybe<T>` |
| Enums | Partial extraction | Complete with all values |
| Relations | Limited inference | Full cardinality + link tables |

#### How It Works

```typescript
// Priority order:
1. Try .medusa/types/query-entry-points.d.ts (fastest, most accurate)
2. Fall back to manual source code scanning (if type not found)
```

#### Type File Contents

The `.medusa/types/query-entry-points.d.ts` file contains:

```typescript
// Enum definitions with all values
export type PartnerStatusEnum =
  | 'active'
  | 'inactive'
  | 'pending';

// Entity definitions with exact types
export type Partner = {
  __typename?: 'Partner';
  id: Scalars['ID']['output'];           // string
  name: Scalars['String']['output'];      // string (required)
  handle: Scalars['String']['output'];    // string (required)
  logo: Maybe<Scalars['String']['output']>; // string (nullable)
  status: PartnerStatusEnum;              // enum
  is_verified: Scalars['Boolean']['output']; // boolean
  metadata: Maybe<Scalars['JSON']['output']>; // JSON (nullable)
  created_at: Scalars['DateTime']['output']; // Date
  // Relations with cardinality
  admins: Array<Maybe<PartnerAdmin>>;      // one-to-many
  designs: Maybe<Array<Maybe<Design>>>;    // one-to-many (nullable)
  feedbacks: Maybe<Array<Maybe<Feedback>>>; // one-to-many
  // Link tables for many-to-many
  design_link: Maybe<Array<Maybe<LinkDesignDesignPartnerPartner>>>;
};
```

#### Usage

```bash
# Extract types for a specific entity
npx tsx src/scripts/extract-medusa-types.ts Partner

# Output:
### Partner

**Fields:**
- id: string (required)
- name: string (required)
- handle: string (required)
- logo: string (optional)
- status: enum (active | inactive | pending) (required)
- is_verified: boolean (required)
- metadata: JSON (optional)
- created_at: Date (required)
- updated_at: Date (required)
- deleted_at: Date (optional)

**Relations:**
- admins: has many PartnerAdmin
- designs: has many Design
- feedbacks: has many Feedback
- inventory_orders: has many InventoryOrders
- internal_payments: has many InternalPayments
- people: has many Person
- stores: has many Store
- tasks: has many Task
```

#### Integration with Spec Generator

The spec generator now uses this order:
1. Load `.medusa/types/query-entry-points.d.ts` (cached)
2. Search for entity by name variants (Partner, Partners, partner, etc.)
3. Extract fields, relations, enums from type definition
4. If not found, fall back to manual source scanning

#### Index Service Entry Points

The extractor also parses `.medusa/types/index-service-entry-points.d.ts` to discover which entities are queryable via `container.query()`.

**File Structure:**
```typescript
// .medusa/types/index-service-entry-points.d.ts
declare module '@medusajs/framework/types' {
  interface IndexServiceEntryPoints {
    feedback: Feedback
    feedbacks: Feedback
    partner: Partner
    partners: Partner
    design: Design
    designs: Design
    // ... singular/plural pairs for each queryable entity
  }
}
```

**Extracted Data:**
```typescript
interface IndexServiceEntry {
  singularName: string   // e.g., "partner"
  pluralName: string     // e.g., "partners"
  typeName: string       // e.g., "Partner"
}
```

**Usage:**
```bash
npx tsx src/scripts/extract-medusa-types.ts

# Output includes:
# 🔎 Index Service Queryable Entities (via container.query()):
#   • feedback / feedbacks → Feedback
#   • partner / partners → Partner
#   • design / designs → Design
#   • person / people → Person
#   ...
```

This information helps the LLM understand which entities can be queried using `container.query()` and what singular/plural forms to use.

---

### 2. Fixed Workflow Directory Attribution

**Problem:** The original spec generator incorrectly attributed workflows to modules using loose content matching. For example, the `designs` module was capturing workflows from `/ai/`, `/production-runs/`, and `/products/` directories.

**Root Cause:** Lines 886-901 in `generate-enhanced-specs.ts` used:
```typescript
// OLD: Loose matching (PROBLEMATIC)
const isRelevant = modulePatterns.some(pattern => {
  if (file.includes(`/${pattern}/`) || file.includes(`/${pattern}s/`)) {
    return true
  }
  if (content.includes(pattern)) {  // Matches ANY mention of module name
    return true
  }
  return false
})
```

**Solution:** Implemented strict directory-based matching that only captures workflows from the module's own workflow directory.

**File:** [src/scripts/generate-enhanced-specs.ts](src/scripts/generate-enhanced-specs.ts)

**Key Changes:**
```typescript
// NEW: Strict directory-based matching
private async extractWorkflows(moduleName: string): Promise<WorkflowData[]> {
  const workflows: WorkflowData[] = []
  const moduleNameLower = moduleName.toLowerCase()

  // Define VALID workflow directories for this module (strict matching)
  const validWorkflowDirs = [
    path.join(this.workflowsDir, moduleNameLower),                    // /workflows/designs/
    path.join(this.workflowsDir, moduleNameLower + "s"),              // /workflows/partners/
    path.join(this.workflowsDir, moduleNameLower.replace(/_/g, "-")), // /workflows/email-templates/
    path.join(this.workflowsDir, moduleNameLower.replace(/-/g, "_")), // /workflows/etsy_sync/
    path.join(this.workflowsDir, moduleNameLower.replace(/s$/, "")),  // /workflows/design/ (singular)
  ]

  // Only collect workflow files from valid directories
  for (const dir of validWorkflowDirs) {
    // Check if directory exists before scanning
    // ...
  }
}
```

**Results:**
- `designs` module: Reduced from ~30+ workflows to 13 (all correctly from `/src/workflows/designs/`)
- No more cross-contamination from `/ai/`, `/production-runs/`, etc.

---

### 2. API Example Extraction from Integration Tests

**Problem:** Generated specs lacked real API usage examples, making it harder for the LLM to understand:
- How to create entities through the API
- How to link entities together
- How to perform PATCH operations
- Filter/pagination patterns

**Solution:** Created a new service that parses integration test files to extract real API usage examples.

**New File:** [src/scripts/extract-api-examples.ts](src/scripts/extract-api-examples.ts)

#### Interfaces

```typescript
export interface ExtractedAPIExample {
  description: string
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  endpoint: string
  requestBody?: string
  responseKey?: string
  sourceFile: string
  lineNumber: number
  category: "create" | "read" | "update" | "delete" | "link" | "action" | "other"
}

export interface CategorizedAPIExamples {
  create: ExtractedAPIExample[]
  read: ExtractedAPIExample[]
  update: ExtractedAPIExample[]
  delete: ExtractedAPIExample[]
  link: ExtractedAPIExample[]
  action: ExtractedAPIExample[]
}
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `extractAPIExamples(moduleName, testDir?)` | Main entry point - extracts all examples for a module |
| `generateModulePatterns(moduleName)` | Creates glob patterns to find test files |
| `extractExamplesFromFile(content, fileName, moduleName)` | Parses a test file for API calls |
| `extractRequestBody(content, startIndex)` | Extracts request body from API call |
| `categorizeEndpoint(method, endpoint)` | Categorizes endpoints (create/read/update/delete/link/action) |
| `formatExamplesForSpec(examples)` | Formats examples for spec output |

#### Test File Discovery

The extractor searches for test files using multiple patterns:
```typescript
const modulePatterns = [
  `${moduleName}*.spec.ts`,           // designs*.spec.ts
  `*${moduleName}*.spec.ts`,          // *designs*.spec.ts
  `${withHyphen}*.spec.ts`,           // email-templates*.spec.ts
  `*${withHyphen}*.spec.ts`,          // *email-templates*.spec.ts
  `admin-${moduleName}*.spec.ts`,     // admin-partners*.spec.ts
  // ... more patterns
]
```

#### Category Detection

Endpoints are categorized based on:
- **Link operations:** Contains `/link`, `/unlink`, `/inventory`, `/assign`, `/attach`
- **Action operations:** Contains `/approve`, `/reject`, `/send`, `/accept`, `/finish`, `/complete`, `/start`, `/resume`, `/export`, `/checkout`
- **CRUD operations:** Based on HTTP method (GET=read, POST=create, PUT/PATCH=update, DELETE=delete)

---

### 3. Integration into Spec Generator

The API example extraction is integrated as Step 13 in the spec generation flow.

**File:** [src/scripts/generate-enhanced-specs.ts](src/scripts/generate-enhanced-specs.ts)

```typescript
// Step 13: API Examples Extraction
console.log("\n📚 Step 13: Extracting API examples from integration tests...")
let apiExamples: CategorizedAPIExamples | undefined
try {
  apiExamples = await extractAPIExamples(moduleName, path.join(this.projectRoot, "integration-tests/http"))
  const totalExamples =
    apiExamples.create.length +
    apiExamples.read.length +
    apiExamples.update.length +
    apiExamples.delete.length +
    apiExamples.link.length +
    apiExamples.action.length
  console.log(`  ✅ Extracted: ${totalExamples} API examples`)
} catch (error) {
  console.warn(`  ⚠️ Could not extract API examples: ${error}`)
}
```

---

## Updated Spec Format

The `CompleteModuleSpec` interface now includes:

```typescript
interface CompleteModuleSpec {
  // ... existing fields ...

  // NEW: Real API examples from integration tests
  apiExamples?: {
    create: object[]    // POST examples for creating entities
    read: object[]      // GET examples for listing/retrieving
    update: object[]    // PUT/PATCH examples for updating
    delete: object[]    // DELETE examples
    link: object[]      // Linking operations (inventory, relationships)
    action: object[]    // Action endpoints (approve, export, etc.)
  }
}
```

### Example Output

```json
{
  "apiExamples": {
    "create": [
      {
        "description": "Create new designs",
        "method": "POST",
        "endpoint": "/admin/designs",
        "requestBody": "{ name,\n  status,\n  product_id }",
        "responseKey": "design",
        "sourceFile": "designs-api.spec.ts:74"
      }
    ],
    "link": [
      {
        "description": "Link designs relationship",
        "method": "POST",
        "endpoint": "/admin/designs/:id/inventory",
        "requestBody": "{ inventoryIds: [...] }",
        "sourceFile": "design-inventory-link-api.spec.ts:66"
      }
    ]
  }
}
```

---

## Usage

### Generate Spec for Single Module

```bash
npx tsx src/scripts/generate-enhanced-specs.ts designs
```

### Generate Specs for All Modules

```bash
npx tsx src/scripts/generate-all-specs.ts
```

Environment variables:
- `DELAY_SECONDS=60` - Seconds between each module (default: 60)
- `START_FROM=partner` - Skip modules before this one

### Extract API Examples Only

```bash
npx tsx src/scripts/extract-api-examples.ts designs
```

---

## Files Changed

| File | Type | Description |
|------|------|-------------|
| [src/scripts/generate-enhanced-specs.ts](src/scripts/generate-enhanced-specs.ts) | Modified | Added Medusa types integration, fixed workflow extraction, added API examples |
| [src/scripts/extract-medusa-types.ts](src/scripts/extract-medusa-types.ts) | **New** | Extract types from `.medusa/types/query-entry-points.d.ts` |
| [src/scripts/extract-api-examples.ts](src/scripts/extract-api-examples.ts) | New | API example extraction from integration tests |
| [src/scripts/generate-all-specs.ts](src/scripts/generate-all-specs.ts) | Existing | Batch generation script (unchanged) |

---

## Integration Test Patterns Discovered

The following patterns are extracted from integration tests:

### Entity Creation (POST)
```typescript
// From designs-api.spec.ts
const design = await api.post("/admin/designs", {
  name: "Summer Collection 2025",
  description: "Lightweight summer wear collection",
  design_type: "Original",
  status: "Conceptual",
  priority: "High",
  tags: ["summer", "casual"],
  color_palette: [{ name: "Ocean Blue", code: "#0077be" }],
  estimated_cost: 5000,
  metadata: { season: "Summer 2025" }
}, headers)
```

### Entity Linking (POST)
```typescript
// From design-inventory-link-api.spec.ts
// Simple linking - array of IDs
const linkData = { inventoryIds: [cottonFabricId, buttonsId] }
await api.post(`/admin/designs/${designId}/inventory`, linkData, headers)

// Advanced linking - with metadata
const payload = {
  inventoryItems: [
    { inventoryId: cottonFabricId, plannedQuantity: 12, metadata: { usage: "primary-fabric" } }
  ]
}
```

### Filtering & Pagination (GET)
```typescript
// From inventory-orders-api.spec.ts
await api.get("/admin/inventory-orders?status=Pending", headers)
await api.get("/admin/inventory-orders?limit=2&offset=0", headers)
await api.get("/admin/inventory-orders?order=order_date:desc", headers)
await api.get(`/admin/inventory-orders/${id}?fields=id,orderlines.*`, headers)
```

### Multi-Step Workflows
```typescript
// From production-runs.spec.ts
// Step 1: Create parent run
const createRunRes = await api.post("/admin/production-runs",
  { design_id: designId, quantity: 10 }, adminHeaders)

// Step 2: Approve and assign
await api.post(`/admin/production-runs/${parentRunId}/approve`,
  { assignments: [{ partner_id, role, quantity }] }, adminHeaders)

// Step 3: Start dispatch
await api.post(`/admin/production-runs/${childRunId}/start-dispatch`, {}, adminHeaders)

// Step 4: Partner accepts
await api.post(`/partners/production-runs/${childRunId}/accept`, {}, partnerHeaders)
```

---

## Verification

### Test Workflow Attribution Fix
```bash
# Generate designs spec
npx tsx src/scripts/generate-enhanced-specs.ts designs

# Check workflows - should only show /src/workflows/designs/ files
cat specs/designs-complete-spec.json | jq '.workflows.definitions[].file'
```

Expected output:
```
"src/workflows/designs/approve-design-workflow.ts"
"src/workflows/designs/create-design-workflow.ts"
# ... only designs workflows
```

### Test API Examples Extraction
```bash
cat specs/designs-complete-spec.json | jq '.apiExamples'
```

Expected: Shows categorized examples from test files.

---

## Technical Notes

### glob Package Compatibility

The `glob` package in newer versions returns an async iterator, not a direct array. The fix:

```typescript
// OLD (broken)
import { glob } from "glob"
const files = await glob(pattern)

// NEW (working)
import glob from "glob"
const files = glob.sync(pattern)
if (Array.isArray(files)) {
  // ... process files
}
```

### Type Safety for apiExamples

The `formatExamplesForSpec()` function returns `object`, but the spec interface expects a specific shape. Fixed with type assertion:

```typescript
apiExamples: apiExamples
  ? formatExamplesForSpec(apiExamples) as CompleteModuleSpec["apiExamples"]
  : undefined,
```

---

## Results Summary

| Module | Workflows (Before) | Workflows (After) | API Examples |
|--------|-------------------|-------------------|--------------|
| designs | ~30+ (cross-contaminated) | 13 (correct) | 30 |
| agreements | - | 2 | 7 |
| partner | - | Correct | - |
| production_runs | - | Correct | - |

All 29 modules are being regenerated with the fixed spec generator.

---

## Related Documentation

- AI Chat V3 overview
- AI Chat V3 Enhanced RAG system proposal
- AI Chat V3 Implementation details
