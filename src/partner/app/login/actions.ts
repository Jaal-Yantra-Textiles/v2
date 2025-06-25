"use server";

import { setAuthCookie } from "@/lib/auth-cookie";

type LoginCredentials = {
  email: string;
  password: string;
};

export async function login(credentials: LoginCredentials) {
  const { email, password } = credentials;

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_MEDUSA_URL}/auth/partner/emailpass`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }
    );

    if (!res.ok) {
      const { message } = await res.json()
      return { error: message || "Invalid credentials" };
    }

    const { token } = await res.json();

    if (!token) {
      return { error: "Login failed, please try again." };
    }

    await setAuthCookie(token);
    return { success: true };
  } catch (e) {
    console.error(e)
    return { error: "An unexpected error occurred. Please try again." };
  }
}
