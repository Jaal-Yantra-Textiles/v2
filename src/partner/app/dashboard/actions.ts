"use server";
import { redirect } from "next/navigation";
import { clearAuthCookie, getAuthCookie } from "../../lib/auth-cookie";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";

// Global helper: if backend returns 401/403, redirect to login
// Note: We don't clear the cookie here because this function is called during
// page rendering, and cookies can only be modified in Server Actions or Route Handlers.
// The auth-layer component will handle clearing the cookie on the client side.
async function enforceAuthOrRedirect(res: Response) {
  if (res.status === 401 || res.status === 403) {
    redirect("/login");
  }
}

export async function logout() {
  await clearAuthCookie();
  redirect("/login");
}

// Media: upload and attach via backend APIs (used by client components instead of Next API proxy)
export async function partnerUploadDesignMedia(designId: string, formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      // Important: do NOT set Content-Type for multipart; let fetch set the boundary
    },
    body: formData,
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to upload media")
  }
  const json = await res.json()
  return json as { files: Array<{ id?: string; url: string }> }
}

export async function partnerAttachDesignMedia(
  designId: string,
  payload: { media_files: Array<{ id?: string; url: string; isThumbnail?: boolean }>; metadata?: Record<string, unknown> }
) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/media/attach`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to attach media")
  }
  return await res.json()
}

export async function partnerUploadAndAttachDesignMedia(
  designId: string,
  formData: FormData,
  opts?: { setThumbnail?: boolean }
) {
  const uploaded = await partnerUploadDesignMedia(designId, formData)
  const files = Array.isArray(uploaded?.files) ? uploaded.files : []
  const setThumb = !!opts?.setThumbnail
  const media_files = files.map((f, idx) => ({ url: f.url, id: f.id, isThumbnail: setThumb && idx === 0 }))
  const metadata = setThumb && media_files.length > 0 ? { thumbnail: media_files[0]?.url } : undefined
  return await partnerAttachDesignMedia(designId, { media_files, metadata })
}

// Server Action: Use from forms to upload and attach media, then revalidate the design page
export async function partnerUploadAndAttachDesignMediaAction(formData: FormData) {
  const designId = String(formData.get("designId") || "")
  if (!designId) {
    throw new Error("Missing designId")
  }
  const setThumbRaw = formData.get("setThumbnail")
  const setThumbnail = !!setThumbRaw && String(setThumbRaw).toLowerCase() !== "false"

  // Compute file count for tracing attributes
  const files: File[] = []
  for (const [key, value] of formData.entries()) {
    if (key === "files" && value instanceof File) files.push(value)
  }

  // Build a new FormData that contains only files for the upload endpoint
  const uploadFD = new FormData()
  for (const f of files) uploadFD.append("files", f)

  try {
    // Upload
    const uploaded = await partnerUploadDesignMedia(designId, uploadFD)
    // Attach
    const uploadedFiles = Array.isArray(uploaded?.files) ? uploaded.files : []
    const media_files = uploadedFiles.map((f, idx) => ({ url: f.url, id: f.id, isThumbnail: setThumbnail && idx === 0 }))
    const metadata = setThumbnail && media_files.length > 0 ? { thumbnail: media_files[0]?.url } : undefined
    await partnerAttachDesignMedia(designId, { media_files, metadata })

    revalidatePath(`/dashboard/designs/${designId}`)
  } catch (e) {
    Sentry.captureException(e)
    throw e
  }
}

// Payments: methods and payments listing/creation
export type PartnerPaymentMethod = {
  id: string
  type: "bank_account" | "cash_account" | "digital_wallet"
  account_name: string
  account_number?: string | null
  bank_name?: string | null
  ifsc_code?: string | null
  wallet_id?: string | null
  created_at?: string
}

export type PartnerPayment = {
  id: string
  amount?: number
  currency_code?: string
  created_at?: string
  metadata?: Record<string, unknown> | null
}

export async function getPartnerPaymentMethods() {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const partner = await getDetails()
  if (!partner?.id) return [] as PartnerPaymentMethod[]

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/${partner.id}/payments/methods`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  await enforceAuthOrRedirect(res)
  if (!res.ok) {
    console.error("Failed to fetch partner payment methods:", await res.text())
    return [] as PartnerPaymentMethod[]
  }
  const json = await res.json()
  return (json?.paymentMethods || []) as PartnerPaymentMethod[]
}

