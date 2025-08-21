import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, DatePicker, Heading, Text, ProgressTabs, ProgressStatus, Select, toast, Switch, Label } from "@medusajs/ui";
import { useRouteModal } from "../modal/use-route-modal";
import { useCreateInventoryOrder } from "../../hooks/api/inventory-orders";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useState, useEffect } from "react";
import { useStockLocations } from "../../hooks/api/stock_location";
import { useInventoryWithRawMaterials } from "../../hooks/api/raw-materials";
import { InventoryOrderLinesGrid } from "./inventory-order-lines-grid";

// Define a Zod schema for inventory order creation (scaffolded, update as per API contract)
export const inventoryOrderFormSchema = z
  .object({
    order_date: z.date({ required_error: "Order date is required" }),
    expected_delivery_date: z.date({ required_error: "Expected delivery date is required" }),
    // To location (required)
    stock_location_id: z.string().nonempty("To stock location is required"),
    // From location (optional)
    from_stock_location_id: z.string().optional(),
    is_sample: z.boolean().optional(),
    order_lines: z
      .array(
        z.object({
          inventory_item_id: z.string().min(1, "Item is required"),
          quantity: z.number().min(1, "Quantity must be at least 1"),
          price: z.number().min(0, "Price must be non-negative"),
        })
      )
      .min(1, "At least one order line is required"),
  })
  .superRefine((data, ctx) => {
    // Validate that from and to are not the same when both are provided
    if (data.from_stock_location_id && data.stock_location_id === data.from_stock_location_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "From and To stock locations must be different",
        path: ["from_stock_location_id"],
      });
    }
  });

type InventoryOrderFormData = z.infer<typeof inventoryOrderFormSchema>;

interface OrderLine {
  inventory_item_id: string;
  quantity: number;
  price: number;
}

enum Tab {
  GENERAL = "general",
  ORDER_LINES = "order_lines",
}

type TabState = Record<Tab, ProgressStatus>;

