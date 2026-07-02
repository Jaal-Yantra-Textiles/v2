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
(`{ stripeAccount }`) with `application_fee_amount`. The fee % comes from the
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

- **Webhook wiring**: direct-charge `payment_intent.*` events are delivered to
  the platform's **Connect** webhook endpoint. `getWebhookActionAndData` maps
  them, but the `/webhooks/stripe/connect` route is not yet wired to dispatch
  payment events into the Medusa payment module — the happy path relies on
  client-side confirmation + `authorizePayment` on return. Wiring the webhook is
  the recommended next step for robustness.
- **Refunds**: `refund_application_fee: true` by default (platform fee handed
  back so the partner isn't out-of-pocket). Disputes/chargebacks land on the
  **partner's** account (Standard direct-charge semantics) — no platform-side
  dispute tooling yet.
- **INR/GST**: launch EUR-first. Stripe India Connect + GST handling is out of
  scope for this slice.
- **Payouts**: handled by Stripe on the connected account's own schedule; not
  orchestrated here.
