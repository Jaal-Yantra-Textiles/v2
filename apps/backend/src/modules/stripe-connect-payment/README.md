# Stripe Connect payment provider (Half B)

Routes a partner's **storefront** checkout INTO their Stripe Connect (Standard)
account via **direct charges** with an `application_fee_amount` to the platform.
The connected account is onboarded/stored by Half A (`partner_payment_config`
columns `connect_account_id`, `connect_charges_enabled`, …).

## How a charge is routed

```
cart.sales_channel_id
  → store (default_sales_channel_id)      [query.graph]
  → partner                                [partner-stores-link]
  → partner_payment_config(pp_stripe_stripe, is_active)
  → connect_account_id + connect_charges_enabled
```

`initiatePayment` creates the PaymentIntent **on** the connected account
(`{ stripeAccount }`) with `application_fee_amount`.

### 🔴 Direct, not destination — and that decides who answers a chargeback

This is a **deliberate, settled** choice (#838, decided 2026-09-03), not an
accident of implementation. The issue body words *destination* charges; the code
ships *direct* ones and there is no `transfer_data` anywhere in the module.

Economically the two are near-identical: the money settles to the partner and
the platform takes a fee. **Liability is not.** With direct charges the charge
exists on the partner's own account, so a dispute or chargeback is raised
there and is the partner's to respond to — the platform has no standing to
answer it and no dispute tooling here. With destination charges it would be the
platform's.

Keeping direct means the partner carries the fraud risk on their own sales.
That is the intended split, and it is stated to the partner **before** they
connect, on the Stripe Connect card in partner settings — a partner must not
learn this from their first chargeback. If that trade is ever revisited, it is
a payments migration on live connected accounts, not a config change. The fee % comes from the
partner's active plan (`partner_subscription → plan.features.payment_processing_fee`,
e.g. `"2%"`), falling back to `defaultFeePercent`. All later operations
(authorize/capture/refund/cancel/update) re-scope to the same connected account
via `connect_account_id` stored in the payment session `data`.

Precedence — *"Connect wins when active"*: routing only happens when the partner
has `connect_charges_enabled`. Otherwise `initiatePayment` throws (or, if
`allowPlatformFallback`, charges the platform account with no fee).

## Enabling

Registered in `medusa-config(.prod).ts` only when **both** are set:

| Env | Meaning |
|-----|---------|
| `STRIPE_API_KEY` | platform Stripe secret (owns connected accounts) |
| `STRIPE_CONNECT_ENABLED=true` | opt-in flag — dormant until set |
| `STRIPE_CONNECT_DEFAULT_FEE_PERCENT` | optional; fee % when no plan resolvable (default 0) |
| `STRIPE_CONNECT_PLATFORM_FALLBACK=true` | optional; charge platform (no fee) when a store has no connected account instead of failing |

Provider id: `pp_stripe-connect_stripe-connect`. After enabling, it must be
added to the payment providers of the region(s) whose storefronts should route
to partners.

## v1 limitations (follow-ups)

- ~~**Webhook wiring**~~ — **DONE, and this bullet was stale.**
  `apps/backend/src/api/webhooks/stripe/connect/route.ts` dispatches payment
  events via `getWebhookActionAndData` → `processPaymentWorkflow`. The claim
  that it "is not yet wired" survived the wiring by months; read the route, not
  this file.
- **Refunds**: `refund_application_fee: true` by default (platform fee handed
  back so the partner isn't out-of-pocket).
- **Dispute tooling**: none. Disputes land on the partner's account by design
  (see "Direct, not destination" above) and are answered in the partner's own
  Stripe dashboard. There is no platform-side surface for them, and given the
  liability sits with the partner there is no obvious reason to build one — but
  it does mean the platform cannot see a dispute happening.
- **Admin surface**: unbuilt. The partner-facing card exists
  (`apps/partner-ui/src/routes/settings/payment-providers/components/stripe-connect-card.tsx`);
  there is no admin view of connected accounts or their state.
- **Two fee sources**: this module resolves the fee from
  `partner_subscription → plan.features.payment_processing_fee`. The #336 fee
  engine (`modules/partner_billing/resolve-fee-rate.ts`) resolves from
  `commission_bps` / `PLATFORM_TX_FEE_BPS` and is NOT called from here, despite
  a comment on #838 claiming they were unified. One partner can therefore be
  charged two different rates depending on which path books the money.
- **INR/GST**: launch EUR-first. Stripe India Connect + GST handling is out of
  scope for this slice.
- **Payouts**: handled by Stripe on the connected account's own schedule; not
  orchestrated here.