export const CreateInventoryOrderComponent = () => {
  const form = useForm<InventoryOrderFormData>({
    defaultValues: {
      order_date: new Date(),
      expected_delivery_date: undefined,
      stock_location_id: "",
      from_stock_location_id: undefined,
      is_sample: false,
      order_lines: [],
    },
    resolver: zodResolver(inventoryOrderFormSchema),
  });

  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress",
    [Tab.ORDER_LINES]: "not-started",
  });

  const onNext = async (currentTab: Tab) => {
    const valid = await form.trigger([
      "order_date",
      "expected_delivery_date",
      "stock_location_id",
      "from_stock_location_id",
    ]);
    if (!valid) return;
    if (currentTab === Tab.GENERAL) setTab(Tab.ORDER_LINES);
  };

  const onBack = () => {
    if (tab === Tab.ORDER_LINES) setTab(Tab.GENERAL);
  };

  useEffect(() => {
    const state = { ...tabState };
    if (tab === Tab.GENERAL) {
      state[Tab.GENERAL] = "in-progress";
      state[Tab.ORDER_LINES] = "not-started";
    }
    if (tab === Tab.ORDER_LINES) {
      state[Tab.GENERAL] = "completed";
      state[Tab.ORDER_LINES] = "in-progress";
    }
    setTabState(state);
  }, [tab]);

  const { stock_locations = [] } = useStockLocations();
  const { inventory_items = [], isLoading } = useInventoryWithRawMaterials({ limit: 100 });

  // Use Field Array for order lines
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "order_lines",
  });

  // Initialize with one empty line if no lines exist
  useEffect(() => {
    if (fields.length === 0) {
      append({ inventory_item_id: "", quantity: 0, price: 0 });
    }
  }, [fields.length, append]);

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useCreateInventoryOrder({
    onSuccess: (response) => {
      console.log(response);
      toast.success("Inventory order created successfully");
      // Navigate to the created inventory order detail page
      handleSuccess(`/inventory/orders/${response.inventoryOrder.id}`);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create inventory order");
    },
  });

  // Calculate totals from order lines
  const calculateTotals = () => {
    const validLines = fields.filter((line: OrderLine) => line.inventory_item_id);
    const totalQuantity = validLines.reduce((sum: number, line: OrderLine) => sum + (Number(line.quantity) || 0), 0);
    const totalPrice = validLines.reduce((sum: number, line: OrderLine) => sum + (Number(line.price) || 0) * (Number(line.quantity) || 0), 0);
    return { totalQuantity, totalPrice };
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    const { totalQuantity, totalPrice } = calculateTotals();

    let payload: any = {
      quantity: totalQuantity,
      total_price: totalPrice,
      order_date: data.order_date.toISOString(),
      expected_delivery_date: data.expected_delivery_date.toISOString(),
      stock_location_id: data.stock_location_id,
      status: "Pending",
      shipping_address: {},
      is_sample: data.is_sample,
      order_lines: fields
        .filter((l: OrderLine) => l.inventory_item_id)
        .map(({ inventory_item_id, quantity, price }: OrderLine) => ({ 
          inventory_item_id, 
          quantity: Number(quantity) || 0, 
          price: Number(price) || 0 
        })),
    };
    if (data.from_stock_location_id) {
      payload.from_stock_location_id = data.from_stock_location_id;
    }
    await mutateAsync(payload);
    // Navigation is now handled in the onSuccess callback
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col overflow-hidden">
        <ProgressTabs
          value={tab}
          onValueChange={async (value) => {
            // Only validate fields relevant to the current tab when navigating
            let valid = true;
            if (tab === Tab.GENERAL && value === Tab.ORDER_LINES) {
              // When moving from General to Order Lines tab, validate general fields including from/to locations
              valid = await form.trigger([
                "order_date",
                "expected_delivery_date",
                "stock_location_id",
                "from_stock_location_id",
              ]);
            } else if (tab === Tab.ORDER_LINES) {
              // When moving from Order Lines tab to any other tab, validate everything
              // But allow navigation back to General tab without full validation
              if (value !== Tab.GENERAL) {
                valid = await form.trigger();
              }
            }
            if (!valid) return;
            setTab(value as Tab);
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                <ProgressTabs.Trigger status={tabState[Tab.GENERAL]} value={Tab.GENERAL} className="max-w-[200px] truncate">General</ProgressTabs.Trigger>
                <ProgressTabs.Trigger status={tabState[Tab.ORDER_LINES]} value={Tab.ORDER_LINES} className="max-w-[200px] truncate">Order Lines</ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>

          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content value={Tab.GENERAL} className="overflow-y-auto">
              <div className="flex flex-col gap-y-6 p-8">
                <Heading className="text-xl md:text-2xl">{"Create Inventory Order"}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {"Fill in the details to create a new inventory order."}
                </Text>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Order Date */}
                  <Form.Field
                    control={form.control}
                    name="order_date"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Order Date</Form.Label>
                        <Form.Control>
                          <DatePicker {...field} />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  {/* Expected Delivery Date */}
                  <Form.Field
                    control={form.control}
                    name="expected_delivery_date"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Expected Delivery Date</Form.Label>
                        <Form.Control>
                          <DatePicker {...field} />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  {/* To Stock Location */}
                  <Form.Field
                    control={form.control}
                    name="stock_location_id"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>To Stock Location</Form.Label>
                        <Form.Control>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <Select.Trigger>
                              <Select.Value placeholder="Select location" />
                            </Select.Trigger>
                            <Select.Content>
                              {stock_locations.map((loc) => (
                                <Select.Item key={loc.id} value={loc.id}>
                                  {loc.name}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  {/* From Stock Location (optional) */}
                  <Form.Field
                    control={form.control}
                    name="from_stock_location_id"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>From Stock Location</Form.Label>
                        <Form.Control>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <Select.Trigger>
                              <Select.Value placeholder="Select from location (optional)" />
                            </Select.Trigger>
                            <Select.Content>
                              {stock_locations.map((loc) => (
                                <Select.Item key={loc.id} value={loc.id}>
                                  {loc.name}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
                <div className="mt-4">
                  <Form.Field
                    control={form.control}
                    name="is_sample"
                    render={({ field: { value, onChange, ref } }) => (
                      <Form.Item>
                        <div className="flex items-center gap-x-2">
                          <Switch
                            id="is-sample-switch"
                            checked={value}
                            onCheckedChange={onChange}
                            ref={ref}
                          />
                          <Label htmlFor="is-sample-switch">Is this Inventory a sample?</Label>
                        </div>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
              </div>
            </ProgressTabs.Content>
            <ProgressTabs.Content value={Tab.ORDER_LINES} className="flex flex-col h-full">
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 overflow-y-auto p-8">
                  <div className="mb-6">
                    <Heading className="text-xl mb-4">Order Lines</Heading>
                    <Text size="small" className="text-ui-fg-subtle mb-4">
                      Add items to your inventory order. The total quantity and price will be calculated automatically.
                    </Text>
                  </div>
                  {/* Top search bar removed as requested */}
                  <div className="flex-1 min-h-0">
                    <InventoryOrderLinesGrid
                      form={form}
                      orderLines={fields}
                      inventoryItems={inventory_items}
                      defaultCurrencyCode="INR"
                      loading={isLoading}
                      onAddNewRow={() => append({ inventory_item_id: "", quantity: 0, price: 0 })}
                      onRemoveRow={remove}
                    />
                  </div>
                  <Text size="small" className="text-ui-fg-subtle mt-2">
                    Press Enter in the last row to add a new line.
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
            </ProgressTabs.Content>
          </RouteFocusModal.Body>
          <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
            <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
              <RouteFocusModal.Close asChild>
                <Button size="small" variant="secondary" className="w-full sm:w-auto">Cancel</Button>
              </RouteFocusModal.Close>
              {tab === Tab.ORDER_LINES ? (
                <>
                  <Button type="button" variant="secondary" size="small" onClick={onBack}>Back</Button>
                  <Button size="small" variant="primary" type="submit" isLoading={isPending}>Create</Button>
                </>
              ) : (
                <Button size="small" variant="primary" type="button" onClick={() => onNext(tab)}>Continue</Button>
              )}
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
    </KeyboundForm>
  </RouteFocusModal.Form>
  );
};
