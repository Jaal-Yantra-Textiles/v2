import { Container, Heading, Text, Alert, Button } from "@medusajs/ui"
import { useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { faireApi } from "../../../../../lib/api"

const FaireOauthCallback = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // OAuth codes are single-use. React StrictMode (dev) double-invokes effects,
  // and any re-render would re-run this — exchanging the same code twice yields
  // an invalid_grant error. Guard so it runs once.
  const exchangedRef = useRef(false)

  useEffect(() => {
    if (exchangedRef.current) return
    exchangedRef.current = true

    const code = params.get("code")
    const state = params.get("state")
    const errParam = params.get("error")

    if (errParam) {
      setError(
        `Faire authorization failed: ${params.get("error_description") || errParam}`
      )
      return
    }
    if (!code || !state) {
      setError("Missing code or state in Faire callback.")
      return
    }

    faireApi
      .callback(code, state)
      .then(() => {
        navigate("/settings/faire", { replace: true })
      })
      .catch((err: any) => {
        setError(err.message || "Failed to complete Faire authorization.")
      })
  }, [params, navigate])

  return (
    <Container className="flex flex-col items-center gap-4 p-8">
      <Heading level="h1">Connecting Faire…</Heading>
      {error ? (
        <Alert variant="error">
          <Text>{error}</Text>
        </Alert>
      ) : (
        <Text>Completing authorization, please wait…</Text>
      )}
      {error && (
        <Button
          size="small"
          variant="secondary"
          onClick={() => navigate("/settings/faire", { replace: true })}
        >
          Back to Faire settings
        </Button>
      )}
    </Container>
  )
}

export default FaireOauthCallback
