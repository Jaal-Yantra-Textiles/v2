"use client"

import React from "react"
import { Button, Text } from "@medusajs/ui"

import {
  OTP_CODE_LENGTH,
  describeOtpError,
  isCompleteCode,
  isValidEmail,
  needsNewCode,
  normalizeCodeInput,
  normalizeEmailInput,
  resendSecondsLeft,
} from "../lib/email-otp"

/**
 * "Verify your email" — the design studio's passwordless sign-in (#2543
 * phase 2). Email → 6-digit code → signed in. The routes it calls
 * (app/api/design-auth/*) set the same httpOnly session cookie as the
 * account login, so estimate/checkout and the chat see a customer.
 */

export type VerifiedSession = {
  email: string
  customer_id?: string
  adopted_design_ids?: string[]
}

type Props = {
  /** Prefill (a remembered address); the buyer can change it. */
  initialEmail?: string | null
  /** Why the panel is open — shown as the first line. */
  reason?: string | null
  onVerified: (session: VerifiedSession) => void
  onDismiss?: () => void
}

type Step = "email" | "code"

const postJson = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export function VerifyEmailPanel({ initialEmail, reason, onVerified, onDismiss }: Props) {
  const [step, setStep] = React.useState<Step>("email")
  const [email, setEmail] = React.useState(initialEmail ?? "")
  const [code, setCode] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sentAt, setSentAt] = React.useState<number | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const codeRef = React.useRef<HTMLInputElement>(null)

  // Tick the resend countdown only while one is running.
  const left = resendSecondsLeft(sentAt, now)
  React.useEffect(() => {
    if (!sentAt || left <= 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [sentAt, left])

  const sendCode = async () => {
    const normalized = normalizeEmailInput(email)
    if (!isValidEmail(normalized)) {
      setError(describeOtpError("invalid_email"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await postJson("/api/design-auth/code", { email: normalized })
      if (!res.ok) {
        setError(describeOtpError(res.data?.code, res.data?.retry_after_seconds))
        return
      }
      setEmail(normalized)
      setCode("")
      setStep("code")
      setSentAt(Date.now())
      setNow(Date.now())
      setTimeout(() => codeRef.current?.focus(), 0)
    } catch {
      setError(describeOtpError("send_failed"))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (value = code) => {
    if (!isCompleteCode(value) || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await postJson("/api/design-auth/verify", { email, code: value })
      if (!res.ok) {
        setError(describeOtpError(res.data?.code, res.data?.retry_after_seconds))
        if (needsNewCode(res.data?.code)) setCode("")
        return
      }
      onVerified({
        email: res.data?.email ?? email,
        customer_id: res.data?.customer_id,
        adopted_design_ids: res.data?.adopted_design_ids ?? [],
      })
    } catch {
      setError(describeOtpError("unknown"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-2xl border border-ui-border-interactive bg-ui-bg-subtle p-3.5 px-4 shadow-sm sm:px-6"
      data-testid="design-chat-verify-email"
    >
      <div className="flex items-start justify-between gap-2">
        <Text weight="plus" size="small">
          Verify your email
        </Text>
        {onDismiss && (
          <button
            type="button"
            aria-label="Close"
            onClick={onDismiss}
            className="px-1 text-xs text-ui-fg-muted hover:text-ui-fg-base"
          >
            ×
          </button>
        )}
      </div>
      <Text size="xsmall" className="mb-3 text-ui-fg-subtle">
        {reason ??
          "Your designs save to your email. We'll send a 6-digit code to confirm it's yours — no password."}
      </Text>

      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendCode()
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            maxLength={254}
            className="min-w-0 flex-1 rounded-full border border-ui-border-base bg-ui-bg-field px-3.5 py-2 text-sm outline-none focus:border-ui-border-strong"
            data-testid="design-chat-verify-email-input"
          />
          <Button
            type="submit"
            className="rounded-full px-5"
            isLoading={busy}
            disabled={busy || !email.trim()}
            data-testid="design-chat-verify-send"
          >
            Send code
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            verify()
          }}
          className="flex flex-col gap-2"
        >
          <Text size="xsmall" className="text-ui-fg-subtle">
            We sent a code to <span className="font-medium text-ui-fg-base">{email}</span>.{" "}
            <button
              type="button"
              onClick={() => {
                setStep("email")
                setError(null)
              }}
              className="underline hover:text-ui-fg-base"
            >
              Change
            </button>
          </Text>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d*"
              value={code}
              onChange={(e) => {
                const next = normalizeCodeInput(e.target.value)
                setCode(next)
                if (isCompleteCode(next)) verify(next)
              }}
              placeholder="6-digit code"
              maxLength={OTP_CODE_LENGTH + 2}
              aria-label="6-digit code"
              className="min-w-0 flex-1 rounded-full border border-ui-border-base bg-ui-bg-field px-3.5 py-2 text-center font-mono text-base tracking-[0.4em] outline-none focus:border-ui-border-strong"
              data-testid="design-chat-verify-code-input"
            />
            <Button
              type="submit"
              className="rounded-full px-5"
              isLoading={busy}
              disabled={busy || !isCompleteCode(code)}
              data-testid="design-chat-verify-submit"
            >
              Verify
            </Button>
          </div>
          <button
            type="button"
            onClick={sendCode}
            disabled={busy || left > 0}
            className="self-start text-[11px] text-ui-fg-muted underline enabled:hover:text-ui-fg-base disabled:no-underline"
            data-testid="design-chat-verify-resend"
          >
            {left > 0 ? `Resend code in ${left}s` : "Resend code"}
          </button>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-ui-tag-red-text"
          data-testid="design-chat-verify-error"
        >
          {error}
        </p>
      )}
    </div>
  )
}

/** "Signed in as … · Not you?" */
export function SignedInBar({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ui-fg-muted"
      data-testid="design-chat-signed-in"
    >
      <span className="min-w-0 truncate">
        Signed in as <span className="font-medium text-ui-fg-subtle">{email}</span>
      </span>
      <button type="button" onClick={onSignOut} className="underline hover:text-ui-fg-base">
        Not you?
      </button>
    </div>
  )
}
