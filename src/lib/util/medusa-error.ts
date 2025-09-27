/**
 * Normalizes Medusa/HTTP errors for UI consumption.
 * Always throws an Error (return type never) so existing try/catch UI flows work.
 * For 400 Bad Request, it crafts a friendly message and minimizes noisy logs.
 */
export default function medusaError(error: any): never {
  // Log the full error object for debugging
  console.log("medusaError received error:", error);

  // Handle top-level 400 error (non-Axios shape)
  if (error.status === 400) {
    const rawMessage = error.message || "Bad request";
    console.warn("400 Bad Request (top-level):", rawMessage);
    throw new Error(rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1));
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
      console.warn("400 Bad Request:", u.toString(), "=>", message)
      // Throw so current callers relying on try/catch can surface this to the UI
      throw new Error(message.charAt(0).toUpperCase() + message.slice(1))
    }

    // For non-400 statuses keep the richer logs for debugging
    console.error("Resource:", u.toString())
    console.error("Response data:", error.response.data)
    console.error("Status code:", status)
    console.error("Headers:", error.response.headers)

    // Extracting the error message from the response data
    const message = error.response.data.message || error.response.data

    throw new Error(message.charAt(0).toUpperCase() + message.slice(1) + ".")
  } else if (error.request) {
    // The request was made but no response was received
    throw new Error("No response received: " + error.request)
  } else {
    // Something happened in setting up the request that triggered an Error
    throw new Error("Error setting up the request: " + error.message)
  }
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
