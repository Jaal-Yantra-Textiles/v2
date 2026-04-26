import { type Control, type UseFormWatch } from "react-hook-form"
import { EmailProviderFields } from "./email-provider-fields"
import { CommunicationProviderFields } from "./communication-provider-fields"
import { SmsProviderFields } from "./sms-provider-fields"
import { PaymentProviderFields } from "./payment-provider-fields"
import { ShippingProviderFields } from "./shipping-provider-fields"
import { AnalyticsProviderFields } from "./analytics-provider-fields"
import { StorageProviderFields } from "./storage-provider-fields"
import { CrmProviderFields } from "./crm-provider-fields"
import { AuthenticationProviderFields } from "./authentication-provider-fields"

type CategoryProviderFieldsProps = {
  category: string
  control: Control<any>
  watch: UseFormWatch<any>
  isEditing?: boolean
}

export const CategoryProviderFields = ({
  category,
  control,
  watch,
  isEditing,
}: CategoryProviderFieldsProps) => {
  switch (category) {
    case "email":
      return <EmailProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "communication":
      return <CommunicationProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "sms":
      return <SmsProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "payment":
      return <PaymentProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "shipping":
      return <ShippingProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "analytics":
      return <AnalyticsProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "storage":
      return <StorageProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "crm":
      return <CrmProviderFields control={control} watch={watch} isEditing={isEditing} />
    case "authentication":
      return <AuthenticationProviderFields control={control} watch={watch} isEditing={isEditing} />
    default:
      return null
  }
}

/** Categories that have provider-specific config fields */
export const CATEGORIES_WITH_PROVIDER_FIELDS = [
  "email",
  "communication",
  "sms",
  "payment",
  "shipping",
  "analytics",
  "storage",
  "crm",
  "authentication",
]

/** Check if a category has provider-specific fields */
export const hasProviderFields = (category: string) =>
  CATEGORIES_WITH_PROVIDER_FIELDS.includes(category)
