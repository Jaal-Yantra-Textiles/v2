import { useParams } from "react-router-dom";
import { Heading } from "@medusajs/ui";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { CreateInventoryOrderFeedbackForm } from "../../../../../components/creates/create-inventory-order-feedback";

export default function AddInventoryOrderFeedbackPage() {
  const { id } = useParams();

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Add Order Feedback</Heading>
      </RouteDrawer.Header>
      <CreateInventoryOrderFeedbackForm orderId={id!} />
    </RouteDrawer>
  );
}
