import { model } from "@medusajs/framework/utils"
import Website from "./website"

const WebsiteDomain = model.define("website_domain", {
  id: model.id().primaryKey(),
  domain: model.text().unique(),
  is_primary: model.boolean().default(false),
  website: model.belongsTo(() => Website, { mappedBy: "domains" }),
})

export default WebsiteDomain
