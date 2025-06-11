import { Container, Heading, Text, StatusBadge } from "@medusajs/ui";
import type { AdminPage } from "../../hooks/api/pages";

interface BlogSubscriptionInfoProps {
  page: AdminPage;
  websiteId: string;
}

export const BlogSubscriptionInfo = ({ page }: BlogSubscriptionInfoProps) => {
  const metadata = page.public_metadata || {};
  const sentAt = metadata.subscription_sent_at as string | undefined;
  const sentCount = metadata.subscription_sent_count as number | undefined;
  const failedCount = metadata.subscription_failed_count as number | undefined;
  const totalSubscribers = metadata.subscription_total_subscribers as number | undefined;

  const sentStatus = sentAt ? "Sent" : "Not Sent";
  const statusColor = sentAt ? "green" : "grey";
  const formattedSentAt = sentAt ? new Date(sentAt).toLocaleString() : "N/A";

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Subscriptions</Heading>
        <StatusBadge color={statusColor}>{sentStatus}</StatusBadge>
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Sent At
        </Text>
        <Text size="small" leading="compact">
          {formattedSentAt}
        </Text>
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Total Subscribers
        </Text>
        <Text size="small" leading="compact">
          {totalSubscribers || 0}
        </Text>
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Successful Sends
        </Text>
        <Text size="small" leading="compact">
          {sentCount || 0}
        </Text>
      </div>

      <div className="text-ui-fg-subtle grid grid-cols-2 items-center px-6 py-4">
        <Text size="small" leading="compact" weight="plus">
          Failed Sends
        </Text>
        <Text size="small" leading="compact">
          {failedCount || 0}
        </Text>
      </div>
    </Container>
  );
};
