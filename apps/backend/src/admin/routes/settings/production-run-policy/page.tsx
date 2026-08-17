import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Textarea, Button, toast } from "@medusajs/ui"
import { DocumentSeries } from "@medusajs/icons"
import { useEffect, useMemo, useState } from "react"

import {
  useProductionRunPolicy,
  useUpdateProductionRunPolicy,
} from "../../../hooks/api/production-run-policy"

const ProductionRunPolicyPage = () => {
  const { policy, effectiveConfig, missing, isLoading } =
    useProductionRunPolicy()
  const updatePolicy = useUpdateProductionRunPolicy()

  // Rules that govern the system but aren't in the stored row. The row is
  // seeded with defaults once, at creation, and never backfilled — so a policy
  // created before a key existed runs on that key's default forever while the
  // editor below shows no sign of it.
  const missingTransitions = missing?.transitions ?? []
  const missingSections = missing?.sections ?? []
  const hasGap = missingTransitions.length > 0 || missingSections.length > 0

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

      {hasGap && (
        <div className="px-6 py-4 bg-ui-tag-orange-bg space-y-2">
          <Text size="small" weight="plus">
            Some rules are in force but not saved
          </Text>
          <Text className="text-ui-fg-subtle" size="small">
            The editor below shows only what is stored. These are running on
            their built-in defaults, and editing the box will not change them —
            add them explicitly to take control of them.
          </Text>
          {missingSections.length > 0 && (
            <Text className="text-ui-fg-subtle" size="small">
              Missing sections:{" "}
              <span className="font-mono">{missingSections.join(", ")}</span>
            </Text>
          )}
          {missingTransitions.length > 0 && (
            <Text className="text-ui-fg-subtle" size="small">
              Missing transitions:{" "}
              <span className="font-mono">{missingTransitions.join(", ")}</span>
            </Text>
          )}
        </div>
      )}

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

        <div className="flex justify-end gap-x-2">
          {hasGap && (
            <Button
              variant="secondary"
              disabled={isLoading || updatePolicy.isPending}
              onClick={() => {
                // Load what is actually in force into the editor. This does not
                // save — the operator still reviews and presses Save, so
                // adopting the defaults stays a deliberate act rather than
                // something that happens to a live gating policy by itself.
                setRaw(JSON.stringify(effectiveConfig ?? {}, null, 2))
                setJsonError(null)
              }}
            >
              Load effective policy
            </Button>
          )}
          <Button
            onClick={onSave}
            disabled={Boolean(jsonError) || isLoading || updatePolicy.isPending}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="px-6 py-4 space-y-2">
        <Text size="small" weight="plus">
          Effective policy (read-only)
        </Text>
        <Text className="text-ui-fg-subtle" size="small">
          What actually governs transitions right now: the defaults with the
          stored config above layered on top.
        </Text>
        <pre className="bg-ui-bg-subtle rounded-lg p-3 font-mono text-xs overflow-x-auto">
          {JSON.stringify(effectiveConfig ?? {}, null, 2)}
        </pre>
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