export async function addPartnerPaymentMethod(formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const partner = await getDetails()
  if (!partner?.id) throw new Error("Partner not found")

  // Build payload per validators at src/api/partners/[id]/payments/validators.ts
  const type = String(formData.get("type") || "bank_account") as "bank_account" | "cash_account" | "digital_wallet"
  const account_name = String(formData.get("account_name") || "")
  const account_number = formData.get("account_number") ? String(formData.get("account_number")) : undefined
  const bank_name = formData.get("bank_name") ? String(formData.get("bank_name")) : undefined
  const ifsc_code = formData.get("ifsc_code") ? String(formData.get("ifsc_code")) : undefined
  const wallet_id = formData.get("wallet_id") ? String(formData.get("wallet_id")) : undefined

  const payload: Record<string, unknown> = {
    type,
    account_name,
  }
  if (account_number) payload.account_number = account_number
  if (bank_name) payload.bank_name = bank_name
  if (ifsc_code) payload.ifsc_code = ifsc_code
  if (wallet_id) payload.wallet_id = wallet_id

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/${partner.id}/payments/methods`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to add payment method")
  }
  return await res.json()
}

export async function getPartnerPayments() {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const partner = await getDetails()
  if (!partner?.id) return [] as PartnerPayment[]

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/${partner.id}/payments`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  await enforceAuthOrRedirect(res)
  if (!res.ok) {
    console.error("Failed to fetch partner payments:", await res.text())
    return [] as PartnerPayment[]
  }
  const json = await res.json()
  return (json?.payments || []) as PartnerPayment[]
}

export type PartnerPerson = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  role?: string | null
  created_at?: string
}

export async function getPartnerPeople() {
  const token = await getAuthCookie()
  if (!token) redirect("/login")

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  // get current partner to determine id
  const partner = await getDetails()
  if (!partner?.id) return [] as PartnerPerson[]

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/${partner.id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  await enforceAuthOrRedirect(res)
  if (!res.ok) {
    console.error("Failed to fetch partner people:", await res.text())
    return [] as PartnerPerson[]
  }
  const json = await res.json()
  // API typically returns { result: [...]} or { partner: { people: [...] }}; handle both
  return (json?.result?.[0]?.people || json?.people || json?.partner?.people || []) as PartnerPerson[]
}

export async function addPartnerPerson(formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const partner = await getDetails()
  if (!partner?.id) throw new Error("Partner not found")

  const person = {
    first_name: String(formData.get("first_name") || ""),
    last_name: String(formData.get("last_name") || ""),
    email: String(formData.get("email") || ""),
  }

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/${partner.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ people: [person] }),
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to add person")
  }
  return await res.json()
}

export async function updatePartnerStatusVerification(formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const status = String(formData.get("status") || "") as
    | "active"
    | "inactive"
    | "pending"
  const isVerifiedRaw = formData.get("is_verified")
  // Switch/checkbox can submit "on" or "true" or "1"; coerce robustly
  const is_verified = (() => {
    if (typeof isVerifiedRaw === "string") {
      const v = isVerifiedRaw.toLowerCase()
      return v === "true" || v === "on" || v === "1"
    }
    return Boolean(isVerifiedRaw)
  })()

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify({ status, is_verified }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to update partner status & verification")
  }
}

export async function updatePartnerGeneral(formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const name = String(formData.get("name") || "")
  const handle = String(formData.get("handle") || "")

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify({ name, handle }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to update partner general details")
  }
}

