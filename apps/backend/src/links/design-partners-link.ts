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
        // How the partner relates to the design: prospect / maker / designer.
        role: { type: "text", nullable: true },
        // Which production stage they do on it (#2306). Values are fixed in
        // modules/designs/partner-stage-roles.ts; null = no stage chosen yet.
        stage_role: { type: "text", nullable: true },
        sla_days: { type: "integer", nullable: true },
        performance_score: { type: "bigint", nullable: true },
        transaction_id: { type: "text", nullable: true },
        metadata: { type: "json", nullable: true },
      },
    },
  }
)