# Partner Subscription Plans

Partners are assigned subscription plans that control access to features.

## Plans

| Plan | Price | Features |
|------|-------|----------|
| **Simple** | Free | 5 pages, 50 products, basic theme |
| **Pro** | 2,000 INR/month | 50 pages, 500 products, custom domain, full theme, analytics |
| **Max** | 5,000 INR/month | Unlimited pages/products, custom domain, full theme, analytics, priority support |

All new partners are auto-assigned the **Simple** (free) plan.

## Managing Plans (Partner Dashboard)

1. Go to **Settings > Plan & Billing**
2. View your current plan, billing period, and payment status
3. Click **Upgrade** on any plan card to switch
4. Paid plans can be canceled from this page

## Payment Providers

The system automatically selects the payment provider based on the partner's region:
- **India (INR)** — PayU
- **International** — Stripe

## Admin Management

### Seed Plans (first-time setup)

```bash
npx medusa exec src/scripts/seed-partner-plans.ts
```

This is idempotent — running it again skips existing plans.

### Assign a Plan to a Specific Partner

Edit the constants at the top of `src/scripts/assign-plan-to-partner.ts`:

```typescript
const PARTNER_HANDLE = "partner-handle"
const PLAN_SLUG = "pro"  // simple | pro | max
const PAYMENT_PROVIDER = "payu"  // payu | stripe | manual
```

Then run:
```bash
npx medusa exec src/scripts/assign-plan-to-partner.ts
```

### Record a Payment (Admin API)

```bash
POST /admin/partner-subscriptions/:id/payments
{
  "amount": 2000,
  "currency_code": "inr",
  "provider": "payu",
  "provider_reference_id": "payu_txn_123"
}
```

This extends the subscription period by 1 month.

### View Payment History (Admin API)

```bash
GET /admin/partner-subscriptions/:id/payments
```

## Automatic Renewal

A daily scheduled job (`check-subscription-expiry`) runs at midnight:
1. **Free plans** — auto-renewed, $0 payment recorded
2. **Paid plans past due** — marked `past_due`, pending payment created
3. **Past due > 7 days** — marked `expired`

## Data Model

```
PartnerPlan (name, slug, price, currency, interval, features)
  └── PartnerSubscription (status, payment_provider, period_start/end)
        └── SubscriptionPayment (amount, provider, provider_ref, paid_at)
              └── Partner (via module link)
```

## API Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/admin/partner-plans` | GET | Admin | List all plans |
| `/admin/partner-plans` | POST | Admin | Create a plan |
| `/admin/partner-plans/seed` | POST | Admin | Seed default plans |
| `/admin/partner-plans/:id` | GET/PUT/DELETE | Admin | Manage single plan |
| `/admin/partner-subscriptions` | GET/POST | Admin | List/create subscriptions |
| `/admin/partner-subscriptions/:id` | GET/DELETE | Admin | View/cancel subscription |
| `/admin/partner-subscriptions/:id/payments` | GET/POST | Admin | Payment history/recording |
| `/partners/subscription` | GET | Partner | Current plan + available plans |
| `/partners/subscription` | POST | Partner | Subscribe/upgrade |
| `/partners/subscription` | DELETE | Partner | Cancel subscription |
