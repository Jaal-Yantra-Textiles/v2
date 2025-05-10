import { EditWebsiteBlocks } from "../../../../../../../components/edits/edit-website-blocks";
import { RouteFocusModal } from "../../../../../../../components/modal/route-focus-modal";
import { useParams } from "react-router-dom";
import { StandaloneModal } from "../../../../../../../components/modal/standalone-modal";
import { RouteNonFocusModal } from "../../../../../../../components/modal/route-non-focus";

const EditPageBlockModal = () => {
    const {id, pageId,blockId} = useParams();
  return (
    
        
        <EditWebsiteBlocks websiteId={id!} pageId={pageId!} blockId={blockId!} /> 
       
   
  );
};

export default EditPageBlockModal;
