"use server"

// Define a specific type for the registration data
type RegisterPartnerData = {
  company_name: string
  handle: string
  first_name: string
  last_name: string
  email: string
  password: string
}

export async function registerPartner(data: RegisterPartnerData) {
  const { company_name, handle, first_name, last_name, email, password } = data

  const MEDUSA_BACKEND_URL =
    process.env.MEDUSA_BACKEND_URL ||
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
    "http://localhost:9000"

  const api = async (path: string, options: RequestInit) => {
    const res = await fetch(
      `${MEDUSA_BACKEND_URL}${path}`,
      options
    )

    if (!res.ok) {
      const { message } = await res.json()
      throw new Error(message || "An API error occurred.")
    }

    return res.json()
  }

  try {
    // 1. Register the admin user
    await api("/auth/partner/emailpass/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    // 2. Log in to get the auth token
    const { token } = await api("/auth/partner/emailpass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })

    if (!token) {
      return { error: "Failed to retrieve auth token after registration." }
    }

    // 3. Create the partner profile
    const partnerPayload = {
      name: company_name,
      handle,
      admin: {
        email,
        first_name,
        last_name,
      },
    }

    await api("/partners", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(partnerPayload),
    })

    // The user is now registered. They will be redirected to the login page.
    return { success: true }
  } catch (e: unknown) {
    console.error(e)
    let message = "An unexpected error occurred."
    if (e instanceof Error) {
      message = e.message
    }
    return { error: message }
  }
}
