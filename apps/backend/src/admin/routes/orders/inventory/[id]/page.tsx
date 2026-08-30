import { UIMatch, useParams , useLoaderData, LoaderFunctionArgs } from "react-router-dom";
import { AdminInventoryOrderResponse, useInventoryOrder } from "../../../../hooks/api/inventory-orders";
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton";
import { TwoColumnPage } from "../../../../components/pages/two-column-pages";
import InventoryOrderGeneralSection from "../../../../components/inventory-orders/inventory-order-general-section";
import InventoryOrderLinesSection from "../../../../components/inventory-orders/inventory-order-lines-section";
import InventoryOrderStockLocation from "../../../../components/inventory-orders/inventory-order-stock-location";
import { InventoryOrderTasksSection } from "../../../../components/inventory-orders/inventory-order-tasks-section";
import { InventoryOrderPaymentsSection } from "../../../../components/inventory-orders/inventory-order-payments-section";
import { InventoryOrderShipmentsSection } from "../../../../components/inventory-orders/inventory-order-shipments-section";
import { InventoryOrderFeedbacksSection } from "../../../../components/inventory-orders/inventory-order-feedbacks-section";
import { inventoryOrderLoader } from "./loader";
import { INVENTORY_ORDER_DETAIL_FIELDS } from "./constants";
import InventoryOrderIDSection from "../../../../components/inventory-orders/inventory-order-general-orderId";

const InventoryOrderDetailPage = () => {
  const initialData = useLoaderData() as Awaited<AdminInventoryOrderResponse>
  const { id } = useParams();
  // ⚠️ This list used to be an inline COPY of INVENTORY_ORDER_DETAIL_FIELDS, and
  // the two drifted: adding the product/variant fields to the constant (#1662)
  // changed the loader's prefetch but not the query this page actually renders
  // from, so the fix looked applied and the line still showed a bare variant
  // title. One home now; the payment fields this page needs are appended.
  const { inventoryOrder, isLoading, isError, error } = useInventoryOrder(id!, {
    fields: [
      ...INVENTORY_ORDER_DETAIL_FIELDS.split(',').map((f) => f.trim()),
      '+internal_payments.*',
      '+internal_payments.attachments.*',
    ]
  }, {
    initialData
  });
  
  // Show loading skeleton while data is being fetched
  if (isLoading || !inventoryOrder) {
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={3} showJSON showMetadata />;
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Render main content when data is available
  return (
    
    <TwoColumnPage data={inventoryOrder} hasOutlet={true} showJSON showMetadata={true} >
      <TwoColumnPage.Main>
      <InventoryOrderIDSection inventoryOrder={inventoryOrder} />
      <InventoryOrderGeneralSection inventoryOrder={inventoryOrder} />
      <InventoryOrderFeedbacksSection orderId={inventoryOrder.id} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
       <InventoryOrderLinesSection inventoryOrder={inventoryOrder} />
       <InventoryOrderTasksSection inventoryOrder={inventoryOrder}/>
       <InventoryOrderStockLocation inventoryOrder={inventoryOrder}/>
       <InventoryOrderShipmentsSection inventoryOrder={inventoryOrder}/>
       <InventoryOrderPaymentsSection inventoryOrder={inventoryOrder}/>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

export async function loader({ params }: LoaderFunctionArgs) {
  return inventoryOrderLoader({ params });
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};

export default InventoryOrderDetailPage;