export async function updatePartnerBranding(formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const logo = String(formData.get("logo") || "")

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/update`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    body: JSON.stringify({ logo: logo || null }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to update partner branding")
  }
}

// Deprecated: partnerCompleteDesignWithInventory removed in favor of partnerCompleteDesignWithConsumptions

// Deprecated: partnerReportDesignInventory removed; use partnerCompleteDesignWithConsumptions via the complete route

export async function partnerCompleteInventoryOrder(
  orderId: string,
  body: {
    notes?: string
    deliveryDate?: string
    delivery_date?: string
    trackingNumber?: string
    tracking_number?: string
    lines: { order_line_id: string; quantity: number }[]
  }
) {
  const token = await getAuthCookie();

  if (!token) {
    redirect("/login");
  }

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000";

  try {
    const response = await fetch(
      `${MEDUSA_BACKEND_URL}/partners/inventory-orders/${orderId}/complete`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to complete (ship) inventory order");
    }

    return await response.json();
  } catch (e) {
    console.error("Error completing inventory order:", e);
    throw e;
  }
}

export async function getPartnerInventoryOrder(orderId: string) {
  const token = await getAuthCookie();

  if (!token) {
    redirect("/login");
  }

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000";

  try {
    const response = await fetch(
      `${MEDUSA_BACKEND_URL}/partners/inventory-orders/${orderId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );
    await enforceAuthOrRedirect(response)

    if (!response.ok) {
      console.error("Failed to fetch partner inventory order:", response.statusText);
      return null;
    }

    const data = await response.json();
    return data?.inventoryOrder ?? null;
  } catch (e) {
    // Do not swallow redirects; rethrow for Next.js to handle
    throw e
  }
}

export async function partnerStartInventoryOrder(orderId: string) {
  const token = await getAuthCookie();

  if (!token) {
    redirect("/login");
  }

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000";

  try {
    const response = await fetch(
      `${MEDUSA_BACKEND_URL}/partners/inventory-orders/${orderId}/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Failed to start inventory order");
    }

    return await response.json();
  } catch (e) {
    console.error("Error starting inventory order:", e);
    throw e;
  }
}

export async function getDetails() {
  const token = await getAuthCookie();

  if (!token) {
    // This will be handled by the requireAuth guard in most cases,
    // but it's good practice to have it here too.
    redirect("/login");
  }

  // It's best practice to store this in an environment variable
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000";

  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/partners/details`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      // Cache the result for a short period to avoid refetching on every navigation
      next: { revalidate: 60 },
    });
    await enforceAuthOrRedirect(response)
    
    if (!response.ok) {
      console.error("Failed to fetch partner details:", response.statusText);
      // In a real app, you might want to throw an error or handle it differently
      return null;
    }

    const { partner } = await response.json();
    return partner;
  } catch (error) {
    // Do not swallow redirects; rethrow for Next.js to handle
    throw error
  }
}

