import { Alert, Button, Heading, Text } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"

import AvatarBox from "../../components/common/logo-box/avatar-box"
import { confirmPartnerVerification } from "../../lib/partner-verification"

type Status = "verifying" | "success" | "error" | "missing"

export const VerifyEmail = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const code = params.get("code") || ""
  const email = params.get("email") || ""

  const [status, setStatus] = useState<Status>(code ? "verifying" : "missing")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // React 18 StrictMode double-invokes effects in dev; guard the confirm call.
  const attempted = useRef(false)

  useEffect(() => {
    if (!code || attempted.current) {
      return
    }
    attempted.current = true

    confirmPartnerVerification(code)
      .then(() => setStatus("success"))
      .catch((e: unknown) => {
        setStatus("error")
        setErrorMessage(
          e instanceof Error
            ? e.message
            : "This link is invalid or has expired."
        )
      })
  }, [code])

  return (
    <div className="bg-ui-bg-subtle relative flex min-h-dvh w-dvw items-center justify-center p-4">
      <div className="flex w-full max-w-[360px] flex-col items-center">
        <AvatarBox checked={status === "success"} />

        <div className="w-full text-center">
          {status === "verifying" && (
            <>
              <Heading>Verifying your email…</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-2 block">
                Hang tight while we confirm your email address.
              </Text>
            </>
          )}

          {status === "success" && (
            <>
              <Heading>Email verified 🎉</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-2 block">
                {email ? (
                  <>
                    <span className="text-ui-fg-base font-medium">{email}</span>{" "}
                    is confirmed. You can now sign in to your partner account.
                  </>
                ) : (
                  <>Your email is confirmed. You can now sign in.</>
                )}
              </Text>
              <Button
                className="mt-6 w-full"
                onClick={() => navigate("/login", { replace: true })}
              >
                Continue to sign in
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <Heading>We couldn't verify that link</Heading>
              <Alert className="bg-ui-bg-base mt-4 text-left" variant="error">
                {errorMessage ||
                  "This verification link is invalid or has expired."}
              </Alert>
              <Text size="small" className="text-ui-fg-subtle mt-4 block">
                Request a fresh link from the sign-up screen, then try again.
              </Text>
              <div className="mt-6 flex flex-col gap-y-3">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate("/register", { replace: true })}
                >
                  Back to sign up
                </Button>
                <Button
                  className="w-full"
                  onClick={() => navigate("/login", { replace: true })}
                >
                  Go to sign in
                </Button>
              </div>
            </>
          )}

          {status === "missing" && (
            <>
              <Heading>Missing verification code</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-2 block">
                Open the verification link from your email, or request a new one
                from the sign-up screen.
              </Text>
              <Link
                to="/register"
                className="txt-small text-ui-fg-base mt-6 inline-block font-medium"
              >
                Back to sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
