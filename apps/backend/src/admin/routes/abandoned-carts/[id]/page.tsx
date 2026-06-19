import { Link, useParams } from "react-router-dom";
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  toast,
  Skeleton,
  StatusBadge,
} from "@medusajs/ui";
import {
  ArrowUpRightOnBox,
  SquareTwoStack,
  ShoppingCart,
  User,
  MapPin,
} from "@medusajs/icons";
import { useAbandonedCart } from "../../../hooks/api/abandoned-carts";

const formatCurrency = (amount: number, currencyCode = "inr") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount);

const formatDate = (date: string | null | undefined) => {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatIdle = (minutes: number) => {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const SectionHeader = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
  <div className="flex items-center gap-x-2 px-6 py-3 border-b">
    <span className="text-ui-fg-subtle">{icon}</span>
    <Heading level="h3">{title}</Heading>
  </div>
);

const AbandonedCartDetailPage = () => {
  const { id } = useParams();
  const { abandonedCart: cart, isLoading, isError, error } = useAbandonedCart(id ?? "");

  if (isLoading) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4 space-y-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Container>
    );
  }

  if (isError) throw error;
  if (!cart) return null;

  const customerName = [cart.customer?.first_name, cart.customer?.last_name]
    .filter(Boolean)
    .join(" ");
  const customerEmail = cart.customer?.email ?? cart.email ?? null;

  const handleCopyRecoveryUrl = async () => {
    try {
      await navigator.clipboard.writeText(cart.recovery_url);
      toast.success("Recovery link copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div className="flex flex-col gap-y-3">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <Container className="divide-y p-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-y-3 px-6 py-4">
          <div>
            <Heading level="h1">Cart {cart.id.slice(-8)}</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-1">
              {customerEmail ?? "Guest"} · {cart.items_count} item{cart.items_count === 1 ? "" : "s"} · {formatCurrency(cart.items_subtotal, cart.currency_code)}
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <Button variant="secondary" size="small" onClick={handleCopyRecoveryUrl}>
              <SquareTwoStack /> Copy recovery link
            </Button>
            <Button asChild variant="secondary" size="small">
              <a href={cart.recovery_url} target="_blank" rel="noreferrer">
                <ArrowUpRightOnBox /> Open
              </a>
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 px-6 py-4">
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Status
            </Text>
            {cart.is_completed ? (
              <StatusBadge color="green">Completed</StatusBadge>
            ) : (
              <StatusBadge color="orange">Abandoned</StatusBadge>
            )}
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Last activity
            </Text>
            <Text size="small">{formatIdle(cart.idle_minutes)}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Created
            </Text>
            <Text size="small">{formatDate(cart.created_at)}</Text>
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">
              Channel
            </Text>
            {cart.sales_channel ? (
              <Badge size="2xsmall" color="grey">
                {cart.sales_channel.name}
              </Badge>
            ) : (
              <Text size="small" className="text-ui-fg-muted">
                —
              </Text>
            )}
          </div>
        </div>
      </Container>

      {/* ── Line items ─────────────────────────────────────────────────── */}
      <Container className="divide-y p-0">
        <SectionHeader icon={<ShoppingCart />} title="Line items" />
        {cart.items.length === 0 ? (
          <div className="px-6 py-6 text-center">
            <Text size="small" className="text-ui-fg-muted">
              No items in this cart.
            </Text>
          </div>
        ) : (
          cart.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-x-4 px-6 py-3"
            >
              <div className="flex items-center gap-x-3 min-w-0">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="h-10 w-10 rounded object-cover bg-ui-bg-subtle"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-ui-bg-subtle flex items-center justify-center">
                    <ShoppingCart className="text-ui-fg-muted" />
                  </div>
                )}
                <div className="min-w-0">
                  <Text size="small" weight="plus" className="truncate">
                    {item.title}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Qty {item.quantity} · {formatCurrency(item.unit_price, cart.currency_code)} each
                  </Text>
                </div>
              </div>
              <Text size="small" weight="plus">
                {formatCurrency((item.unit_price ?? 0) * (item.quantity ?? 0), cart.currency_code)}
              </Text>
            </div>
          ))
        )}
        <div className="flex items-center justify-between px-6 py-3 bg-ui-bg-subtle">
          <Text size="small" className="text-ui-fg-subtle">
            Subtotal
          </Text>
          <Text size="small" weight="plus">
            {formatCurrency(cart.items_subtotal, cart.currency_code)}
          </Text>
        </div>
      </Container>

      {/* ── Customer ───────────────────────────────────────────────────── */}
      <Container className="divide-y p-0">
        <SectionHeader icon={<User />} title="Customer" />
        <div className="px-6 py-4 space-y-1">
          {customerName && (
            <Text size="small" weight="plus">
              {customerName}
            </Text>
          )}
          <Text size="small" className="text-ui-fg-subtle">
            {customerEmail ?? "Guest (no email captured)"}
          </Text>
          {cart.customer?.phone && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {cart.customer.phone}
            </Text>
          )}
          {cart.customer && (
            <div className="pt-2">
              <Button asChild variant="transparent" size="small">
                <Link to= {`/customers/${cart.customer.id}`}>
                  View customer →
                </Link>
              </Button>
            </div>
          )}
        </div>
      </Container>

      {/* ── Shipping address ───────────────────────────────────────────── */}
      <Container className="divide-y p-0">
        <SectionHeader icon={<MapPin />} title="Shipping address" />
        <div className="px-6 py-4">
          {cart.shipping_address ? (
            <div className="space-y-1">
              <Text size="small">
                {[cart.shipping_address.first_name, cart.shipping_address.last_name]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                {cart.shipping_address.address_1}
                {cart.shipping_address.address_2
                  ? `, ${cart.shipping_address.address_2}`
                  : ""}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {[
                  cart.shipping_address.city,
                  cart.shipping_address.province,
                  cart.shipping_address.postal_code,
                  cart.shipping_address.country_code?.toUpperCase(),
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-muted">
              No shipping address captured yet.
            </Text>
          )}
        </div>
      </Container>

      {/* ── Recovery ───────────────────────────────────────────────────── */}
      <Container className="divide-y p-0">
        <SectionHeader icon={<ArrowUpRightOnBox />} title="Recovery" />
        <div className="px-6 py-4 space-y-2">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Storefront URL the customer can use to resume this cart.
          </Text>
          <code className="text-xs break-all text-ui-fg-base bg-ui-bg-subtle p-2 rounded block">
            {cart.recovery_url}
          </code>
          {cart.partner ? (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Owning partner:{" "}
              <span className="text-ui-fg-base">
                {cart.partner.name || cart.partner.handle || cart.partner.id}
              </span>
              {cart.partner.storefront_base
                ? ` · ${cart.partner.storefront_base.replace(/^https?:\/\//, "")}`
                : " · no storefront domain configured"}
            </Text>
          ) : (
            <Text size="xsmall" className="text-ui-fg-muted">
              Not tied to a partner storefront — using the platform base.
            </Text>
          )}
          {cart.metadata?.recovery_email_sent_at && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              Recovery email last sent {formatDate(cart.metadata.recovery_email_sent_at)}
            </Text>
          )}
        </div>
      </Container>
    </div>
  );
};

export default AbandonedCartDetailPage;

export const handle = {
  breadcrumb: () => "Cart",
};
