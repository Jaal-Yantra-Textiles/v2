
import { CreatePageComponent } from "../../../../components/creates/create-page";
import { useWebsite } from "../../../../hooks/api/websites";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";

export function CreatePageModal() {

  const websiteId = window.location.pathname.split("/")[3];
  const { website } = useWebsite(websiteId);

  return (
    <RouteFocusModal>
      <CreatePageComponent websiteId={websiteId} website={website} />
    </RouteFocusModal>
  );
}

export default CreatePageModal;
