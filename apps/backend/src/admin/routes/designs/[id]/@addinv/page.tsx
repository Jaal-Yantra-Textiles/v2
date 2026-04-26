import { DesignInventoryTable } from "../../../../components/designs/design-inventory-table";
import {useParams} from 'react-router-dom'

const AddDesignInventoryPage = () => {
    const { id } = useParams()
  return (
     <DesignInventoryTable designId={id!} />
   
  );
};

export default AddDesignInventoryPage;