import DesignModule from "../modules/designs"
import PartnerModule from "../modules/partner"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  { linkable: DesignModule.linkable.design, isList: true, filterable: ["status", "design_type", "priority", "tags", "created_at", "target_completion_date"] },
  {
    linkable: PartnerModule.linkable.partner,
    isList: true,
    filterable: ["id", "name"],
  },
  {
    database: {
      extraColumns: {
        role: { type: "text", nullable: true },
        sla_days: { type: "integer", nullable: true },
        performance_score: { type: "bigint", nullable: true },
        transaction_id: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)