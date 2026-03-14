import { EllipsisHorizontal } from "@medusajs/icons"
import { Button, DropdownMenu } from "@medusajs/ui"
import { useNavigate } from "react-router-dom"
import { AdminSocialPlatform } from "../../../../hooks/api/social-platforms"

export const PlatformActions = ({ platform }: { platform: AdminSocialPlatform }) => {
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button variant="transparent" className="w-8 h-8 p-0">
          <EllipsisHorizontal />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        <DropdownMenu.Item
          onClick={() => navigate(`/settings/external-platforms/${platform.id}`)}
        >
          Edit
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
