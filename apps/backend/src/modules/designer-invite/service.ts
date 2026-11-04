import { MedusaService } from "@medusajs/framework/utils"
import DesignPreviewLink from "./models/design-preview-link"
import DesignerInvite from "./models/designer-invite"

class DesignerInviteService extends MedusaService({
  DesignerInvite,
  DesignPreviewLink,
}) {
  /**
   * Look up an invite by the sha256 of its raw token. Returns null when no row
   * matches (unknown / tampered token).
   */
  async findByTokenHash(tokenHash: string) {
    const rows = await this.listDesignerInvites({ token_hash: tokenHash })
    return rows?.[0] || null
  }

  /** Same lookup for a design preview link (#2500). */
  async findPreviewLinkByTokenHash(tokenHash: string) {
    const rows = await this.listDesignPreviewLinks({ token_hash: tokenHash })
    return rows?.[0] || null
  }
}

export default DesignerInviteService
