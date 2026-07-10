import { Avatar, Text } from "@medusajs/ui"
import { Link } from "react-router-dom"

type UserLinkProps = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  type?: "customer" | "user"
}

export const UserLink = ({
  id,
  first_name,
  last_name,
  email,
  type = "user",
}: UserLinkProps) => {
  const name = [first_name, last_name].filter(Boolean).join(" ")
  const fallback = name ? name.slice(0, 1) : email.slice(0, 1)
  const link = type === "user" ? `/settings/users/${id}` : `/customers/${id}`

  return (
    <Link
      to={link}
      className="transition-fg hover:text-ui-fg-subtle focus-visible:shadow-borders-focus flex w-fit items-center gap-x-2 rounded-md outline-none"
    >
      <Avatar size="2xsmall" fallback={fallback.toUpperCase()} />
      <Text size="small" leading="compact" weight="regular">
        {name || email}
      </Text>
    </Link>
  )
}

// Investor UI has no admin user/customer API access, so an actor id can't be
// resolved to a name here. Render nothing rather than call an admin endpoint
// (which 401s → clears the token → logout). Kept as a no-op so existing
// references still type-check.
export const By = (_props: { id: string }) => {
  return null
}
