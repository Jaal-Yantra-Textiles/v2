import { Container, Text, DropdownMenu, IconButton } from "@medusajs/ui"
import { EllipsisHorizontal } from "@medusajs/icons"
import { defineWidgetConfig } from "@medusajs/admin-sdk";
import { useAdminSuspendUser } from "../hooks/api/users";
import { DetailWidgetProps, AdminUser } from "@medusajs/framework/types"
import { Spinner } from "../components/ui/ios-spinner"
import { toast } from "@medusajs/ui";

const UserWidget = ({ data }: DetailWidgetProps<AdminUser>) => {
  const { mutateAsync } = useAdminSuspendUser(data.id);

  const handleSuspend = () => {
    mutateAsync(undefined, {
        onSuccess: () => {
            toast.success("User suspended successfully");
        },
        onError: (err: Error) => {
            console.log(err);
            toast.error(err.message);
        },
    });
  };

  const handleSendMail = () => {
    console.log("Send mail");
  };

  const resetPassword = () => {
    console.log("Reset password");
  };

  if (!data) {
        return <Spinner />
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
            <Text size="large" weight="plus">
              Actions
            </Text>
            <Text className="text-ui-fg-subtle">
              Manage this user.
            </Text>
        </div>
        <DropdownMenu>
          <DropdownMenu.Trigger asChild>
            <IconButton variant="transparent">
              <EllipsisHorizontal />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item className="text-red-500" onClick={handleSuspend}>
              Suspend user
            </DropdownMenu.Item>
            <DropdownMenu.Item className="text-blue-500" onClick={handleSendMail}>
              Send Mail
            </DropdownMenu.Item>
            <DropdownMenu.Item className="text-green-500" onClick={resetPassword}>
              Reset Password
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "user.details.after",
})

export default UserWidget
