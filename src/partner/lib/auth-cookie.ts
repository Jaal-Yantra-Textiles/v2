"use server"

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const COOKIE_NAME = 'medusa_jwt'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    sameSite: "lax",
    path: "/",
  })
}

export async function getAuthCookie() {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value ?? null
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

/** Simple guard to use in server components or actions */
export async function requireAuth() {
  const token = await getAuthCookie()
  if (!token) {
    redirect('/login')
  }
  return token
}
