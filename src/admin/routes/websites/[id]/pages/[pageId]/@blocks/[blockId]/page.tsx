import { EditWebsiteBlocks } from "../../../../../../../components/edits/edit-website-blocks";
import { useParams } from "react-router-dom";

const EditPageBlockModal = () => {
    const {id, pageId,blockId} = useParams();
  return (    
        <EditWebsiteBlocks websiteId={id!} pageId={pageId!} blockId={blockId!} /> 
  );
};

export default EditPageBlockModal;
