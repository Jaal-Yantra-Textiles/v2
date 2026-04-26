import { Badge, Container, Heading, Select, toast, Tooltip } from "@medusajs/ui";
import { useUsers } from "../../hooks/api/users";
import { useBlocks, useUpdateBlock } from "../../hooks/api/blocks";
import type { AdminPage } from "../../hooks/api/pages";

interface PageAuthorSectionProps {
  page: AdminPage;
  websiteId: string;
}

export const PageAuthorSection = ({ page, websiteId }: PageAuthorSectionProps) => {
  const { users } = useUsers();
  const { blocks } = useBlocks(websiteId, page.id);
  const mainContentBlock = blocks?.find((b) => b.type === 'MainContent');
  const authors = (mainContentBlock?.content?.authors as string[] | undefined) || [];

  const { mutate: updateBlock } = useUpdateBlock(websiteId, page.id, mainContentBlock?.id || '');

  const handleAuthorChange = (selectedAuthors: string[]) => {
    if (!mainContentBlock) return;

    const newContent = {
      ...mainContentBlock.content,
      authors: selectedAuthors,
    };

    updateBlock(
      { content: newContent },
      {
        onSuccess: () => {
          toast.success("Authors updated successfully");
        },
        onError: (error: any) => {
          toast.error(error.message || "Failed to update authors");
        },
      }
    );
  };

  return (
    <Container className="p-0">
      <div className="px-6 py-4">
        <Heading level="h2">Authors</Heading>
      </div>
      <div className="px-6 py-4">
        <Select
          value=""
          onValueChange={(selectedId) => {
            const user = users?.find((u) => u.id === selectedId);
            if (user) {
              const authorName = `${user.first_name} ${user.last_name || ''}`.trim();
              if (!authors.includes(authorName)) {
                handleAuthorChange([...authors, authorName]);
              }
            }
          }}
        >
          <Select.Trigger>
            <Select.Value placeholder="Add an author" />
          </Select.Trigger>
          <Select.Content>
            {users?.map((user) => {
              const authorName = `${user.first_name} ${user.last_name || ''}`.trim();
              const isSelected = authors.includes(authorName);
              return (
                <Select.Item key={user.id} value={user.id} disabled={isSelected}>
                  {isSelected ? (
                    <Tooltip content="This author has already been added.">
                      <span>{authorName}</span>
                    </Tooltip>
                  ) : (
                    authorName
                  )}
                </Select.Item>
              );
            })}
          </Select.Content>
        </Select>
        <div className="flex flex-wrap gap-2 mt-4">
          {authors.map((author: string, index: number) => (
            <Badge
              key={index}
              className="cursor-pointer"
              onClick={() => {
                const newAuthors = authors.filter((_: string, i: number) => i !== index);
                handleAuthorChange(newAuthors);
              }}
            >
              {author}
            </Badge>
          ))}
        </div>
      </div>
    </Container>
  );
};
