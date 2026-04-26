import { useParams, useLoaderData } from "react-router-dom";
import { useSocialPlatform } from "../../../../../hooks/api/social-platforms";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { EditSocialPlatformForm } from "../../../../../components/edits/edit-social-platform";
import { socialPlatformLoader } from "../loader";

export default function EditExternalPlatformPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof socialPlatformLoader>>;
  
  const { socialPlatform, isLoading } = useSocialPlatform(id!, {
    initialData
  });

  const ready = !!socialPlatform;

  if (isLoading || !socialPlatform) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("externalPlatform.edit.header", "Edit External Platform")}</Heading>
      </RouteDrawer.Header>
      {ready && <EditSocialPlatformForm socialPlatform={socialPlatform} />}
    </RouteDrawer>
  );
}
