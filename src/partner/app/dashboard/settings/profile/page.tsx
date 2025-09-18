import { Heading, Text } from "@medusajs/ui"

import { ProfileSettingsClient } from "./profile-settings-client"
import { getDetails } from "../../actions"

export default async function ProfileSettingsPage() {
  const partner = await getDetails()
  return (
    <div className="flex flex-col gap-y-6">
      <div>
        <Heading level="h1">Profile</Heading>
        <Text className="text-ui-fg-subtle">Manage your partner profile and branding.</Text>
      </div>
      <ProfileSettingsClient initial={partner} />
    </div>
  )
}
