import { CreateWebsiteBlocks } from "../../../../../../../components/creates/create-website-blocks";
import { RouteFocusModal } from "../../../../../../../components/modal/route-focus-modal";
import { useParams } from "react-router-dom";

const CreateWebsiteModal = () => {
    const { id, pageId } = useParams();
  return (
    <RouteFocusModal>
      <CreateWebsiteBlocks websiteId={id!} pageId={pageId!}/>
    </RouteFocusModal>
  );
};

export default CreateWebsiteModal;
