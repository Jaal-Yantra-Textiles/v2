/**
 * WhatsApp template spec for partner payment-status notifications.
 *
 * Three templates today (matching the events emitted by the
 * payment_submissions workflows):
 *   - received → submission was created (admin-side or partner-side)
 *   - rejected → admin reviewed and rejected
 *   - paid    → admin approved + payment was processed
 *
 * We deliberately don't ship an `approved` template: the approve path
 * goes Approved → Paid in the same workflow (review-payment-submission)
 * so `.approved` is never a stable state the partner observes. If a
 * future change holds at Approved (e.g. for human payment review),
 * add the template + event then.
 *
 * Format follows partner-run-templates.ts. See that file's header for
 * editing rules — body shape must be identical across languages, every
 * placeholder needs an example for Meta approval, etc.
 *
 * No buttons: these are status notifications, no action needed by the
 * partner. No image header for v1 — text-only templates approve fastest
 * and the message is purely informational. Promote to IMAGE header (and
 * a `_v2` suffix) if we ever need delivery outside the 24-hour
 * customer-care window for these specific events.
 */

import type { TemplateSpec } from "./partner-run-templates"

const TEMPLATE_PAYMENT_RECEIVED: TemplateSpec = {
  name: "jyt_payment_submission_received_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, we've received your payment request of {{2}}.\n\n" +
        "*Reference:* {{3}}\n\n" +
        "Our team will review and update you shortly. " +
        "Thanks for working with us.",
      examples: ["Rajesh", "INR 1,500.00", "psub_01ABC"],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, हमें आपका {{2}} का भुगतान अनुरोध मिल गया है।\n\n" +
        "*संदर्भ:* {{3}}\n\n" +
        "हमारी टीम जल्द ही समीक्षा करेगी और आपको सूचित करेगी। " +
        "साथ काम करने के लिए धन्यवाद।",
      examples: ["राजेश", "INR 1,500.00", "psub_01ABC"],
    },
  ],
}

const TEMPLATE_PAYMENT_REJECTED: TemplateSpec = {
  name: "jyt_payment_submission_rejected_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Hi {{1}}, your payment request of {{2}} (ref {{3}}) " +
        "could not be approved.\n\n" +
        "*Reason:* {{4}}\n\n" +
        "Please reach out to the admin team if you have any questions " +
        "or want to resubmit.",
      examples: [
        "Rajesh",
        "INR 1,500.00",
        "psub_01ABC",
        "Receipt was illegible — please attach a clearer photo",
      ],
    },
    {
      language: "hi",
      body:
        "नमस्ते {{1}}, आपका {{2}} ({{3}}) का भुगतान अनुरोध स्वीकार नहीं किया जा सका।\n\n" +
        "*कारण:* {{4}}\n\n" +
        "यदि आपके कोई प्रश्न हैं या आप पुनः अनुरोध करना चाहते हैं, " +
        "तो कृपया हमारी टीम से संपर्क करें।",
      examples: [
        "राजेश",
        "INR 1,500.00",
        "psub_01ABC",
        "रसीद स्पष्ट नहीं थी — कृपया एक स्पष्ट फोटो भेजें",
      ],
    },
  ],
}

const TEMPLATE_PAYMENT_PAID: TemplateSpec = {
  name: "jyt_payment_submission_paid_v1",
  category: "UTILITY",
  languages: [
    {
      language: "en",
      body:
        "Good news {{1}} — your payment of {{2}} has been processed.\n\n" +
        "*Reference:* {{3}}\n" +
        "*Method:* {{4}}\n\n" +
        "Please confirm receipt at your end. Thanks for your work.",
      examples: ["Rajesh", "INR 1,500.00", "psub_01ABC", "Bank"],
    },
    {
      language: "hi",
      body:
        "अच्छी खबर {{1}} — आपका {{2}} का भुगतान कर दिया गया है।\n\n" +
        "*संदर्भ:* {{3}}\n" +
        "*माध्यम:* {{4}}\n\n" +
        "कृपया अपनी ओर से प्राप्ति की पुष्टि करें। आपके काम के लिए धन्यवाद।",
      examples: ["राजेश", "INR 1,500.00", "psub_01ABC", "Bank"],
    },
  ],
}

export const PARTNER_PAYMENT_TEMPLATES: TemplateSpec[] = [
  TEMPLATE_PAYMENT_RECEIVED,
  TEMPLATE_PAYMENT_REJECTED,
  TEMPLATE_PAYMENT_PAID,
]

export const PAYMENT_TEMPLATE_NAMES = {
  PAYMENT_RECEIVED: TEMPLATE_PAYMENT_RECEIVED.name,
  PAYMENT_REJECTED: TEMPLATE_PAYMENT_REJECTED.name,
  PAYMENT_PAID: TEMPLATE_PAYMENT_PAID.name,
} as const
