/**
 * Normalizes Medusa/HTTP errors for UI consumption.
 * Always throws an Error (return type never) so existing try/catch UI flows work.
 * For 400 Bad Request, it crafts a friendly message and minimizes noisy logs.
 */
export class MedusaHttpError extends Error {
  status?: number
  code?: string | number
  details?: any

  constructor(message: string, opts?: { status?: number; code?: string | number; details?: any }) {
    super(message)
    this.name = "MedusaHttpError"
    if (opts) {
      this.status = opts.status
      this.code = opts.code
      this.details = opts.details
    }
  }
}

export default function medusaError(error: any): never {
  // Handle top-level 400 error (non-Axios shape)
  if (error.status === 400) {
    const rawMessage = error.message || "Bad request"
    const code = error.code || error.type
    const msg = rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1)
    throw new MedusaHttpError(msg, { status: 400, code, details: error })
  }

  if (error.response) {
    // The request was made and the server responded with a status code
    // that falls out of the range of 2xx
    const u = new URL(error.config.url, error.config.baseURL)
    const status = error.response.status

    // For 400 errors we should minimize noisy logs and surface a friendly message.
    if (status === 400) {
      // Common Medusa shapes: { message: string } OR { errors: [{ message }...] }
      const data = error.response?.data
      let rawMessage: string | undefined
      const errorCode: string | number | undefined =
        (data && (data.code || data.type)) || error.code

      if (typeof data === "string") {
        rawMessage = data
      } else if (data?.message && typeof data.message === "string") {
        rawMessage = data.message
      } else if (Array.isArray(data?.errors) && data.errors.length) {
        // Join multiple validation messages, if present
        rawMessage = data.errors
          .map((e: any) => (typeof e?.message === "string" ? e.message : ""))
          .filter(Boolean)
          .join(" \n")
      }

      const message = (rawMessage || "Bad request").toString()
      // Do a minimal, contextual log without dumping entire payloads
      // Throw so current callers relying on try/catch can surface this to the UI
      throw new MedusaHttpError(
        message.charAt(0).toUpperCase() + message.slice(1),
        { status, code: errorCode, details: data ?? error.response?.data }
      )
    }

    // For non-400 statuses keep the richer logs for debugging
    console.error("Resource:", u.toString())
    console.error("Response data:", error.response.data)
    console.error("Status code:", status)
    console.error("Headers:", error.response.headers)

    // Extracting the error message from the response data
    const message = error.response.data.message || error.response.data
    const code = error.response?.data?.code || error.response?.data?.type || error.code
    throw new MedusaHttpError(
      (message.charAt ? message.charAt(0).toUpperCase() + message.slice(1) : String(message)) + ".",
      { status, code, details: error.response?.data }
    )
  } else if (error.request) {
    // The request was made but no response was received
    throw new MedusaHttpError("No response received: " + error.request)
  } else {
    // Something happened in setting up the request that triggered an Error
    throw new MedusaHttpError("Error setting up the request: " + error.message)
  }
}

/**
 * Serializes an unknown error/MedusaHttpError into a lightweight object
 * that can be safely returned from server actions or API routes.
 */
export function serializeMedusaError(err: any): { message: string; status?: number; code?: string | number } {
  if (err instanceof MedusaHttpError) {
    return { message: err.message, status: err.status, code: err.code }
  }
  // Axios-like error
  const status = err?.response?.status ?? err?.status
  const code = err?.response?.data?.code ?? err?.response?.data?.type ?? err?.code
  const raw = err?.response?.data?.message ?? err?.message ?? "An error occurred"
  const message = typeof raw === "string" ? raw : JSON.stringify(raw)
  return { message, status, code }
}

/**
 * getMedusaErrorMessage extracts a friendly message from a Medusa/HTTP error
 * without throwing. Useful for flows that want to handle errors inline.
 */
export function getMedusaErrorMessage(error: any): string {
  try {
    // Reuse the logic above by simulating the throw path and catching the message
    medusaError(error)
    
    return "" // unreachable
  } catch (e: any) {
    return typeof e?.message === "string" && e.message ? e.message : "An error occurred"
  }
}
