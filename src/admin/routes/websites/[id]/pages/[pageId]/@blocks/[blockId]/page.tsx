import { EditWebsiteBlocks } from "../../../../../../../components/edits/edit-website-blocks";
import { RouteFocusModal } from "../../../../../../../components/modal/route-focus-modal";
import { useParams } from "react-router-dom";

const EditPageBlockModal = () => {
    const {id, pageId,blockId} = useParams();
  return (
    <RouteFocusModal>
        <RouteFocusModal.Title/>
        <EditWebsiteBlocks websiteId={id!} pageId={pageId!} blockId={blockId!} />      
    </RouteFocusModal>
  );
};

export default EditPageBlockModal;
