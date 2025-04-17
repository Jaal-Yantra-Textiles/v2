import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button, DatePicker, Heading, Input, Text, ProgressTabs, ProgressStatus, Select, toast, Tooltip, CurrencyInput, DropdownMenu, IconButton } from "@medusajs/ui";
import { InformationCircleSolid, EllipsisHorizontal, Trash } from "@medusajs/icons";
import { useRouteModal } from "../modal/use-route-modal";
import { useCreateInventoryOrder } from "../../hooks/api/inventory-orders";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useState, useEffect } from "react";
import { useInventoryItems } from "../../hooks/api/raw-materials";

// Define a Zod schema for inventory order creation (scaffolded, update as per API contract)
export const inventoryOrderFormSchema = z.object({
  quantity: z.number().min(1, "Quantity must be at least 1"),
  total_price: z.number().min(0, "Total price must be positive"),
  order_date: z.date({ required_error: "Order date is required" }),
  expected_delivery_date: z.date({ required_error: "Expected delivery date is required" }),
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
      quantity: 1,
      total_price: 0,
      order_date: undefined,
      expected_delivery_date: undefined,
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
    onSuccess: () => {
      toast.success("Inventory order created successfully");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create inventory order");
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const payload = {
      quantity: data.quantity,
      total_price: data.total_price,
      order_date: data.order_date.toISOString(),
      expected_delivery_date: data.expected_delivery_date.toISOString(),
      status: "Pending",
      shipping_address: {},
      order_lines: orderLines
        .filter((l) => l.inventory_item_id)
        .map(({ inventory_item_id, quantity, price }) => ({ inventory_item_id, quantity, price })),
    };
    const res = await mutateAsync(payload);
    handleSuccess(`/inventory/orders/${res.inventoryOrder.id}`);
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
                  {/* Quantity */}
                  <Form.Field
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Quantity</Form.Label>
                        <Form.Control>
                          <Input
                            type="number"
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            placeholder="Quantity"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  {/* Total Price */}
                  <Form.Field
                    control={form.control}
                    name="total_price"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Total Price</Form.Label>
                        <Form.Control>
                          <CurrencyInput
                            symbol="$"
                            code="usd"
                            value={field.value}
                            onValueChange={(val) => field.onChange(Number(val))}
                            placeholder="Total Price"
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                  {/* Order Date */}
                  <Form.Field
                    control={form.control}
                    name="order_date"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label>Order Date</Form.Label>
                        <Form.Control>
                          <DatePicker
                            value={field.value}
                            onChange={field.onChange}
                          />
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
                          <DatePicker
                            value={field.value}
                            onChange={field.onChange}
                          />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
              </div>
            </ProgressTabs.Content>
            <ProgressTabs.Content value={Tab.ORDER_LINES} className="overflow-y-auto">
              <div className="overflow-x-auto p-8">
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
                        className={`border-b border-dashed group ${selectedRow === idx ? 'bg-blue-50' : ''}`}
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
