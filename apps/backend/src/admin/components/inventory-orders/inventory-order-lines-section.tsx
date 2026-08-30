import { Container, Heading, Text, Badge, Button } from "@medusajs/ui";
import { TriangleRightMini, PencilSquare } from "@medusajs/icons";
import { useState } from "react";
import { AdminInventoryOrder, OrderLine } from "../../hooks/api/inventory-orders";
import { Link } from "react-router-dom";
import { ActionMenu } from "../common/action-menu";

// Collapse long order-line lists to keep the detail page scannable (#887).
const COLLAPSED_LINE_COUNT = 6;

export const InventoryOrderLinesSection = ({ inventoryOrder }: { inventoryOrder: AdminInventoryOrder }) => {
  // Define extended line type with inventory_item relation. The denormalized
  // color identity (#817 S2) lives on the base OrderLine type and rides along
  // with the orderlines.* field selection.
  type InventoryOrderLine = OrderLine & {
    inventory_items: [
      {
        id: string;
        sku: string;
        title?: string;
        // #1662 — the variants this item backs, when it is a finished
        // fabric/good rather than a raw material.
        variants?: Array<{
          id: string;
          title?: string | null;
          sku?: string | null;
          product?: { id: string; title?: string | null } | null;
        }>;
      }
    ];
  };

  // Only allow editing if status is Pending or Processing
  const canEdit = ["Pending", "Processing"].includes(inventoryOrder.status);

  // Handle both orderlines (from API) and order_lines (from type)
  const orderLines = (inventoryOrder as any).orderlines || inventoryOrder.order_lines || [];

  const [expanded, setExpanded] = useState(false);
  const isCollapsible = orderLines.length > COLLAPSED_LINE_COUNT;
  const visibleLines =
    isCollapsible && !expanded ? orderLines.slice(0, COLLAPSED_LINE_COUNT) : orderLines;
  const hiddenCount = orderLines.length - COLLAPSED_LINE_COUNT;

  return (
    <Container className="p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-x-4">
          <Heading level="h2">Order Lines</Heading>
        </div>
        {canEdit && (
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit",
                    to: `editorder`,
                    icon: <PencilSquare />,
                  },
                ],
              },
            ]}
          />
        )}
      </div>
      
      <div className="txt-small flex flex-col gap-2 px-2 pb-2">
        {!orderLines.length ? (
          <div className="px-6 py-4 text-ui-fg-subtle">
            <Text>No order lines found</Text>
          </div>
        ) : (
          visibleLines.map((line: InventoryOrderLine, idx: number) => {
            const inventoryItem = line.inventory_items?.[0];
            
            // Skip lines without inventory item data
            if (!inventoryItem) {
              return null;
            }
            
            const link = `/inventory/${inventoryItem.id}`;

            // #1662 — a line with no raw material fell back to the inventory
            // item's title, which for a variant-made item is the VARIANT's
            // title alone: an order full of lines reading "M" and "Red" with
            // nothing saying what was bought. Name the product first.
            const variant = inventoryItem.variants?.find((v) => v?.id);
            const productTitle = variant?.product?.title;
            const label =
              line.material_name ||
              (productTitle
                ? [productTitle, variant?.title].filter(Boolean).join(" · ")
                : inventoryItem.title) ||
              inventoryItem.sku;
            
            const Inner = (
              <div className="shadow-elevation-card-rest bg-ui-bg-component rounded-md px-4 py-2 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <span className="text-ui-fg-base font-medium">
                      {label}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {line.color && (
                        <Badge size="small" color="grey">{line.color}</Badge>
                      )}
                      {/* #1662 — say which kind of thing this line is, so a
                          purchase of finished goods is not read as material. */}
                      {!line.material_name && productTitle && (
                        <Badge size="small" color="blue">Finished goods</Badge>
                      )}
                      {(variant?.sku || inventoryItem.sku) && (
                        <Badge size="small" className="text-ui-fg-subtle">
                          {variant?.sku || inventoryItem.sku}
                        </Badge>
                      )}
                      <Badge size="small" className="text-ui-fg-subtle">Price: ${line.price}</Badge>
                      <Badge size="small" className="text-ui-fg-subtle">Quantity: {line.quantity}</Badge>
                    </div>
                  </div>
                  <div className="size-7 flex items-center justify-center">
                    <TriangleRightMini className="text-ui-fg-muted" />
                  </div>
                </div>
              </div>
            );
            
            return (
              <Link
                to={link}
                key={inventoryItem.id || idx}
                className="outline-none focus-within:shadow-borders-interactive-with-focus rounded-md [&:hover>div]:bg-ui-bg-component-hover"
              >
                {Inner}
              </Link>
            );
          })
        )}

        {isCollapsible && (
          <div className="px-2 pt-1">
            <Button
              variant="transparent"
              size="small"
              className="text-ui-fg-subtle w-full justify-center"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? "Show less" : `Show ${hiddenCount} more`}
            </Button>
          </div>
        )}
      </div>
    </Container>
  );
};

export default InventoryOrderLinesSection;
