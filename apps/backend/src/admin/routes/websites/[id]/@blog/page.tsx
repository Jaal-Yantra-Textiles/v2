import { CreateBlogComponent } from "../../../../components/creates/create-blog";
import { RouteFocusModal } from "../../../../components/modal/route-focus-modal";
import {useParams} from 'react-router-dom'

export function CreateBlogPageModal() {
  const {id} = useParams()
  return (
    <RouteFocusModal>
      <CreateBlogComponent websiteId={id!} />
    </RouteFocusModal>
  );
}

export default CreateBlogPageModal;

