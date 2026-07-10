# Investor & Cap Table Module — Handoff Document

## Summary

Built a complete **investor module** for the JYT Commerce platform (Medusa v2) that manages cap tables, shareholdings, funding rounds, calls for shares, payment tracking, pipeline tracking, and documents. Investors authenticate via a dedicated `"investor"` auth actor type (mirroring the partner auth pattern).

## Architecture Decision

**Option A** was chosen: a new `investor` auth actor type with a dedicated `investor-ui` app (to be cloned from `partner-ui`). The existing `company` module is extended to link cap tables and enable investor dashboards per company.

---

## What's Been Built (Backend — Complete)

### 1. Investor Module (`src/modules/investor/`)

**10 models** created:

| Model | File | Purpose |
|-------|------|---------|
| `investor` | `models/investor.ts` | Investor entity (individual/entity/fund) with admins, stakes, pipeline |
| `investor_admin` | `models/investor-admin.ts` | Login account (owner/admin/viewer roles) with password_hash |
| `cap_table` | `models/cap-table.ts` | Cap table per company — share classes, stakes, rounds, calls, docs |
| `share_class` | `models/share-class.ts` | Common/preferred/SAFE/warrant/option with liquidation prefs, voting |
| `stake` | `models/stake.ts` | Individual shareholding — shares, price, vesting, certificate, status |
| `funding_round` | `models/funding-round.ts` | Pre-seed through Series D+, with valuations and raise tracking |
| `investor_pipeline` | `models/pipeline.ts` | Investor pipeline (lead → contacted → committed → closed) |
| `call_for_shares` | `models/call-for-shares.ts` | Rights issue / capital call / follow-on with terms and ratio |
| `investor_payment` | `models/payment.ts` | Payment tracking per stake/call with status and method |
| `investor_document` | `models/document.ts` | Documents (share certs, agreements, term sheets, KYC) with visibility |

**Service & Module:**
- `service.ts` — `InvestorService extends MedusaService({...all 10 models})`
- `index.ts` — `INVESTOR_MODULE = "investor"`, `Module(INVESTOR_MODULE, { service })`

### 2. Company Module Extended (`src/modules/company/`)

Added fields to `models/company.ts`:
- `cap_table_id` (text, nullable) — links company to its cap table
- `investor_dashboard_enabled` (boolean, default false)
- `industry` (text, nullable)
- `description` (text, nullable)

### 3. Auth Configuration (`medusa-config.ts`)

- Added `investor` to `authVerificationsPerActor` (opt-in via `INVESTOR_EMAIL_VERIFICATION` env)
- Registered `./src/modules/investor` in the modules array

### 4. Investor Workflows (`src/workflows/investor/`)

- `create-investor-admin.ts` — Two workflows:
  - `createInvestorAdminWorkflow` (external, requires `authIdentityId` from login)
  - `createInvestorAdminWithRegistrationWorkflow` (internal, registers auth itself)
  - Both call `setAuthAppMetadataStep({ actorType: "investor", value: investor.id })`
  - Uses `scrypt-kdf` for password hashing (same as partner)

