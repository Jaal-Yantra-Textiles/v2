import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, DatePicker, Heading, Input, Text, ProgressTabs, ProgressStatus, Select, toast, Tooltip, CurrencyInput, DropdownMenu, IconButton, Switch, Label } from "@medusajs/ui";
import { InformationCircleSolid, EllipsisHorizontal, Trash } from "@medusajs/icons";
import { useRouteModal } from "../modal/use-route-modal";
import { useCreateInventoryOrder } from "../../hooks/api/inventory-orders";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useState, useEffect } from "react";
import { useInventoryItems } from "../../hooks/api/raw-materials";
import { useStockLocations } from "../../hooks/api/stock_location";

// Define a Zod schema for inventory order creation (scaffolded, update as per API contract)
export const inventoryOrderFormSchema = z.object({
  order_date: z.date({ required_error: "Order date is required" }),
  expected_delivery_date: z.date({ required_error: "Expected delivery date is required" }),
  stock_location_id: z.string().nonempty("Stock location is required"),
  is_sample: z.boolean().optional(),
});

type InventoryOrderFormData = z.infer<typeof inventoryOrderFormSchema>;

enum Tab {
  GENERAL = "general",
  ORDER_LINES = "order_lines",
}

type TabState = Record<Tab, ProgressStatus>;

