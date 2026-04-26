import { useBlock } from "../../hooks/api/blocks";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Skeleton } from "../table/skeleton";

import { EditBlogBlock } from "./edit-blog-block";
import { EditRegularBlock } from "./edit-regular-block";

interface EditWebsiteBlocksProps {
  websiteId: string;
  pageId: string;
  blockId: string;
}

export const EditWebsiteBlocks = ({ websiteId, pageId, blockId }: EditWebsiteBlocksProps) => {
  const { block, isLoading } = useBlock(websiteId, pageId, blockId);

  if (!websiteId || !pageId || !blockId) return null;
  if (isLoading) return <Skeleton />
  if (!block) return <div>Block not found</div>;

  const isBlogContent = block.type === "MainContent" && block.name === "Main Blog";

  return isBlogContent ? (
    <EditBlogBlock
      websiteId={websiteId}
      pageId={pageId}
      blockId={blockId}
      block={block}
    />
  ) : (
    <RouteFocusModal>
    <EditRegularBlock
      websiteId={websiteId}
      pageId={pageId}
      blockId={blockId}
      block={block}
    />
    </RouteFocusModal>
  );
};
    