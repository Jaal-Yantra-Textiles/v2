"use server";
import { redirect } from "next/navigation";
import { clearAuthCookie, getAuthCookie } from "../../lib/auth-cookie";

export async function logout() {
  await clearAuthCookie();
  redirect("/login");
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
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000";

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
