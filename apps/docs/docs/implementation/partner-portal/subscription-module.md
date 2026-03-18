# Partner Subscription Module

The `partner-plan` module manages subscription plans, active subscriptions, and payment tracking for partners.

## Module Structure

```
src/modules/partner-plan/
├── index.ts                           # Module export (PARTNER_PLAN_MODULE = "partnerPlan")
├── service.ts                         # MedusaService({ PartnerPlan, PartnerSubscription, SubscriptionPayment })
├── types/index.ts                     # Enums
├── models/
│   ├── partner-plan.ts                # Plan definitions
│   ├── partner-subscription.ts        # Active subscriptions
│   └── subscription-payment.ts        # Payment records
└── migrations/
    ├── Migration20260317040742.ts      # Initial tables
    └── Migration20260317165831.ts      # Added payment_provider + payments
```

## Data Models

### PartnerPlan

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | text (PK) | auto | |
| name | text (searchable) | | Plan name |
| slug | text (unique) | | URL-safe identifier |
| description | text (nullable) | | Plan description |
| price | float | 0 | Price in currency units |
| currency_code | text | "inr" | ISO currency |
| interval | enum | "monthly" | monthly / yearly |
| features | json (nullable) | | Feature flags object |
| is_active | boolean | true | Available for selection |
| sort_order | number | 0 | Display order |
| subscriptions | hasMany | | → PartnerSubscription |

### PartnerSubscription

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | text (PK) | auto | |
| partner_id | text | | Partner ID |
| status | enum | "active" | active / canceled / expired / past_due |
| payment_provider | enum | "manual" | payu / stripe / manual |
| current_period_start | datetime | | Billing period start |
| current_period_end | datetime (nullable) | | Billing period end |
| canceled_at | datetime (nullable) | | When canceled |
| plan | belongsTo | | → PartnerPlan |
| payments | hasMany | | → SubscriptionPayment |

### SubscriptionPayment

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| id | text (PK) | auto | |
| amount | float | | Payment amount |
| currency_code | text | "inr" | Currency |
| status | enum | "pending" | pending / processing / completed / failed / refunded |
| provider | enum | "manual" | payu / stripe / manual |
| provider_reference_id | text (nullable) | | External payment ID |
| provider_data | json (nullable) | | Full provider response |
| period_start | datetime | | What billing period this covers |
| period_end | datetime | | |
| paid_at | datetime (nullable) | | When payment succeeded |
| failed_at | datetime (nullable) | | When payment failed |
| failure_reason | text (nullable) | | Error message |
| subscription | belongsTo | | → PartnerSubscription |

## Enums

```typescript
enum PlanInterval { MONTHLY = "monthly", YEARLY = "yearly" }
enum SubscriptionStatus { ACTIVE, CANCELED, EXPIRED, PAST_DUE }
enum PaymentProvider { PAYU = "payu", STRIPE = "stripe", MANUAL = "manual" }
enum SubscriptionPaymentStatus { PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED }
```

## Link

`src/links/partner-subscription.ts` — links Partner (1) ↔ PartnerSubscription (many)

## Workflows

### create-subscription
`src/workflows/partner-subscription/create-subscription.ts`

1. Cancels any existing active subscriptions for the partner
2. Creates new subscription with plan, status, period, payment_provider
3. Links subscription to partner via remoteLink

### cancel-subscription
`src/workflows/partner-subscription/cancel-subscription.ts`

Sets status to canceled with timestamp. Compensation restores previous state.

### seed-plans
`src/workflows/partner-subscription/seed-plans.ts`

Idempotent — creates Simple/Pro/Max if not present. Also available as:
```bash
npx medusa exec src/scripts/seed-partner-plans.ts
```

## Scheduled Job

`src/jobs/check-subscription-expiry.ts` — runs daily at midnight:

1. **Free plans**: auto-renew + record $0 payment
2. **Paid plans expired**: mark `past_due` + create pending payment record
3. **Past due > 7 days**: mark `expired`

## Subscriber

`src/subscribers/partner-assign-free-plan.ts` — listens for `partner.created.fromAdmin` event and auto-assigns the Simple (free) plan to new partners.

## Payment Provider Selection

Determined by partner's currency:
- `metadata.currency_code === "inr"` → PayU
- Otherwise → Stripe
- Admin can override via the `payment_provider` field
