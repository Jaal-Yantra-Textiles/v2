import { MedusaService } from "@medusajs/framework/utils"
import DesignerInvite from "./models/designer-invite"

class DesignerInviteService extends MedusaService({
  DesignerInvite,
}) {
  /**
   * Look up an invite by the sha256 of its raw token. Returns null when no row
   * matches (unknown / tampered token).
   */
  async findByTokenHash(tokenHash: string) {
    const rows = await this.listDesignerInvites({ token_hash: tokenHash })
    return rows?.[0] || null
  }
}

export default DesignerInviteService
