import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, Heading, Text, toast } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useInventoryWithRawMaterials } from "../../hooks/api/raw-materials";
import { InventoryOrderLinesGrid } from "../creates/inventory-order-lines-grid";
import { AdminInventoryOrder } from "../../hooks/api/inventory-orders";
import { useUpdateInventoryOrderLines } from "../../hooks/api/inventory-orders";

// Schema for editing order lines
const editOrderLinesSchema = z.object({
  order_lines: z
    .array(
      z.object({
        id: z.string().optional(), // Existing lines have IDs
        inventory_item_id: z.string().min(1, "Item is required"),
        quantity: z.number().min(1, "Quantity must be at least 1"),
        price: z.number().min(0, "Price must be non-negative"),
        isExisting: z.boolean().optional(), // Flag to mark existing lines
      })
    )
    .min(1, "At least one order line is required"),
});

type EditOrderLinesFormData = z.infer<typeof editOrderLinesSchema>;

interface OrderLine {
  id?: string;
  inventory_item_id: string;
  quantity: number;
  price: number;
  isExisting?: boolean;
}

interface EditOrderLinesProps {
  inventoryOrder: AdminInventoryOrder;
}

export const EditOrderLines = ({ inventoryOrder }: EditOrderLinesProps) => {
  const isProcessing = inventoryOrder.status === "Processing";
  
  // Map existing order lines to form data
  // Handle both orderlines (from API) and order_lines (from type)
  const rawOrderLines = (inventoryOrder as any).orderlines || inventoryOrder.order_lines || [];
  
  const existingLines = rawOrderLines.map((line: any) => ({
    id: line.id,
    // Extract inventory_item_id from the linked inventory_items relation
    inventory_item_id: line.inventory_items?.[0]?.id || line.inventory_item_id || "",
    quantity: line.quantity,
    price: line.price,
    isExisting: true, // Mark as existing
  }));

  const form = useForm<EditOrderLinesFormData>({
    defaultValues: {
      order_lines: existingLines.length > 0 ? existingLines : [],
    },
    resolver: zodResolver(editOrderLinesSchema),
  });

  const { inventory_items = [], isLoading } = useInventoryWithRawMaterials({ limit: 100 });

  // Use Field Array for order lines
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "order_lines",
  });

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useUpdateInventoryOrderLines();

  // Calculate totals from order lines
  const calculateTotals = () => {
    const validLines = fields.filter((line: OrderLine) => line.inventory_item_id);
    const totalQuantity = validLines.reduce((sum: number, line: OrderLine) => sum + (Number(line.quantity) || 0), 0);
    const totalPrice = validLines.reduce((sum: number, line: OrderLine) => sum + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0);
    return { totalQuantity, totalPrice };
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    const { totalQuantity, totalPrice } = calculateTotals();

    // Prepare order lines for the update workflow
    const orderLines = fields.map((line: OrderLine, index: number) => {
      const formLine = data.order_lines[index];
      return {
        // Only include ID if it's marked as existing (from database)
        // New lines added by user won't have isExisting flag
        id: line.isExisting ? line.id : undefined,
        inventory_item_id: formLine.inventory_item_id,
        quantity: Number(formLine.quantity) || 0,
        price: Number(formLine.price) || 0,
      };
    });

    const payload = {
      id: inventoryOrder.id,
      data: {
        quantity: totalQuantity,
        total_price: totalPrice,
      },
      order_lines: orderLines,
    };

    try {
      await mutateAsync(payload);
      toast.success("Order lines updated successfully");
      handleSuccess();
    } catch (error) {
      toast.error((error as Error).message || "Failed to update order lines");
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col overflow-hidden">
        <RouteFocusModal.Header>
          <div className="flex items-center justify-between w-full">
            <Heading>Edit Order Lines</Heading>
          </div>
        </RouteFocusModal.Header>

        <RouteFocusModal.Body className="flex flex-col h-full overflow-hidden">
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-8">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <Heading className="text-xl">Order Lines</Heading>
                  <Button 
                    size="small" 
                    variant="secondary" 
                    type="button" 
                    onClick={() => append({ inventory_item_id: "", quantity: 0, price: 0, isExisting: false })}
                  >
                    Add New Line
                  </Button>
                </div>
                <Text size="small" className="text-ui-fg-subtle">
                  {isProcessing 
                    ? "Order is in Processing. Existing lines are read-only, but you can add new lines."
                    : "Edit order lines. You can add, update, or remove lines."}
                </Text>
              </div>

              <div className="flex-1 min-h-0">
                <InventoryOrderLinesGrid
                  form={form}
                  orderLines={fields}
                  inventoryItems={inventory_items}
                  defaultCurrencyCode="INR"
                  loading={isLoading}
                  onAddNewRow={() => append({ inventory_item_id: "", quantity: 0, price: 0, isExisting: false })}
                  onRemoveRow={remove}
                />
              </div>
              <Text size="small" className="text-ui-fg-subtle mt-2">
                Use Enter to navigate/edit cells. Press Enter in the last row to add a new line, or use the Add New Line button.
              </Text>
            </div>
            
            {/* Display calculated totals - sticky at the bottom */}
            <div className="flex-shrink-0 border-t border-dashed p-8 bg-ui-bg-base">
              <div className="flex justify-between items-center mb-2">
                <Text weight="plus">Total Order Quantity:</Text>
                <Text weight="plus">{calculateTotals().totalQuantity}</Text>
              </div>
              <div className="flex justify-between items-center">
                <Text weight="plus">Total Order Price:</Text>
                <Text weight="plus">${calculateTotals().totalPrice.toFixed(2)}</Text>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>

        <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" className="w-full sm:w-auto">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button size="small" variant="primary" type="submit" isLoading={isPending}>
              Save Changes
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
