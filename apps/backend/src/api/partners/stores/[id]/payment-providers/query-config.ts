// Partner payment-providers query-config
//
// Mirrors admin's `defaultAdminPaymentPaymentProviderFields` /
// `listTransformPaymentProvidersQueryConfig` at
// `@medusajs/medusa/dist/api/admin/payments/query-config.js`. Same
// fields, same defaultLimit. See apps/docs/notes/PARTNER_API_PARITY.md.

export const defaultPartnerPaymentProviderFields = ["id", "is_enabled"]

export const listTransformQueryConfig = {
  defaults: defaultPartnerPaymentProviderFields,
  defaultLimit: 20,
  isList: true,
}
