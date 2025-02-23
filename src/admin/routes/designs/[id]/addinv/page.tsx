import { DesignInventoryTable } from "../../../../components/designs/design-inventory-table";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";
import {useParams} from 'react-router-dom'

const AddDesignInventoryPage = () => {
    const { id } = useParams()
  return (
    <RouteFocusModal>
      <RouteFocusModal.Header />
      <DesignInventoryTable designId={id!} />
    </RouteFocusModal>
  );
};

export default AddDesignInventoryPage;