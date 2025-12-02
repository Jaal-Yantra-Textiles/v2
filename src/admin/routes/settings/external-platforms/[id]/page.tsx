import { UIMatch, useParams, useLoaderData, LoaderFunctionArgs } from "react-router-dom";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";
import { useSocialPlatform } from "../../../../hooks/api/social-platforms";
import { SocialPlatformGeneralSection } from "../../../../components/social-platforms/social-platform-general-section"; // Adjusted path
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton"; // Assuming this path
import { useTranslation } from "react-i18next";
import { socialPlatformLoader } from "./loader";

export default function SocialPlatformDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const initialData = useLoaderData() as Awaited<ReturnType<typeof socialPlatformLoader>>;
  
  const { socialPlatform: platform, isLoading, isError } = useSocialPlatform(id!, {
    initialData
  }); // Renamed for clarity

  if (isLoading || (!platform && !isError)) { // Show skeleton if loading or if platform is not yet available but no error
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />;
  }

  if (isError || !platform) { // Show error if fetching failed or platform is definitively not found
     // It might be good to have a more specific error component or message here
    return <div>{t("socialPlatform.errors.loading", "Error loading social platform details.")}</div>;
  }

  return (
    <SingleColumnPage 
    showJSON 
    showMetadata 
    data={platform} 
    hasOutlet>
        <SocialPlatformGeneralSection platform={platform} />
        {/* Future sections can be added here */}
    </SingleColumnPage>
  );
}

export async function loader({ params }: LoaderFunctionArgs) {
  return socialPlatformLoader({ params });
}

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params; // Simplified to use ID
    return id || "Detail";
  },
   // If you intend to have an edit page as a sub-route (e.g., /settings/external-platforms/[id]/edit)
   // you might want to ensure `hasOutlet={true}` on SingleColumnPage.
   // And the edit action in SocialPlatformGeneralSection would navigate to this sub-route.
};
