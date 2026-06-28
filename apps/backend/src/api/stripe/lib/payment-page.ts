/**
 * Pure helpers for the self-hosted Stripe payment page (`GET /stripe/pay/:id`).
 *
 * Why a self-hosted page instead of Stripe Checkout: Medusa's Stripe provider
 * creates ONE PaymentIntent per payment session, and that's the intent the admin
 * captures. A Stripe-hosted Checkout Session would mint a *second* PaymentIntent,
 * so the order would track an unpaid intent while the money sits on another —
 * breaking manual capture. This page mounts Stripe's Payment Element against the
 * session's own `client_secret`, so the customer pays Medusa's own intent and
 * core's payment webhook completes the cart → order. Mirrors the "one real
 * payment, visible in admin" property PayU already has.
 *
 * Everything here is pure so it's unit-testable; the route does the I/O.
 */

/** Pick the Stripe payment session off a cart's payment collection. */
export function pickStripeSession(cart: any): any | null {
  const sessions: any[] = cart?.payment_collection?.payment_sessions || []
  return (
    sessions.find((s) => String(s?.provider_id || "").includes("stripe")) || null
  )
}

/** A Stripe payment session's `data` holds the PaymentIntent (incl. client_secret). */
export function clientSecretOf(session: any): string | null {
  const cs = session?.data?.client_secret
  return typeof cs === "string" && cs.length ? cs : null
}

/**
 * Format a major-unit amount + ISO currency for display, e.g. 1299 / "usd" →
 * "$1,299.00". Falls back to "<amount> <CUR>" for currencies Intl can't format.
 */
export function formatAmount(amount: unknown, currency: unknown): string {
  const num = Number(amount)
  const cur = String(currency || "").toUpperCase()
  if (!isFinite(num)) return cur || ""
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: cur || "USD",
    }).format(num)
  } catch {
    return `${num.toFixed(2)} ${cur}`.trim()
  }
}

/** Escape a string for safe interpolation into HTML text/attributes. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type StripePageState = "pay" | "paid" | "unavailable"

export type StripePageParams = {
  state: StripePageState
  /** Stripe publishable key (pk_...). Required for state="pay". */
  publishableKey?: string | null
  /** The session client_secret. Required for state="pay". */
  clientSecret?: string | null
  /** Display amount, e.g. "$1,299.00". */
  amountLabel?: string
  /** Absolute URL Stripe redirects back to after redirect-based methods. */
  returnUrl?: string
  /** Shown as the page heading. */
  title?: string
  /** Optional message rendered for paid/unavailable states. */
  message?: string
}

/**
 * Render the complete self-contained HTML for the payment page. Values that flow
 * into client JS are injected via JSON.stringify (string-literal safe); display
 * text is HTML-escaped.
 */
export function buildStripePaymentPageHtml(p: StripePageParams): string {
  const title = escapeHtml(p.title || "Complete your payment")
  const amount = escapeHtml(p.amountLabel || "")

  if (p.state !== "pay") {
    const heading = p.state === "paid" ? "Payment received" : "Payment unavailable"
    const body =
      p.message ||
      (p.state === "paid"
        ? "This order has already been paid. You can close this window."
        : "This payment link is no longer available.")
    return baseDoc(
      title,
      `<div class="card">
        <div class="status ${p.state === "paid" ? "ok" : "warn"}">${escapeHtml(heading)}</div>
        <p class="muted">${escapeHtml(body)}</p>
      </div>`,
      ""
    )
  }

  const pk = JSON.stringify(p.publishableKey || "")
  const cs = JSON.stringify(p.clientSecret || "")
  const returnUrl = JSON.stringify(p.returnUrl || "")

  const bodyHtml = `<div class="card">
      <h1>${title}</h1>
      ${amount ? `<p class="amount">${amount}</p>` : ""}
      <form id="payment-form">
        <div id="payment-element"></div>
        <button id="submit" type="submit"><span id="btn-text">Pay${amount ? ` ${amount}` : ""}</span></button>
        <div id="message" class="message" role="alert"></div>
      </form>
    </div>`

  const script = `
    const stripe = Stripe(${pk});
    const clientSecret = ${cs};
    const returnUrl = ${returnUrl};
    const form = document.getElementById("payment-form");
    const submit = document.getElementById("submit");
    const btnText = document.getElementById("btn-text");
    const message = document.getElementById("message");

    function show(text, kind) {
      message.textContent = text || "";
      message.className = "message" + (kind ? " " + kind : "");
    }
    function busy(on) {
      submit.disabled = on;
      btnText.textContent = on ? "Processing…" : btnText.dataset.idle;
    }
    btnText.dataset.idle = btnText.textContent;

    const elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create("payment");
    paymentElement.mount("#payment-element");

    // If we came back from a redirect-based method, reflect the outcome.
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment_intent_client_secret")) {
      stripe.retrievePaymentIntent(params.get("payment_intent_client_secret")).then(({ paymentIntent }) => {
        if (!paymentIntent) return;
        if (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture" || paymentIntent.status === "processing") {
          form.style.display = "none";
          show("Payment received — your order is being placed. You can close this window.", "ok");
        } else if (paymentIntent.status === "requires_payment_method") {
          show("Payment was not completed. Please try again.", "warn");
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      busy(true);
      show("");
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });
      if (error) {
        show(error.message || "Payment failed. Please try again.", "warn");
        busy(false);
        return;
      }
      // No redirect was needed (e.g. cards): we have the outcome inline.
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "requires_capture" || paymentIntent.status === "processing")) {
        form.style.display = "none";
        show("Payment received — your order is being placed. You can close this window.", "ok");
      } else {
        show("Payment could not be confirmed. Please try again.", "warn");
        busy(false);
      }
    });
  `

  return baseDoc(title, bodyHtml, script)
}

/** Shared HTML shell (head + styling) around a body + optional client script. */
function baseDoc(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
${script ? '<script src="https://js.stripe.com/v3/"></script>' : ""}
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f6f6f7; color: #1c1c1c; padding: 24px; }
  @media (prefers-color-scheme: dark) { body { background: #0f0f10; color: #f4f4f5; } .card { background: #1a1a1c; } }
  .card { width: 100%; max-width: 420px; background: #fff; border-radius: 14px; padding: 28px;
    box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .amount { font-size: 26px; font-weight: 600; margin: 4px 0 20px; }
  #payment-element { margin-bottom: 20px; }
  button { width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; background: #635bff; color: #fff;
    font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .message { margin-top: 14px; font-size: 14px; min-height: 18px; }
  .message.warn, .status.warn { color: #b4441f; }
  .message.ok, .status.ok { color: #1a7f37; }
  .status { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
  .muted { color: #6b7280; font-size: 14px; }
</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ""}
</body>
</html>`
}
