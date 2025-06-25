import { UIMatch, useParams , useLoaderData } from "react-router-dom";
import { useInventoryOrder } from "../../../../hooks/api/inventory-orders";
import { TwoColumnPageSkeleton } from "../../../../components/table/skeleton";
import { TwoColumnPage } from "../../../../components/pages/two-column-pages";
import InventoryOrderGeneralSection from "../../../../components/inventory-orders/inventory-order-general-section";
import InventoryOrderLinesSection from "../../../../components/inventory-orders/inventory-order-lines-section";
import InventoryOrderStockLocation from "../../../../components/inventory-orders/inventory-order-stock-location";
<<<<<<< HEAD
import { InventoryOrderTasksSection } from "../../../../components/inventory-orders/inventory-order-tasks-section";
=======
>>>>>>> 2949d584e28d2f31b51d3f2daae13f6a58c082c1
import { inventoryOrderLoader } from "./loader";

const InventoryOrderDetailPage = () => {
  const intialData = useLoaderData() as Awaited<ReturnType<typeof inventoryOrderLoader>>
  const { id } = useParams();
  const { inventoryOrder, isLoading, isError, error } = useInventoryOrder(id!, {
<<<<<<< HEAD
    fields: ['orderlines.*', 'orderlines.inventory_items.*', 'stock_locations.*', 'stock_locations.address.*', '+tasks.*']
=======
    fields: ['orderlines.*', 'orderlines.inventory_items.*', 'stock_locations.*', 'stock_locations.address.*']
>>>>>>> 2949d584e28d2f31b51d3f2daae13f6a58c082c1
  }, {
    initialData: intialData
  });
  // Show loading skeleton while data is being fetched
  if (isLoading || !inventoryOrder) {
<<<<<<< HEAD
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={3} showJSON showMetadata />;
=======
    return <TwoColumnPageSkeleton mainSections={1} sidebarSections={2} showJSON showMetadata />;
>>>>>>> 2949d584e28d2f31b51d3f2daae13f6a58c082c1
  }

  // Handle error state
  if (isError) {
    throw error;
  }

  // Render main content when data is available
  return (
    
    <TwoColumnPage data={inventoryOrder} hasOutlet={true} showJSON showMetadata={true} >
      <TwoColumnPage.Main>
      <InventoryOrderGeneralSection inventoryOrder={inventoryOrder} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
       <InventoryOrderLinesSection inventoryOrder={inventoryOrder} />
<<<<<<< HEAD
       <InventoryOrderTasksSection inventoryOrder={inventoryOrder}/>
=======
>>>>>>> 2949d584e28d2f31b51d3f2daae13f6a58c082c1
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
