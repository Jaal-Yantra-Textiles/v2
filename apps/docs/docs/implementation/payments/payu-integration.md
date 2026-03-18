# PayU Payment Integration

PayU is the payment provider for Indian (INR) regions, supporting UPI, netbanking, cards, and wallets.

## Architecture

```
Storefront (checkout)
  → Medusa creates payment session (initiatePayment)
  → PayU provider returns txnid, hash, payment_url
  → Storefront creates hidden form, submits to PayU
  → Customer completes payment on PayU (OTP, UPI, netbanking)
  → PayU redirects to surl (success) or furl (failure)
  → Storefront API route completes cart / shows error
```

## Module Location

```
src/modules/payu-payment/
├── index.ts      # ModuleProvider(Modules.PAYMENT, { services: [PayUPaymentProviderService] })
└── service.ts    # AbstractPaymentProvider implementation
```

## Configuration

### Environment Variables

```env
PAYU_MERCHANT_KEY=your_merchant_key
PAYU_MERCHANT_SALT=your_merchant_salt
PAYU_MODE=test       # "test" or "live"
```

### medusa-config.ts

The provider is registered conditionally when `PAYU_MERCHANT_KEY` is set:

```typescript
...(process.env.PAYU_MERCHANT_KEY ? [{
  resolve: "./src/modules/payu-payment",
  id: "payu",
  options: {
    merchant_key: process.env.PAYU_MERCHANT_KEY,
    merchant_salt: process.env.PAYU_MERCHANT_SALT,
    mode: process.env.PAYU_MODE || "test",
    auto_capture: true,
  },
}] : []),
```

## Provider Methods

| Method | What it does |
|--------|-------------|
| `initiatePayment` | Generates txnid, SHA-512 hash, returns PayU form params |
| `authorizePayment` | Verifies payment with PayU's `verify_payment` API |
| `capturePayment` | Verifies captured status (PayU auto-captures) |
| `refundPayment` | Calls `cancel_refund_transaction` API |
| `getPaymentStatus` | Maps PayU status to Medusa's PaymentSessionStatus |
| `getWebhookActionAndData` | Validates reverse hash, returns capture/failure action |

## Hash Generation

Payment hash (SHA-512):
```
key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt
```

API hash (for verify/refund):
```
key|command|var1|salt
```

## PayU API Endpoints

| Environment | Payment URL | Info URL |
|-------------|------------|---------|
| Test | `https://test.payu.in/_payment` | `https://test.payu.in/merchant/postservice.php` |
| Live | `https://secure.payu.in/_payment` | `https://info.payu.in/merchant/postservice.php` |

## Storefront Integration

### Payment Button

`apps/storefront-starter/src/modules/checkout/components/payment-button/index.tsx`

The `PayUPaymentButton` component:
1. Reads payment session data (txnid, hash, payment_url, key)
2. Creates a hidden HTML form with all PayU parameters
3. Sets `surl` and `furl` to Next.js API routes
4. Submits the form (browser redirect to PayU)

### Callback Routes

```
apps/storefront-starter/src/app/api/payu/
├── success/route.ts    # POST handler for PayU surl
└── failure/route.ts    # POST handler for PayU furl
```

**Success**: Completes the cart via Medusa SDK, clears cart cookie, redirects to order confirmation.

**Failure**: Redirects back to checkout with error message.

## Auto-Assignment for Indian Regions

The `create-store-with-defaults.ts` workflow auto-assigns PayU (`pp_payu_payu`) for stores with INR currency or IN country.

### Manual Assignment

```bash
npx medusa exec src/scripts/assign-payu-to-partner.ts
```

This uses `remoteLink.create()` to link PayU to all INR regions via `LINKS.RegionPaymentProvider`.

## Test Credentials

| Method | Credentials |
|--------|------------|
| Net Banking | Username: `payu`, Password: `payu`, OTP: `123456` |
| UPI | VPA: `anything@payu` or `success@payu` |

See [PayU Test Docs](https://docs.payu.in/docs/test-integration) for more test cards and wallets.