export async function getPartnerInventoryOrders({ limit = 20, offset = 0, status }: { limit?: number; offset?: number; status?: string }) {
  const token = await getAuthCookie();

  if (!token) {
    redirect("/login");
  }

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000";

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (status) params.set("status", status);

  try {
    const response = await fetch(
      `${MEDUSA_BACKEND_URL}/partners/inventory-orders?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        // We need freshest data as partner status changes via workflows
        cache: "no-store",
      }
    );
    await enforceAuthOrRedirect(response)
    if (!response.ok) {
      console.error("Failed to fetch partner inventory orders:", response.statusText);
      return { inventory_orders: [], count: 0, limit, offset };
    }

    return await response.json();
  } catch (e) {
    // Do not swallow redirects; rethrow for Next.js to handle
    throw e
  }
}

export async function getPartnerDesigns({ limit = 20, offset = 0, status }: { limit?: number; offset?: number; status?: string }) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const params = new URLSearchParams()
  params.set("limit", String(limit))
  params.set("offset", String(offset))
  if (status) params.set("status", status)

  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs?${params.toString()}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    )
    await enforceAuthOrRedirect(response)
    if (!response.ok) {
      console.error("Failed to fetch partner designs:", response.statusText)
      return { designs: [], count: 0, limit, offset }
    }
    return await response.json()
  } catch (e) {
    // Do not swallow redirects; rethrow for Next.js to handle
    throw e
  }
}

export async function getPartnerDesign(designId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  try {
    const response = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    )
    await enforceAuthOrRedirect(response)
    if (!response.ok) {
      console.error("Failed to fetch partner design:", response.statusText)
      return null
    }
    const data = await response.json()
    return data?.design ?? null
  } catch (e) {
    // Do not swallow redirects; rethrow for Next.js to handle
    throw e
  }
}

export async function partnerStartDesign(designId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to start design")
  return res.json()
}

export async function partnerFinishDesign(designId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to finish design")
  return res.json()
}

export async function partnerRedoDesign(designId: string, formData: FormData) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const notes = String(formData.get("notes") || "")
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/redo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to request redo")
  return res.json()
}

export async function partnerCompleteDesign(designId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to complete design")
  return res.json()
}

// Complete a design providing consumptions array (inventory_item_id and quantity). location_id is optional and
// will be resolved server-side from the first linked stock location when not supplied.
export async function partnerCompleteDesignWithConsumptions(
  designId: string,
  consumptions: Array<{ inventory_item_id: string; quantity?: number; location_id?: string }>
) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ consumptions }),
    cache: "no-store",
  })
  await enforceAuthOrRedirect(res)
  if (!res.ok) throw new Error((await res.text()) || "Failed to complete design with consumptions")
  return res.json()
}

export async function partnerRefinishDesign(designId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/refinish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to re-finish design")
  return res.json()
}

// ===== Multipart upload (partner) server actions =====
export async function partnerMultipartInitiate(input: { name: string; type: string; size: number; folderPath?: string }) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/medias/uploads/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to initiate multipart upload")
  return res.json() as Promise<{ uploadId: string; key: string; bucket?: string; region?: string; partSize: number }>
}

export async function partnerMultipartPartUrls(input: { uploadId: string; key: string; partNumbers: number[] }) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/medias/uploads/parts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to get presigned part URLs")
  return res.json() as Promise<{ urls: { partNumber: number; url: string }[] }>
}

export async function partnerMultipartComplete(input: {
  uploadId: string
  key: string
  parts: { PartNumber: number; ETag: string }[]
  name: string
  type: string
  size: number
}) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL || process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/medias/uploads/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to complete multipart upload")
  return res.json() as Promise<{ s3: { location: string; key: string } }>
}

export async function partnerAttachDesignMediaDirect(
  designId: string,
  media_files: Array<{ url: string; id?: string; isThumbnail?: boolean }>,
  metadata?: Record<string, unknown>
) {
  return partnerAttachDesignMedia(designId, { media_files, metadata })
}

// ============ TASKS ============

export type PartnerTask = {
  id: string
  title: string
  description?: string
  priority: string
  status: string
  end_date?: string | Date
  start_date?: string | Date
  metadata?: Record<string, unknown>
  created_at: string | Date
  updated_at: string | Date
}

export async function getPartnerTasks() {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/assigned-tasks`, {
    method: "GET",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    cache: "no-store",
  })
  
  await enforceAuthOrRedirect(res)
  
  if (!res.ok) {
    console.error("Failed to fetch partner tasks:", await res.text())
    return { tasks: [] as PartnerTask[], count: 0 }
  }
  
  const json = await res.json()
  return { 
    tasks: (json?.tasks || []) as PartnerTask[], 
    count: json?.count || 0 
  }
}

export async function acceptTask(taskId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/accept`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    cache: "no-store",
  })
  
  await enforceAuthOrRedirect(res)
  
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to accept task")
  }
  
  revalidatePath("/dashboard/tasks")
  return await res.json()
}

export async function finishTask(taskId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/finish`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    cache: "no-store",
  })
  
  await enforceAuthOrRedirect(res)
  
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to finish task")
  }
  
  revalidatePath("/dashboard/tasks")
  return await res.json()
}

export type TaskComment = {
  id: string
  comment: string
  author_type: "partner" | "admin"
  author_id: string
  author_name: string
  created_at: string
}

export async function getTaskComments(taskId: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/comments`, {
    method: "GET",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    cache: "no-store",
  })
  
  await enforceAuthOrRedirect(res)
  
  if (!res.ok) {
    console.error("Failed to fetch task comments:", await res.text())
    return { comments: [] as TaskComment[], count: 0 }
  }
  
  const json = await res.json()
  return { 
    comments: (json?.comments || []) as TaskComment[], 
    count: json?.count || 0 
  }
}

export async function addTaskComment(taskId: string, comment: string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/assigned-tasks/${taskId}/comments`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${token}` 
    },
    body: JSON.stringify({ comment }),
    cache: "no-store",
  })
  
  await enforceAuthOrRedirect(res)
  
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || "Failed to add comment")
  }
  
  revalidatePath("/dashboard/tasks")
  return await res.json()
}
