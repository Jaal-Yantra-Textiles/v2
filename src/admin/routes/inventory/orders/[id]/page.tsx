import { UIMatch, useParams , useLoaderData } from "react-router-dom";
import { useInventoryOrder } from "../../../../hooks/api/inventory-orders";
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton";
import { TwoColumnPage } from "../../../../components/pages/two-column-pages";
import InventoryOrderGeneralSection from "../../../../components/inventory-orders/inventory-order-general-section";
import InventoryOrderLinesSection from "../../../../components/inventory-orders/inventory-order-lines-section";
import InventoryOrderStockLocation from "../../../../components/inventory-orders/inventory-order-stock-location";
import { InventoryOrderTasksSection } from "../../../../components/inventory-orders/inventory-order-tasks-section";
import { inventoryOrderLoader } from "./loader";
import InventoryOrderIDSection from "../../../../components/inventory-orders/inventory-order-general-orderId";

const InventoryOrderDetailPage = () => {
  const intialData = useLoaderData() as Awaited<ReturnType<typeof inventoryOrderLoader>>
  const { id } = useParams();
  const { inventoryOrder, isLoading, isError, error } = useInventoryOrder(id!, {
    fields: ['orderlines.*', 'orderlines.inventory_items.*', 'stock_locations.*', 'stock_locations.address.*', '+tasks.*']
  }, {
    initialData: intialData
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
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
       <InventoryOrderLinesSection inventoryOrder={inventoryOrder} />
       <InventoryOrderTasksSection inventoryOrder={inventoryOrder}/>
       <InventoryOrderStockLocation inventoryOrder={inventoryOrder}/>
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return `${id}`;
  },
};

export default InventoryOrderDetailPage;
