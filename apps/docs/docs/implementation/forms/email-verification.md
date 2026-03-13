---
title: "Email Verification for Form Submissions"
sidebar_label: "Email Verification"
sidebar_position: 1
---

# Email Verification for Form Submissions

OTP-based email verification for public form submissions, preventing spam and fake entries.

**Date**: 2026-03-13
**Status**: Production Ready

---

## Overview

Public form submissions (e.g. the contact form at jaalyantra.com/contact) are saved immediately with status `"new"`. Without verification, anyone can submit fake email addresses. This feature adds an opt-in, per-form OTP verification step that:

- Sends a 6-digit code to the submitter's email
- Holds the response in `"pending_verification"` until the code is confirmed
- Is controlled per form via the `settings.require_email_verification` flag
- Integrates with the existing `sendNotificationEmailWorkflow` + Resend pipeline

Forms without the setting enabled, or submissions without an email, continue to work exactly as before.

## Architecture

```
User submits form
       |
       v
 +--------------------------+
 | submitFormResponseWorkflow|
 +--------------------------+
       |
       +-- require_email_verification OFF or no email?
       |     => status: "new" (existing flow)
       |
       +-- require_email_verification ON + email present?
             => status: "pending_verification"
             => generate 6-digit OTP (10 min TTL)
             => send verification email
             |
             v
       User receives email with code
             |
             v
 +-----------------------------+
 | verifyFormResponseWorkflow  |
 +-----------------------------+
       |
       +-- code valid + not expired?
       |     => status: "new", clear OTP fields
       |
       +-- code invalid / expired?
             => error response
```

## Database Changes

Two nullable columns added to `form_response`:

| Column | Type | Description |
|--------|------|-------------|
| `verification_code` | `text` | 6-digit OTP, cleared after verification |
| `verification_expires_at` | `timestamptz` | Expiry timestamp (now + 10 minutes) |

The `status` CHECK constraint was updated to include `"pending_verification"`:

```sql
CHECK("status" in ('new', 'read', 'archived', 'pending_verification'))
```

A composite index on `(verification_code, form_id)` supports lookups.

**Migration**: `Migration20260313031405` (auto-generated via `npx medusa db:generate forms`)

## Enabling Verification on a Form

Set `require_email_verification: true` in the form's `settings` JSON field via the admin API:

```bash
curl -X POST http://localhost:9000/admin/forms \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Contact",
    "handle": "contact",
    "domain": "jaalyantra.com",
    "status": "published",
    "settings": {
      "require_email_verification": true
    }
  }'
```

Or update an existing form:

```bash
curl -X POST http://localhost:9000/admin/forms/:id \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "require_email_verification": true
    }
  }'
```

## API Endpoints

### Submit Form (existing, modified)

```
POST /web/website/:domain/forms/:handle
```

**Request body** (unchanged):

```json
{
  "email": "user@example.com",
  "data": { "name": "Jane", "message": "Hello" }
}
```

**Response** when verification is enabled:

```json
{
  "response": {
    "id": "form_resp_01ABC...",
    "status": "pending_verification",
    "email": "user@example.com",
    "data": { "name": "Jane", "message": "Hello" }
  }
}
```

**Response** when verification is disabled (unchanged):

```json
{
  "response": {
    "id": "form_resp_01ABC...",
    "status": "new"
  }
}
```

### Verify Code (new)

```
POST /web/website/:domain/forms/:handle/verify
```

**Request body**:

```json
{
  "response_id": "form_resp_01ABC...",
  "code": "482917"
}
```

**Success response** (`200`):

```json
{
  "response": {
    "id": "form_resp_01ABC...",
    "status": "new"
  },
  "verified": true
}
```

**Error responses**:

| Status | Condition | Message |
|--------|-----------|---------|
| 404 | Response not found | "Form response not found" |
| 400 | Already verified | "Response is already verified or processed" |
| 400 | Wrong code | "Invalid verification code" |
| 403 | Code expired | "Verification code has expired" |

## Backend Implementation

### Modified Files

#### Model: `src/modules/forms/models/form-response.ts`

Added fields to the DML model:

```typescript
status: model
  .enum(["new", "read", "archived", "pending_verification"])
  .default("new"),

// ... existing fields ...

verification_code: model.text().nullable(),
verification_expires_at: model.dateTime().nullable(),
```

Added composite index:

```typescript
.indexes([
  // ... existing indexes ...
  { on: ["verification_code", "form_id"] },
])
```

#### Workflow: `src/workflows/forms/submit-form-response.ts`

The `submitFormResponseWorkflow` now checks `form.settings?.require_email_verification` after fetching the published form. If enabled and an email is provided:

1. Generates a 6-digit OTP via `crypto.randomInt(100000, 999999)`
2. Sets a 10-minute expiry
3. Creates the response with `status: "pending_verification"`
4. Sends a verification email using `sendNotificationEmailWorkflow` with template key `"form-verification"`

The OTP generation and conditional branching use Medusa's `transform()` and `when()` workflow primitives.

#### Workflow: `src/workflows/forms/verify-form-response.ts`

