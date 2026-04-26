import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Textarea, Button, toast } from "@medusajs/ui"
import { DocumentSeries } from "@medusajs/icons"
import { useEffect, useMemo, useState } from "react"

import {
  useProductionRunPolicy,
  useUpdateProductionRunPolicy,
} from "../../../hooks/api/production-run-policy"

const ProductionRunPolicyPage = () => {
  const { policy, isLoading } = useProductionRunPolicy()
  const updatePolicy = useUpdateProductionRunPolicy()

  const initialText = useMemo(() => {
    return JSON.stringify(policy?.config || {}, null, 2)
  }, [policy?.config])

  const [raw, setRaw] = useState<string>("{}")
  const [jsonError, setJsonError] = useState<string | null>(null)

  useEffect(() => {
    setRaw(initialText)
    setJsonError(null)
  }, [initialText])

  const onSave = async () => {
    try {
      const parsed = JSON.parse(raw)
      setJsonError(null)

      await updatePolicy.mutateAsync({
        config: parsed,
      })

      toast.success("Production run policy saved")
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        setJsonError("Invalid JSON")
        return
      }

      toast.error("Failed to save policy")
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Production Run Policy</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Edit policy rules as JSON. These rules gate transitions like approve, dispatch, accept.
        </Text>
      </div>

      <div className="px-6 py-4 space-y-3">
        <Textarea
          value={raw}
          onChange={(e) => {
            const next = e.target.value
            setRaw(next)
            try {
              JSON.parse(next)
              setJsonError(null)
            } catch {
              setJsonError("Invalid JSON")
            }
          }}
          rows={18}
          className="font-mono text-xs"
          disabled={isLoading || updatePolicy.isPending}
        />

        {jsonError && (
          <Text className="text-ui-fg-error" size="small">
            {jsonError}
          </Text>
        )}

        <div className="flex justify-end">
          <Button
            onClick={onSave}
            disabled={Boolean(jsonError) || isLoading || updatePolicy.isPending}
          >
            Save
          </Button>
        </div>
      </div>
    </Container>
  )
}

export default ProductionRunPolicyPage

export const config = defineRouteConfig({
  label: "Production Run Policy",
  icon: DocumentSeries,
})

export const handle = {
  breadcrumb: () => "Production Run Policy",
}
