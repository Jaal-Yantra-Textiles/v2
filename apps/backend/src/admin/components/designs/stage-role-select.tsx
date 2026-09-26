import { Select } from "@medusajs/ui"
import {
  DESIGN_PARTNER_STAGE_ROLES,
  DESIGN_PARTNER_STAGE_ROLE_LABELS,
  DesignPartnerStageRole,
} from "../../../modules/designs/partner-stage-roles"

/** Select has no empty value, so "no stage" travels as this sentinel. */
const NO_STAGE = "__none__"

export const stageRoleLabel = (value: string | null | undefined) =>
  value && value in DESIGN_PARTNER_STAGE_ROLE_LABELS
    ? DESIGN_PARTNER_STAGE_ROLE_LABELS[value as DesignPartnerStageRole]
    : "Unassigned role"

/** Picks a partner's production stage on a design (#2306); null = none. */
export const StageRoleSelect = ({
  value,
  onChange,
  disabled,
  size = "small",
}: {
  value: DesignPartnerStageRole | null
  onChange: (value: DesignPartnerStageRole | null) => void
  disabled?: boolean
  size?: "small" | "base"
}) => (
  <Select
    size={size}
    value={value ?? NO_STAGE}
    disabled={disabled}
    onValueChange={(v) => onChange(v === NO_STAGE ? null : (v as DesignPartnerStageRole))}
  >
    <Select.Trigger>
      <Select.Value placeholder="Stage" />
    </Select.Trigger>
    <Select.Content>
      <Select.Item value={NO_STAGE}>Unassigned role</Select.Item>
      {DESIGN_PARTNER_STAGE_ROLES.map((role) => (
        <Select.Item key={role} value={role}>
          {DESIGN_PARTNER_STAGE_ROLE_LABELS[role]}
        </Select.Item>
      ))}
    </Select.Content>
  </Select>
)
