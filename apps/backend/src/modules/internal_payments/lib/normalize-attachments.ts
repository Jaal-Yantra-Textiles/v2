/**
 * Pure helpers for #496 payment file attachments.
 *
 * Keep all the validation/normalization here so it can be unit-tested without
 * booting Medusa, and reused by both the admin (`/admin/payments/link`) and
 * partner (`/partners/inventory-orders/:orderId/submit-payment`) routes.
 */

export type PaymentAttachmentInput = {
  file_id?: unknown;
  url?: unknown;
  filename?: unknown;
  mime_type?: unknown;
  size?: unknown;
  metadata?: unknown;
};

export type NormalizedPaymentAttachment = {
  file_id: string;
  url: string;
  filename: string | null;
  mime_type: string | null;
  size: number | null;
  metadata: Record<string, any> | null;
};

const toTrimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const toSize = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
};

/**
 * Normalize a raw list of attachment inputs into persistable rows.
 *
 * - drops entries missing a usable `file_id` or `url`
 * - dedupes by `file_id` (first wins)
 * - trims strings, coerces `size` to a non-negative integer (else null)
 */
export const normalizePaymentAttachments = (
  input: PaymentAttachmentInput[] | null | undefined
): NormalizedPaymentAttachment[] => {
  if (!Array.isArray(input) || !input.length) return [];

  const seen = new Set<string>();
  const rows: NormalizedPaymentAttachment[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;

    const file_id = toTrimmedString(raw.file_id);
    const url = toTrimmedString(raw.url);
    if (!file_id || !url) continue;
    if (seen.has(file_id)) continue;
    seen.add(file_id);

    rows.push({
      file_id,
      url,
      filename: toTrimmedString(raw.filename),
      mime_type: toTrimmedString(raw.mime_type),
      size: toSize(raw.size),
      metadata:
        raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
          ? (raw.metadata as Record<string, any>)
          : null,
    });
  }

  return rows;
};

export type PaymentAttachmentSummary = {
  count: number;
  total_size: number;
  file_ids: string[];
};

/** Small rollup used in workflow/route responses + logs. */
export const summarizePaymentAttachments = (
  rows: NormalizedPaymentAttachment[] | null | undefined
): PaymentAttachmentSummary => {
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    total_size: list.reduce((acc, r) => acc + (r.size ?? 0), 0),
    file_ids: list.map((r) => r.file_id),
  };
};
