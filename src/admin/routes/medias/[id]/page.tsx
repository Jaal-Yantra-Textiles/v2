import { UIMatch, useLoaderData, useParams } from "react-router-dom";
import { TwoColumnPageSkeleton } from "../../../components/table/skeleton";
import { TwoColumnPage } from "../../../components/pages/two-column-pages";
import { mediaFolderLoader } from "./loader";
import { useMediaFolderDetail } from "../../../hooks/api/media-folders/use-media-folder-detail";
import { FolderGeneralSection } from "../../../components/media/folders/folder-general-section";
import { FolderRelationshipsSection } from "../../../components/media/folders/folder-relationships-section";
import { FolderMetadataSection } from "../../../components/media/folders/folder-metadata-section";
import { FolderMediaSection } from "../../../components/media/folders/folder-media-section";

const MediaFolderDetailPage = () => {
  const { id } = useParams();

  const initialData = useLoaderData() as any;

  const { folder, isLoading, isError, error } = useMediaFolderDetail(
    id!,
    undefined,
    {
      staleTime: 0,
      refetchOnMount: true,
      initialData: initialData,
    }
  );

  if (isLoading) {
    return <TwoColumnPageSkeleton />;
  }

  if (isError) {
    throw error;
  }

  if (!folder) {
    return <div>Folder not found</div>;
  }

  return (
    <TwoColumnPage
      showJSON
      showMetadata
      hasOutlet={true}
      data={folder}
    >
      <TwoColumnPage.Main>
        <FolderGeneralSection folder={folder} />
        <FolderRelationshipsSection folder={folder} />
        <FolderMediaSection folder={folder} />
      </TwoColumnPage.Main>
      <TwoColumnPage.Sidebar>
        <FolderMetadataSection folder={folder} />
      </TwoColumnPage.Sidebar>
    </TwoColumnPage>
  );
};

export default MediaFolderDetailPage;

export const loader = mediaFolderLoader;

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    return `${match.params.id}`;
  },
};
