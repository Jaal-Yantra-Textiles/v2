import { MedusaService } from "@medusajs/framework/utils"
import PartnerPaymentConfig from "./models/partner-payment-config"

class PartnerPaymentConfigService extends MedusaService({
  PartnerPaymentConfig,
}) {
  /**
   * Find active payment config for a partner + provider combo.
   */
  async findActiveConfig(partnerId: string, providerId: string) {
    const configs = await this.listPartnerPaymentConfigs({
      partner_id: partnerId,
      provider_id: providerId,
      is_active: true,
    })
    return configs?.[0] || null
  }

  /**
   * Find all active configs for a partner.
   */
  async findPartnerConfigs(partnerId: string) {
    return this.listPartnerPaymentConfigs({
      partner_id: partnerId,
      is_active: true,
    })
  }
}

export default PartnerPaymentConfigService
