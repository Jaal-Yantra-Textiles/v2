"use server";
import { redirect } from "next/navigation";
import { clearAuthCookie } from "../../lib/auth-cookie";

export async function logout() {
  await clearAuthCookie();
  redirect("/login");
}
