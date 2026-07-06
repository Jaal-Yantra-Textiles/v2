/**
 * UCP error response formatter.
 *
 * Spec error_response.json:
 *   { ucp: { version, status: "error" }, messages: [message_error, ...] }
 *
 * message_error.json required fields: type, code, content, severity
 *   severity enum: recoverable | requires_buyer_input | requires_buyer_review | unrecoverable
 */

export type UcpErrorSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable"

export type UcpErrorResponse = {
  ucp: {
    version: string
    status: "error"
  }
  messages: {
    type: "error"
    code: string
    content: string
    severity: UcpErrorSeverity
    path?: string
    content_type?: "plain" | "markdown"
  }[]
}

export function formatUcpError(params: {
  ucpVersion: string
  code: string
  content: string
  severity?: UcpErrorSeverity
  path?: string
}): UcpErrorResponse {
  return {
    ucp: {
      version: params.ucpVersion,
      status: "error",
    },
    messages: [
      {
        type: "error",
        code: params.code,
        content: params.content,
        severity: params.severity || "unrecoverable",
        ...(params.path ? { path: params.path } : {}),
      },
    ],
  }
}
