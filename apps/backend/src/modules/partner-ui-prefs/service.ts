import { MedusaService } from "@medusajs/framework/utils"
import PartnerUiLayoutConfiguration from "./models/partner-ui-layout-configuration"

class PartnerUiPrefsService extends MedusaService({
  PartnerUiLayoutConfiguration,
}) {
  /**
   * Both scope rows for a (partner, zone): the partner's personal override and
   * the zone default, either of which may be absent.
   */
  async getZoneConfigurations(partnerId: string, zone: string): Promise<{
    personal: any | null
    default: any | null
  }> {
    const rows = await this.listPartnerUiLayoutConfigurations({
      partner_id: partnerId,
      zone,
    })
    const personal = rows.find((r: any) => !r.is_default) || null
    const defaultRow = rows.find((r: any) => r.is_default) || null
    return { personal, default: defaultRow }
  }

  /**
   * Upsert the single row for a (partner, zone, is_default) scope. Creates it on
   * first save, replaces its `configuration` thereafter — so the composer's
   * "save" is idempotent per scope.
   */
  async setZoneConfiguration(input: {
    partner_id: string
    zone: string
    is_default: boolean
    configuration: unknown
  }): Promise<any> {
    const existing = await this.listPartnerUiLayoutConfigurations({
      partner_id: input.partner_id,
      zone: input.zone,
      is_default: input.is_default,
    })

    if (existing?.[0]) {
      const [updated] = await this.updatePartnerUiLayoutConfigurations([
        { id: existing[0].id, configuration: input.configuration },
      ])
      return updated
    }

    const [created] = await this.createPartnerUiLayoutConfigurations([
      {
        partner_id: input.partner_id,
        zone: input.zone,
        is_default: input.is_default,
        configuration: input.configuration,
      },
    ])
    return created
  }

  /**
   * Remove the partner's PERSONAL override for a zone (leaves the default
   * untouched), mirroring the composer's "reset to default". No-op when none
   * exists. Returns whether a row was deleted.
   */
  async deletePersonalZoneConfiguration(
    partnerId: string,
    zone: string
  ): Promise<boolean> {
    const existing = await this.listPartnerUiLayoutConfigurations({
      partner_id: partnerId,
      zone,
      is_default: false,
    })
    if (!existing?.[0]) {
      return false
    }
    await this.deletePartnerUiLayoutConfigurations(existing[0].id)
    return true
  }
}

export default PartnerUiPrefsService
