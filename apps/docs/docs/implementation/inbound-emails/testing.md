---
title: "Testing"
sidebar_label: "Testing"
sidebar_position: 5
---

# Testing the Inbound Email System

## Running Tests

```bash
# All inbound email integration tests
TEST_TYPE=integration:http jest --testPathPattern="inbound-emails"

# A specific test by name
TEST_TYPE=integration:http NODE_OPTIONS="--experimental-vm-modules" \
  jest --testNamePattern="should extract order data"
```

## Test File

`integration-tests/http/inbound-emails-api.spec.ts`

Uses the shared test setup (`setupSharedTestSuite`, `createAdminUser`, `getAuthHeaders`).

### Test Helper

Tests seed data directly via the module service:

```typescript
const createTestEmail = async (overrides = {}) => {
  const service = container.resolve("inbound_emails")
  return service.createInboundEmails({
    imap_uid: `uid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    from_address: "orders@vendor.com",
    to_addresses: ["team@example.com"],
    subject: "Order Confirmation #12345",
    html_body: "<html>...<table>..items..</table>...</html>",
    folder: "INBOX",
    received_at: new Date(),
    status: "received",
    ...overrides,
  })
}
```

## Test Coverage

### Service-Level CRUD (6 tests)

| Test | What's Verified |
|------|-----------------|
| Create record | ID has `inb_email_` prefix, fields stored correctly |
| Retrieve by ID | Returns matching record |
| List + count with filters | Status filter works, count is accurate |
| Update record | Status and action_type update correctly |
| Delete record | Record no longer retrievable |
| JSON and nullable fields | `metadata`, `to_addresses` stored/returned as JSON; nullable fields accept `null` |

### GET /admin/inbound-emails (10 tests)

| Test | What's Verified |
|------|-----------------|
| Empty list | Returns `{ inbound_emails: [], count: 0, offset: 0, limit: 20 }` |
| Pagination | `limit` and `count` work correctly |
| Offset pagination | Different records on different pages |
| Status filter | Only matching status returned |
| from_address filter | Exact match works |
| folder filter | Exact match works |
| Search by subject (q) | Partial match on subject |
| Search by from_address (q) | Partial match on sender |
| Excluded heavy fields | `html_body`, `text_body`, `extracted_data`, `action_result` not in list |
| Invalid status | Returns 400 |
| Unauthenticated | Returns 401 |

### GET /admin/inbound-emails/:id (3 tests)

| Test | What's Verified |
|------|-----------------|
| Full detail | All fields including `html_body` and `to_addresses` returned |
| Non-existent ID | Returns 404 |
| Unauthenticated | Returns 401 |

### POST /admin/inbound-emails/:id/extract (7 tests)

| Test | What's Verified |
|------|-----------------|
| Extract order data | `order_number`, `currency`, `items` extracted from HTML |
| Status update | Changes to `action_pending`, stores `extracted_data` |
| Unknown action type | Returns 400 |
| Missing action_type | Returns 400 |
| Non-existent email | Returns 404 |
| Table-based item extraction | Items parsed from `<table>` rows |
| Idempotency | Extracting twice returns same data |

### POST /admin/inbound-emails/:id/ignore (5 tests)

| Test | What's Verified |
|------|-----------------|
| Set status | Returns `{ status: "ignored" }` |
| Persistence | Detail endpoint confirms status change |
| Idempotent | Ignoring already-ignored email works |
| Non-existent email | Returns 404 |
| From any status | Works on `action_pending` emails too |

### GET /admin/inbound-emails/actions (3 tests)

| Test | What's Verified |
|------|-----------------|
| Lists actions | Array with at least 1 action |
| Action metadata | `create_inventory_order` has `type`, `label`, `description` |
| No internal functions | Response doesn't include `extract` or `execute` methods |

### POST /admin/inbound-emails/:id/execute (4 tests)

| Test | What's Verified |
|------|-----------------|
| Missing action_type | Returns 400 |
| Missing params | Returns 400 |
| Unknown action type | Returns 400 |
| Non-existent email | Returns 404 |

### POST /admin/inbound-emails/sync (2 tests)

| Test | What's Verified |
|------|-----------------|
| IMAP not configured | Returns error (test env has no IMAP vars) |
| Count parameter | Passes validation |

### Lifecycle (1 test)

| Test | What's Verified |
|------|-----------------|
| Full flow | `received` → extract → `action_pending` → filter works → ignore → `ignored` |

### Edge Cases (5 tests)

| Test | What's Verified |
|------|-----------------|
| Minimal HTML | Empty items array, no crash |
| Empty HTML body | Handles gracefully |
| Concurrent requests | Extract + detail in parallel don't conflict |
| Special characters in email | `user+tag@sub.domain.co.uk` stored correctly |
| Long subjects | 500-char subject stored and returned |

## Adding Tests for New Actions

When adding a new action, add tests for:

1. **Extract** — verify extracted data shape for the new action type
2. **Execute** — verify the action creates the expected records (mock or real)
3. **Validation** — verify required params are enforced
4. **Error handling** — verify errors are stored on the email record