New workflow with two steps:

1. **`fetchAndValidateFormResponseStep`** — retrieves the response by ID and validates:
   - Exists (404 if not)
   - Status is `"pending_verification"` (400 if not)
   - Code has not expired (403 if expired)
   - Code matches input (400 if mismatch)

2. **`promoteFormResponseStep`** — updates the response:
   - `status` -> `"new"`
   - `verification_code` -> `null`
   - `verification_expires_at` -> `null`

#### Route: `src/api/web/website/[domain]/forms/[handle]/verify/route.ts`

Simple POST handler that delegates to `verifyFormResponseWorkflow`:

```typescript
export const POST = async (
  req: MedusaRequest<WebVerifyFormResponse>,
  res: MedusaResponse
) => {
  const { result } = await verifyFormResponseWorkflow(req.scope).run({
    input: {
      response_id: req.validatedBody.response_id,
      code: req.validatedBody.code,
    },
  })

  res.status(200).json({ response: result, verified: true })
}
```

#### Validator: `src/api/web/website/[domain]/forms/[handle]/validators.ts`

```typescript
export const webVerifyFormResponseSchema = z.object({
  response_id: z.string().min(1),
  code: z.string().length(6),
})
```

#### Middleware: `src/api/middlewares.ts`

Added route registration:

```typescript
{
  matcher: "/web/website/:domain/forms/:handle/verify",
  method: "POST",
  middlewares: [
    validateAndTransformBody(wrapSchema(webVerifyFormResponseSchema)),
  ],
},
```

## Frontend Implementation

The frontend is in the separate `jyt-web` repository.

### `jyt-web/app/actions.ts`

**`handleContactFormSubmission`** — modified to parse the API response body. When `response.status === "pending_verification"`, it returns:

```typescript
{
  success: true,
  needsVerification: true,
  responseId: response.id,
  message: "Check your email for a verification code.",
}
```

**`handleVerifyCode`** — new server action that POSTs to the verify endpoint:

```typescript
export async function handleVerifyCode(prevState, formData: FormData) {
  const responseId = formData.get("response_id")
  const code = formData.get("code")
  // POST to /web/website/{domain}/forms/{handle}/verify
  // Returns { success: true, message: "..." } or error
}
```

### `jyt-web/components/ContactForm.tsx`

The component now has a `step` state: `"form"` | `"verify"` | `"done"`.

- **Step `"form"`**: The existing contact form. On successful submission that returns `needsVerification: true`, transitions to `"verify"` and stores the `responseId`.
- **Step `"verify"`**: Displays a message ("We've sent a 6-digit code to your email"), a numeric input with `inputMode="numeric"` and `autoComplete="one-time-code"`, and a verify button.
- **Step `"done"`**: Shows the success confirmation message.

## Email Template

The verification email uses template key `"form-verification"`. The template receives these data variables:

| Variable | Type | Description |
|----------|------|-------------|
| `code` | `string` | The 6-digit verification code |
| `form_title` | `string` | Title of the form (e.g. "Contact") |
| `form_handle` | `string` | Handle of the form (e.g. "contact") |

Ensure this template exists in the email templates system before enabling verification on any form.

## Security Considerations

- **OTP is 6 digits** (100000-999999), generated with `crypto.randomInt()` for cryptographic randomness
- **10-minute TTL** prevents indefinite code validity
- **Code is cleared** from the database after successful verification
- **No rate limiting** is implemented at the OTP level — consider adding rate limiting on the verify endpoint if abuse is observed
- **No resend mechanism** — if the code expires, the user must resubmit the form

## Testing

### Run Existing Tests

```bash
TEST_TYPE=integration:http jest --testPathPattern="form"
```

Existing tests should pass because forms without `require_email_verification` use the unchanged flow.

### Manual API Test

1. Create or update a form with verification enabled:

```bash
curl -X POST http://localhost:9000/admin/forms/:id \
  -d '{"settings": {"require_email_verification": true}}'
```

2. Submit the form:

```bash
curl -X POST http://localhost:9000/web/website/jaalyantra.com/forms/contact \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "data": {"name": "Test", "message": "Hello"}}'
# Expect: status "pending_verification"
```

3. Verify with the code from the email:

```bash
curl -X POST http://localhost:9000/web/website/jaalyantra.com/forms/contact/verify \
  -H "Content-Type: application/json" \
  -d '{"response_id": "form_resp_01ABC...", "code": "482917"}'
# Expect: status "new", verified: true
```

4. Test error cases:
   - Wrong code -> 400 "Invalid verification code"
   - Expired code -> 403 "Verification code has expired"
   - Already verified -> 400 "Response is already verified or processed"
   - Missing email in submission -> skips verification, status is `"new"` directly

## What Does NOT Change

- Forms without `settings.require_email_verification` work exactly as before
- Submissions without an email skip verification even if the setting is on
- Admin API routes are unchanged
- `GET /web/.../forms/:handle` and `/schema` endpoints are unchanged
- Existing `form_response` records are unaffected (new columns are nullable)