### 5. Investor API Routes (`src/api/investors/`)

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/investors` | POST | `allowUnregistered` | Register new investor + admin |
| `/investors/me` | GET | investor | Get current investor profile |
| `/investors/me` | POST | investor | Update investor profile |
| `/investors/admins` | GET/POST | investor | List/add investor admins |
| `/investors/companies` | GET/POST | investor | List/create companies |
| `/investors/companies/:id` | GET/POST | investor | Get/update company |
| `/investors/cap-tables` | GET/POST | investor | List/create cap tables |
| `/investors/cap-tables/:id` | GET/POST | investor | Get/update cap table |
| `/investors/cap-tables/:id/share-classes` | GET/POST | investor | Share class CRUD |
| `/investors/cap-tables/:id/stakes` | GET/POST | investor | Stake CRUD |
| `/investors/cap-tables/:id/funding-rounds` | GET/POST | investor | Funding round CRUD |
| `/investors/cap-tables/:id/calls-for-shares` | GET/POST | investor | Call for shares CRUD |
| `/investors/cap-tables/:id/documents` | GET/POST | investor | Document CRUD |
| `/investors/stakes/:id/payments` | GET/POST | investor | Payment tracking |
| `/investors/pipeline` | GET/POST | investor | Pipeline tracking |

**Helpers** (`helpers.ts`): `refetchInvestor`, `getInvestorFromAuthContext`, `requireInvestor`, `refetchCapTable`

**Validators** (`validators.ts`): Zod schemas for all entities — `investorSchema`, `investorUpdateSchema`, `capTableSchema`, `shareClassSchema`, `stakeSchema`, `fundingRoundSchema`, `pipelineSchema`, `callForSharesSchema`, `paymentSchema`, `documentSchema`, `companySchema`, `companyUpdateSchema`, `investorAdminSchema`

### 6. Middleware (`src/api/middlewares.ts`)

- Imported all investor validators
- Added `createCorsPartnerMiddleware()` catch-all for `/investors*`
- Added `applyLocale` for GET routes
- Added `authenticate("investor", ["session", "bearer"])` for all protected routes
- Added `allowUnregistered: true` for `POST /investors` (registration)
- Added `validateAndTransformBody` for all POST routes

### 7. Migration (`src/modules/investor/migrations/Migration20260709120000.ts`)

- Creates all 10 tables with proper indexes, FK constraints, and soft-delete columns
- Adds new columns to `companies` table
- Full `up()` and `down()` migrations

### 8. Integration Tests (`integration-tests/http/investors-api.spec.ts`)

Tests written following the partner test pattern (`setupSharedTestSuite`):
- **Investor Registration & Auth**: create investor, reject unauthenticated, GET /me, duplicate handle rejection
- **Cap Table Management**: create, get by id, update valuation, add share class, funding round, stake, call for shares, document
- **Payment Tracking**: create payment for stake, list payments
- **Pipeline Tracking**: create entry, list entries

**Auth flow tested:**
1. `POST /auth/investor/emailpass/register` → register
2. `POST /auth/investor/emailpass` → get JWT
3. `POST /investors` → create investor (uses `allowUnregistered` token)
4. Re-login → fresh JWT carries `actor_id: investor.id`
5. Authenticated calls to `/investors/*`

---

## What's NOT Done Yet (Remaining Work)

### Backend (Medium Priority)
- [ ] **Admin API routes** (`src/api/admin/investors/`, `src/api/admin/cap-tables/`) — for platform admins to manage all investors/cap tables
- [ ] **Upload company data** route (multipart file upload for bulk company/investor data import)
- [ ] **Run integration tests** against test DB (migration + test execution)
- [ ] **Link module** between company ↔ cap_table (Medusa link module pattern)

### Frontend (Medium Priority)
- [ ] **Clone `apps/partner-ui/` → `apps/investor-ui/`**
  - Change `jwtTokenStorageKey` to `investor_ui_auth_token`
  - Change all `/auth/partner/` → `/auth/investor/`
  - Change all `/partners/` → `/investors/`
  - Update env vars (`VITE_MEDUSA_*`)
- [ ] **Build investor dashboard routes:**
  - Portfolio overview (total invested, ownership %, valuation)
  - Cap table viewer (share classes, stakes, ownership pie chart)
  - My stakes (list of all shareholdings across companies)
  - Payments (due/paid history)
  - Documents (share certificates, agreements, financials)
  - Pipeline (prospective investments)
  - Calls for shares (active rights issues, accept/decline)
  - Settings (profile, KYC, bank details)
- [ ] **Add `yarn investor-ui:dev` and `yarn investor-ui:build` scripts** to root `package.json`

### Testing
- [ ] Run `TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="investors"` to verify tests pass
- [ ] Add unit tests for cap table calculations (ownership %, fully diluted)

---

## File Manifest (All New Files)

```
apps/backend/src/modules/investor/
├── index.ts
├── service.ts
├── migrations/Migration20260709120000.ts
└── models/
    ├── investor.ts
    ├── investor-admin.ts
    ├── cap-table.ts
    ├── share-class.ts
    ├── stake.ts
    ├── funding-round.ts
    ├── pipeline.ts
    ├── call-for-shares.ts
    ├── payment.ts
    └── document.ts

apps/backend/src/workflows/investor/
└── create-investor-admin.ts

apps/backend/src/api/investors/
├── route.ts
├── validators.ts
├── helpers.ts
├── me/route.ts
├── admins/route.ts
├── companies/route.ts
├── companies/[id]/route.ts
├── cap-tables/route.ts
├── cap-tables/[id]/route.ts
├── cap-tables/[id]/share-classes/route.ts
├── cap-tables/[id]/stakes/route.ts
├── cap-tables/[id]/funding-rounds/route.ts
├── cap-tables/[id]/calls-for-shares/route.ts
├── cap-tables/[id]/documents/route.ts
├── stakes/[id]/payments/route.ts
└── pipeline/route.ts

apps/backend/integration-tests/http/
└── investors-api.spec.ts
```

**Modified files:**
- `apps/backend/medusa-config.ts` — auth config + module registration
- `apps/backend/src/modules/company/models/company.ts` — new fields
- `apps/backend/src/api/middlewares.ts` — investor route middleware entries

---

## How to Test

```bash
# Run the investor integration tests
cd apps/backend
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="investors-api"

# Run a single test
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" jest --testPathPattern="investors-api" --testNamePattern="should create an investor"
```

## Key Patterns Used

- **Auth actor type**: `"investor"` (same pattern as `"partner"`)
- **JWT login**: `POST /auth/investor/emailpass` → `{ token }`
- **Registration**: `POST /auth/investor/emailpass/register` → `POST /investors` (allowUnregistered) → re-login
- **Auth context**: `req.auth_context.actor_id` = investor ID (set via `setAuthAppMetadataStep`)
- **Module service**: `MedusaService` auto-generates CRUD (e.g. `createInvestors`, `listCapTables`, `updateStakes`)
- **Query graph**: `container.resolve("query").graph({ entity: "investors", ... })`
- **CORS**: Reuses `createCorsPartnerMiddleware()` (same origin allow-list logic)
