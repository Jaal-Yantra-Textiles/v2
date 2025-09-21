"use server";
import { redirect } from "next/navigation";
import { clearAuthCookie, getAuthCookie } from "../../lib/auth-cookie";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";

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
    await Sentry.startSpan(
      {
        op: "media.upload_attach",
        name: "Partner Upload & Attach Media",
      },
      async (parentSpan) => {
        parentSpan?.setAttribute("design.id", designId)
        parentSpan?.setAttribute("files.count", files.length)
        parentSpan?.setAttribute("thumbnail.set", setThumbnail)

        // Upload span
        await Sentry.startSpan(
          { op: "http.client", name: `POST /partners/designs/${designId}/media` },
          async (span) => {
            try {
              await partnerUploadDesignMedia(designId, uploadFD)
            } catch (e) {
              span?.setAttribute("error", true)
              span?.setAttribute("error.message", e instanceof Error ? e.message : String(e))
              throw e
            }
          }
        )

        // Attach span
        await Sentry.startSpan(
          { op: "http.client", name: `POST /partners/designs/${designId}/media/attach` },
          async (span) => {
            try {
              await partnerUploadAndAttachDesignMedia(designId, uploadFD, { setThumbnail })
            } catch (e) {
              span?.setAttribute("error", true)
              span?.setAttribute("error.message", e instanceof Error ? e.message : String(e))
              throw e
            }
          }
        )
      }
    )

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

export async function partnerCompleteDesignWithInventory(designId: string, inventoryUsed: string | number) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  // 1) Report inventory used (idempotent)
  {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ inventory_used: inventoryUsed }),
      cache: "no-store",
    })
    if (!res.ok) throw new Error((await res.text()) || "Failed to record inventory used")
  }
  // 2) Complete design
  {
    const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) throw new Error((await res.text()) || "Failed to complete design")
    return res.json()
  }
}

export async function partnerReportDesignInventory(designId: string, inventoryUsed: number | string) {
  const token = await getAuthCookie()
  if (!token) redirect("/login")
  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"
  const res = await fetch(`${MEDUSA_BACKEND_URL}/partners/designs/${designId}/inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ inventory_used: inventoryUsed }),
    cache: "no-store",
  })
  if (!res.ok) throw new Error((await res.text()) || "Failed to record inventory used")
  return res.json()
}

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

    if (!response.ok) {
      console.error("Failed to fetch partner inventory order:", response.statusText);
      return null;
    }

    const data = await response.json();
    return data?.inventoryOrder ?? null;
  } catch (e) {
    console.error("Error fetching partner inventory order:", e);
    return null;
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
    
    if (!response.ok) {
      console.error("Failed to fetch partner details:", response.statusText);
      // In a real app, you might want to throw an error or handle it differently
      return null;
    }

    const { partner } = await response.json();
    return partner;
  } catch (error) {
    console.error("Error fetching partner details:", error);
    return null;
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

    if (!response.ok) {
      console.error("Failed to fetch partner inventory orders:", response.statusText);
      return { inventory_orders: [], count: 0, limit, offset };
    }

    return await response.json();
  } catch (e) {
    console.error("Error fetching partner inventory orders:", e);
    return { inventory_orders: [], count: 0, limit, offset };
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
    if (!response.ok) {
      console.error("Failed to fetch partner designs:", response.statusText)
      return { designs: [], count: 0, limit, offset }
    }
    return await response.json()
  } catch (e) {
    console.error("Error fetching partner designs:", e)
    return { designs: [], count: 0, limit, offset }
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
    if (!response.ok) {
      console.error("Failed to fetch partner design:", response.statusText)
      return null
    }
    const data = await response.json()
    return data?.design ?? null
  } catch (e) {
    console.error("Error fetching partner design:", e)
    return null
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
