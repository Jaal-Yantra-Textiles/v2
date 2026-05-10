/**
 * Conversion Goal Form
 *
 * Used by both the create page and the edit drawer. Mirrors the backend
 * Create/UpdateGoalSchema fields exactly. Conditions are kept structured
 * (not a JSON blob) since the backend validates against fixed keys.
 *
 * Caller passes `onSuccess` so the form doesn't need to know whether it's
 * embedded in a drawer or rendered as a standalone page.
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Button,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Textarea,
  Text,
  toast,
} from "@medusajs/ui"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { sdk } from "../../../lib/config"
import { KeyboundForm } from "../../utilitites/key-bound-form"

const GOAL_TYPES = [
  { value: "lead_form", label: "Lead form" },
  { value: "purchase", label: "Purchase" },
  { value: "add_to_cart", label: "Add to cart" },
  { value: "page_view", label: "Page view" },
  { value: "time_on_page", label: "Time on page" },
  { value: "scroll_depth", label: "Scroll depth" },
  { value: "custom_event", label: "Custom event" },
]

export type GoalFormValues = {
  name: string
  description?: string
  goal_type: string
  is_active: boolean
  priority: number
  default_value?: number | null
  value_from_event: boolean
  website_id?: string
  conditions: {
    event_name?: string
    pathname_pattern?: string
    min_time_seconds?: number
    min_scroll_percent?: number
    custom_conditions?: Record<string, any>
  }
}

const DEFAULT_VALUES: GoalFormValues = {
  name: "",
  description: "",
  goal_type: "purchase",
  is_active: true,
  priority: 0,
  default_value: null,
  value_from_event: false,
  website_id: "",
  conditions: {},
}

export const GoalForm = ({
  initial,
  goalId,
  mode,
  onCancel,
  onSuccess,
  bodyClassName,
  footerClassName,
}: {
  initial?: Partial<GoalFormValues>
  goalId?: string
  mode: "create" | "edit"
  onCancel: () => void
  onSuccess: (goalId: string) => void
  bodyClassName?: string
  footerClassName?: string
}) => {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [values, setValues] = useState<GoalFormValues>({
    ...DEFAULT_VALUES,
    ...initial,
    conditions: { ...DEFAULT_VALUES.conditions, ...(initial?.conditions || {}) },
  })
  const [customConditionsText, setCustomConditionsText] = useState(
    values.conditions.custom_conditions
      ? JSON.stringify(values.conditions.custom_conditions, null, 2)
      : ""
  )
  const [customConditionsError, setCustomConditionsError] =
    useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: async (payload: GoalFormValues) => {
      // Build the conditions sub-object — drop empty fields rather than
      // sending undefined keys that the zod schema rejects on strict mode.
      const conditions: Record<string, any> = {}
      if (payload.conditions.event_name)
        conditions.event_name = payload.conditions.event_name
      if (payload.conditions.pathname_pattern)
        conditions.pathname_pattern = payload.conditions.pathname_pattern
      if (
        payload.conditions.min_time_seconds !== undefined &&
        payload.conditions.min_time_seconds !== null
      )
        conditions.min_time_seconds = payload.conditions.min_time_seconds
      if (
        payload.conditions.min_scroll_percent !== undefined &&
        payload.conditions.min_scroll_percent !== null
      )
        conditions.min_scroll_percent = payload.conditions.min_scroll_percent
      if (
        payload.conditions.custom_conditions &&
        Object.keys(payload.conditions.custom_conditions).length > 0
      )
        conditions.custom_conditions = payload.conditions.custom_conditions

      const body: Record<string, any> = {
        name: payload.name,
        description: payload.description || undefined,
        goal_type: payload.goal_type,
        is_active: payload.is_active,
        priority: payload.priority,
        default_value:
          payload.default_value === null || payload.default_value === undefined
            ? undefined
            : payload.default_value,
        value_from_event: payload.value_from_event,
        website_id: payload.website_id || undefined,
        conditions,
      }

      if (mode === "create") {
        return sdk.client.fetch<{ goal: { id: string } }>(
          "/admin/ad-planning/goals",
          { method: "POST", body }
        )
      }
      return sdk.client.fetch<{ goal: { id: string } }>(
        `/admin/ad-planning/goals/${goalId}`,
        { method: "PUT", body }
      )
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ad-planning", "goals"] })
      toast.success(mode === "create" ? "Goal created" : "Goal saved")
      onSuccess(result.goal.id)
    },
    onError: (error: any) => {
      toast.error(error.message || "Save failed")
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!values.name.trim()) {
      toast.error("Name is required")
      return
    }

    let custom: Record<string, any> | undefined = undefined
    if (customConditionsText.trim().length > 0) {
      try {
        const parsed = JSON.parse(customConditionsText)
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("custom_conditions must be a JSON object")
        }
        custom = parsed
        setCustomConditionsError(null)
      } catch (err: any) {
        setCustomConditionsError(err.message || "Invalid JSON")
        return
      }
    }

    mutation.mutate({
      ...values,
      conditions: { ...values.conditions, custom_conditions: custom },
    })
  }

  const set = <K extends keyof GoalFormValues>(k: K, v: GoalFormValues[K]) =>
    setValues((prev) => ({ ...prev, [k]: v }))

  const setCondition = <
    K extends keyof GoalFormValues["conditions"],
  >(
    k: K,
    v: GoalFormValues["conditions"][K]
  ) =>
    setValues((prev) => ({
      ...prev,
      conditions: { ...prev.conditions, [k]: v },
    }))

  return (
    <KeyboundForm
      onSubmit={handleSubmit}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div
        className={
          bodyClassName ||
          "flex flex-1 flex-col gap-y-5 overflow-y-auto px-6 py-4"
        }
      >
        <FormField label="Name" required>
          <Input
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Checkout complete"
          />
        </FormField>

        <FormField label="Description">
          <Textarea
            value={values.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What this goal tracks"
            rows={2}
          />
        </FormField>

        <FormField label="Goal type" required>
          <Select
            value={values.goal_type}
            onValueChange={(v) => set("goal_type", v)}
          >
            <Select.Trigger>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {GOAL_TYPES.map((opt) => (
                <Select.Item key={opt.value} value={opt.value}>
                  {opt.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Priority">
            <Input
              type="number"
              value={values.priority}
              onChange={(e) =>
                set("priority", Number(e.target.value || 0))
              }
            />
          </FormField>
          <FormField label="Default value">
            <Input
              type="number"
              value={values.default_value ?? ""}
              onChange={(e) =>
                set(
                  "default_value",
                  e.target.value === "" ? null : Number(e.target.value)
                )
              }
              placeholder="Optional"
            />
          </FormField>
        </div>

        <FormField label="Website ID">
          <Input
            value={values.website_id ?? ""}
            onChange={(e) => set("website_id", e.target.value)}
            placeholder="Optional — leave blank for all sites"
          />
        </FormField>

        <ToggleRow
          label="Active"
          description="Inactive goals won't increment their counters or be matched during conversion uploads."
          checked={values.is_active}
          onChange={(v) => set("is_active", v)}
        />

        <ToggleRow
          label="Value from event"
          description="When enabled, the conversion's reported value overrides the default value."
          checked={values.value_from_event}
          onChange={(v) => set("value_from_event", v)}
        />

        <div className="flex flex-col gap-y-3">
          <Heading level="h3">Conditions</Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            All filled fields are AND-ed during goal matching.
          </Text>

          <FormField label="Event name">
            <Input
              value={values.conditions.event_name ?? ""}
              onChange={(e) => setCondition("event_name", e.target.value)}
              placeholder="checkout_complete"
            />
          </FormField>

          <FormField label="Pathname pattern">
            <Input
              value={values.conditions.pathname_pattern ?? ""}
              onChange={(e) =>
                setCondition("pathname_pattern", e.target.value)
              }
              placeholder="/checkout/success*"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Min time on page (s)">
              <Input
                type="number"
                value={values.conditions.min_time_seconds ?? ""}
                onChange={(e) =>
                  setCondition(
                    "min_time_seconds",
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value)
                  )
                }
              />
            </FormField>
            <FormField label="Min scroll (%)">
              <Input
                type="number"
                value={values.conditions.min_scroll_percent ?? ""}
                onChange={(e) =>
                  setCondition(
                    "min_scroll_percent",
                    e.target.value === ""
                      ? undefined
                      : Number(e.target.value)
                  )
                }
              />
            </FormField>
          </div>

          <FormField
            label="Custom conditions (JSON)"
            error={customConditionsError}
          >
            <Textarea
              value={customConditionsText}
              onChange={(e) => {
                setCustomConditionsText(e.target.value)
                setCustomConditionsError(null)
              }}
              placeholder={`{\n  "key": "value"\n}`}
              rows={4}
              className="font-mono text-xs"
            />
          </FormField>
        </div>
      </div>
      <div className={footerClassName || "px-6 py-3 border-t"}>
        <div className="flex items-center justify-end gap-x-2">
          <Button
            size="small"
            variant="secondary"
            type="button"
            onClick={onCancel}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            size="small"
            variant="primary"
            type="submit"
            isLoading={mutation.isPending}
          >
            {mode === "create" ? "Create" : t("actions.save")}
          </Button>
        </div>
      </div>
    </KeyboundForm>
  )
}

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-y-1">
      <Label size="xsmall" className="text-ui-fg-subtle">
        {label}
        {required && <span className="text-ui-fg-error ml-1">*</span>}
      </Label>
      {children}
      {error && (
        <Text size="xsmall" className="text-ui-fg-error">
          {error}
        </Text>
      )}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between rounded-md border px-3 py-3">
      <div className="flex flex-col">
        <Text size="small" weight="plus">
          {label}
        </Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {description}
        </Text>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
