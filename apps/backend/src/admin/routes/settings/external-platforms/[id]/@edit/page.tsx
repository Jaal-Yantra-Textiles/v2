import { useParams, useLoaderData } from "react-router-dom";
import { useSocialPlatform } from "../../../../../hooks/api/social-platforms";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditSocialPlatformForm } from "../../../../../components/edits/edit-social-platform";
import { socialPlatformLoader } from "../loader";

export default function EditExternalPlatformPage() {
  const { id } = useParams();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof socialPlatformLoader>>;

  const { socialPlatform, isLoading } = useSocialPlatform(id!, {
    initialData
  });

  if (isLoading || !socialPlatform) {
    return null; // Add loading state if needed
  }

  // The header lives in EditSocialPlatformForm's RouteDrawer.Header (it
  // carries the category-specific title). Rendering another header here
  // stacked two headers in the drawer.
  return (
    <RouteDrawer>
      <EditSocialPlatformForm socialPlatform={socialPlatform} />
    </RouteDrawer>
  );
}