export const CreateInventoryOrderComponent = () => {
  const form = useForm<InventoryOrderFormData>({
    defaultValues: {
      order_date: undefined,
      expected_delivery_date: undefined,
      stock_location_id: "",
      is_sample: false,
    },
    resolver: zodResolver(inventoryOrderFormSchema),
  });

  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress",
    [Tab.ORDER_LINES]: "not-started",
  });

  const onNext = async (currentTab: Tab) => {
    const valid = await form.trigger();
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

  const { inventory_items = [] } = useInventoryItems();
  const { stock_locations = [] } = useStockLocations();
  const [orderLines, setOrderLines] = useState<{ inventory_item_id: string; quantity: number; price: number }[]>([
    { inventory_item_id: "", quantity: 0, price: 0 },
  ]);
  const handleLineChange = (index: number, field: "inventory_item_id" | "quantity" | "price", value: any) => {
    setOrderLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line))
    );
  };
  const addEmptyLine = () => {
    setOrderLines((prev) => [...prev, { inventory_item_id: "", quantity: 0, price: 0 }]);
  };
  const removeLine = (index: number) => {
    setOrderLines((prev) => prev.filter((_, i) => i !== index));
  };

  const { handleSuccess } = useRouteModal();
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

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
    const validLines = orderLines.filter(line => line.inventory_item_id);
    const totalQuantity = validLines.reduce((sum, line) => sum + line.quantity, 0);
    const totalPrice = validLines.reduce((sum, line) => sum + line.price * line.quantity, 0);
    return { totalQuantity, totalPrice };
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    const { totalQuantity, totalPrice } = calculateTotals();
    
    const payload = {
      quantity: totalQuantity,
      total_price: totalPrice,
      order_date: data.order_date.toISOString(),
      expected_delivery_date: data.expected_delivery_date.toISOString(),
      stock_location_id: data.stock_location_id,
      status: "Pending",
      shipping_address: {},
      is_sample: data.is_sample,
      order_lines: orderLines
        .filter((l) => l.inventory_item_id)
        .map(({ inventory_item_id, quantity, price }) => ({ inventory_item_id, quantity, price })),
    };
    await mutateAsync(payload);
    // Navigation is now handled in the onSuccess callback
  });

  return (
    <ProgressTabs
      value={tab}
      onValueChange={async (value) => {
        const valid = await form.trigger();
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

      <RouteFocusModal.Form form={form}>
        <KeyboundForm onSubmit={handleSubmit} className="flex h-full flex-col overflow-hidden">
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
                  {/* Stock Location */}
                  <Form.Field
                    control={form.control}
                    name="stock_location_id"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Stock Location</Form.Label>
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
            <ProgressTabs.Content value={Tab.ORDER_LINES} className="overflow-y-auto">
              <div className="overflow-x-auto p-8">
                <div className="mb-6">
                  <Heading className="text-xl mb-4">Order Lines</Heading>
                  <Text size="small" className="text-ui-fg-subtle mb-4">
                    Add items to your inventory order. The total quantity and price will be calculated automatically.
                  </Text>
                </div>
                <table className="w-full border-collapse border border-dashed">
                  <thead className="border-b border-dashed">
                    <tr className="border-b border-dashed">
                      <th className="text-left p-2 font-semibold">Item</th>
                      <th className="text-left p-2 font-semibold">Quantity</th>
                      <th className="text-left p-2 font-semibold">Price</th>
                      <th className="p-2 border-dashed border" />
                    </tr>
                  </thead>
                  <tbody>
                    {orderLines.map((line, idx) => (
                      <tr
                        key={idx}
                        id={`order-line-row-${idx}`}
                        tabIndex={0}
                        className={`border-b border-dashed group ${selectedRow === idx ? '' : ''}`}
                        onFocus={() => setSelectedRow(idx)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const nextIdx = idx + 1 < orderLines.length ? idx + 1 : idx;
                            setSelectedRow(nextIdx);
                            document.getElementById(`order-line-row-${nextIdx}`)?.focus();
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prevIdx = idx - 1 >= 0 ? idx - 1 : idx;
                            setSelectedRow(prevIdx);
                            document.getElementById(`order-line-row-${prevIdx}`)?.focus();
                          }
                        }}
                      >
                        <td className="p-2 border-dashed border font-medium">
                          <Select
                            value={line.inventory_item_id}
                            onValueChange={(v) => handleLineChange(idx, "inventory_item_id", v)}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select item" />
                            </Select.Trigger>
                            <Select.Content>
                              {inventory_items.map((item) => {
                                const disabled = orderLines.some((l, i2) => l.inventory_item_id === item.id && i2 !== idx);
                                return (
                                  <Select.Item key={item.id} value={item.id} disabled={disabled}>
                                    <div className="flex justify-between items-center">
                                      <span>{item.title || item.sku}</span>
                                      {disabled && (
                                        <Tooltip content="Already selected">
                                          <InformationCircleSolid className="h-4 w-4 text-ui-fg-subtle" />
                                        </Tooltip>
                                      )}
                                    </div>
                                  </Select.Item>
                                );
                              })}
                            </Select.Content>
                          </Select>
                        </td>
                        <td className="p-2 border-dashed border font-medium">
                          <Input
                            type="number"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, "quantity", Number(e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && idx === orderLines.length - 1) {
                                e.preventDefault();
                                addEmptyLine();
                              }
                            }}
                          />
                        </td>
                        <td className="p-2 border-dashed border font-medium">
                          <CurrencyInput
                            symbol="$"
                            code="usd"
                            value={line.price}
                            onValueChange={(val) => handleLineChange(idx, "price", Number(val))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && idx === orderLines.length - 1) {
                                e.preventDefault();
                                addEmptyLine();
                              }
                            }}
                          />
                        </td>
                        <td className="p-2 border-dashed border text-center">
                          <DropdownMenu>
                            <DropdownMenu.Trigger asChild>
                              <IconButton
                                size="small"
                                className={`opacity-0 group-hover:opacity-100 ${selectedRow === idx ? 'opacity-100' : ''}`}
                              >
                                <EllipsisHorizontal />
                              </IconButton>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content>
                              <DropdownMenu.Item className="gap-x-2" onClick={() => removeLine(idx)}>
                                <Trash className="text-ui-fg-subtle" />
                                Delete
                              </DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Text size="small" className="text-ui-fg-subtle mt-2">
                  Press Enter in the last row to add a new line.
                </Text>
                
                {/* Display calculated totals */}
                {orderLines.some(line => line.inventory_item_id) && (
                  <div className="mt-6 border-t border-dashed pt-4">
                    <div className="flex justify-between items-center mb-2">
                      <Text weight="plus">Total Order Quantity:</Text>
                      <Text weight="plus">{calculateTotals().totalQuantity}</Text>
                    </div>
                    <div className="flex justify-between items-center">
                      <Text weight="plus">Total Order Price:</Text>
                      <Text weight="plus">${calculateTotals().totalPrice.toFixed(2)}</Text>
                    </div>
                  </div>
                )}
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
        </KeyboundForm>
      </RouteFocusModal.Form>
    </ProgressTabs>
  );
};
