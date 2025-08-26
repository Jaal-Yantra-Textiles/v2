"use server";
import { redirect } from "next/navigation";
import { clearAuthCookie, getAuthCookie } from "../../lib/auth-cookie";

export async function logout() {
  await clearAuthCookie();
  redirect("/login");
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
