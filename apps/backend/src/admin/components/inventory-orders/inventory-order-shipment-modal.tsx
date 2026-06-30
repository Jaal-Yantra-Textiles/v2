import { useState } from "react";
import { Drawer, Button, Input, Label, Select, Text, toast } from "@medusajs/ui";
import {
  AdminInventoryOrder,
  useCreateInventoryOrderShipment,
} from "../../hooks/api/inventory-orders";
import { useStockLocations } from "../../hooks/api/stock_location";

type Props = {
  inventoryOrder: AdminInventoryOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * #790 slice 3 — admin "Create shipment" form. All fields are optional: the
 * shipment workflow defaults the weight and resolves a registered carrier pickup
 * when none is given, so the simplest path is to just submit. Surfaces the AWB on
 * success and the workflow's actionable message on failure.
 */
export const InventoryOrderShipmentModal = ({ inventoryOrder, open, onOpenChange }: Props) => {
  // Default the pickup ("ship from") to the order's own from-location when one
  // is assigned — a shipment is created per order, so the location the goods
  // leave from is the natural default; the user can still pick another.
  const orderFromLocationId =
    (inventoryOrder as any).from_stock_location?.id ?? "";
  const [pickup, setPickup] = useState(orderFromLocationId);
  const [weight, setWeight] = useState("");
  const [length, setLength] = useState("");
  const [breadth, setBreadth] = useState("");
  const [height, setHeight] = useState("");
  const [courier, setCourier] = useState("");

  const { mutateAsync, isPending } = useCreateInventoryOrderShipment(inventoryOrder.id);
  const { stock_locations = [] } = useStockLocations({ limit: 100 });

  const handleSubmit = async () => {
    const dims =
      length || breadth || height
        ? {
            ...(length ? { length: Number(length) } : {}),
            ...(breadth ? { breadth: Number(breadth) } : {}),
            ...(height ? { height: Number(height) } : {}),
          }
        : undefined;

    await mutateAsync(
      {
        ...(pickup ? { pickup_stock_location_id: pickup } : {}),
        ...(weight ? { weight_grams: Number(weight) } : {}),
        ...(dims ? { dimensions_cm: dims } : {}),
        ...(courier ? { preferred_courier_id: courier } : {}),
      },
      {
        onSuccess: (data) => {
          const awb = data?.shipment?.awb || data?.shipment?.tracking_number;
          toast.success(awb ? `Shipment created — AWB ${awb}` : "Shipment created");
          onOpenChange(false);
        },
        onError: (error: any) => {
          toast.error(error?.message || "Failed to create shipment");
        },
      },
    );
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Create shipment</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body className="flex flex-col gap-4 overflow-auto">
          <Text size="small" className="text-ui-fg-subtle">
            Generate a carrier shipment (AWB + label) for this order. All fields are optional —
            leave them blank to use the order's defaults and a registered pickup.
          </Text>
          <div className="flex flex-col gap-1">
            <Label size="small" htmlFor="pickup">Ship from (pickup location)</Label>
            <Select value={pickup} onValueChange={setPickup}>
              <Select.Trigger id="pickup">
                <Select.Value placeholder="Use registered carrier pickup (optional)" />
              </Select.Trigger>
              <Select.Content>
                {stock_locations.map((loc) => (
                  <Select.Item key={loc.id} value={loc.id}>
                    {loc.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label size="small" htmlFor="weight">Weight (grams)</Label>
            <Input id="weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="500" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label size="small" htmlFor="length">Length (cm)</Label>
              <Input id="length" type="number" value={length} onChange={(e) => setLength(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label size="small" htmlFor="breadth">Breadth (cm)</Label>
              <Input id="breadth" type="number" value={breadth} onChange={(e) => setBreadth(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label size="small" htmlFor="height">Height (cm)</Label>
              <Input id="height" type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label size="small" htmlFor="courier">Preferred courier ID</Label>
            <Input id="courier" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="(optional)" />
          </div>
        </Drawer.Body>
        <Drawer.Footer>
          <Drawer.Close asChild>
            <Button variant="secondary" size="small">Cancel</Button>
          </Drawer.Close>
          <Button size="small" onClick={handleSubmit} isLoading={isPending}>
            Create shipment
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer>
  );
};

export default InventoryOrderShipmentModal;
