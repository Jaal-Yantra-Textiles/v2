import {
  Badge,
  Button,
  CommandBar,
  Container,
  Heading,
  Input,
  Text,
  Tooltip,
  toast,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { PencilSquare, XMarkMini } from "@medusajs/icons"
import { ActionMenu } from "../common/action-menu"
import { AdminPerson, Tag } from "../../hooks/api/personandtype"
import {
  useAddTagsToPerson,
  useDeletePersonTag,
  usePersonTags,
} from "../../hooks/api/person-tags"
import { useState, KeyboardEvent, useEffect, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { PERSON_RESOURCE_META } from "../../hooks/api/person-resource-meta"
import { personsQueryKeys } from "../../hooks/api/persons"

interface PersonTagsComponentProps {
  personId: string
  initialTags?: Tag[]
}

export const PersonTagsComponent = ({
  personId,
  initialTags,
}: PersonTagsComponentProps) => {
  const { t } = useTranslation()
  const [tagInput, setTagInput] = useState("")
  const [pendingTags, setPendingTags] = useState<string[]>([])
  const [tagsSelected, setTagsSelected] = useState(false)
  const queryClient = useQueryClient()
  const tagsListQueryKey = useMemo(
    () =>
      [
        "persons",
        "resources",
        PERSON_RESOURCE_META.tags.pathSegment,
        personId,
        "list",
        { query: {} },
      ] as const,
    [personId],
  )

  useEffect(() => {
    if (initialTags === undefined) {
      return
    }

    queryClient.setQueryData(tagsListQueryKey, (prev: Record<string, any> | undefined) => ({
      ...(prev ?? {}),
      [PERSON_RESOURCE_META.tags.listKey]: initialTags,
      count: initialTags.length,
    }))
  }, [initialTags, queryClient, tagsListQueryKey])
  const { tags = [] } = usePersonTags(
    personId,
    undefined,
    initialTags !== undefined
      ? {
          initialData: {
            [PERSON_RESOURCE_META.tags.listKey]: initialTags,
            count: initialTags.length,
          },
        }
      : undefined,
  )

  const addTags = useAddTagsToPerson(personId)
  const deleteTag = useDeletePersonTag(personId)
  


  // Function to get tag display value from the JSON structure
  const getTagDisplayValue = (tag: Tag) => {
    if (!tag || !tag.name) return "";
    
    // Handle array format from API response
    if (Array.isArray(tag.name)) {
      return tag.name.join(', ');
    }
    // Handle string format
    else if (typeof tag.name === 'string') {
      return tag.name;
    }
    // Handle object format
    else if (typeof tag.name === 'object' && tag.name !== null) {
      return tag.name.value || tag.name.name || tag.name.label || JSON.stringify(tag.name);
    }
    
    // Fallback to stringifying the JSON
    return JSON.stringify(tag.name);
  };

  // Function to get a color for a tag based on its name
  const getTagColor = (tag: Tag) => {
    const colors = ["green", "blue", "orange", "purple", "red", "grey"] as const;
    
    // Simple hash function to consistently assign colors based on tag id
    const hash = tag.id?.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  // Focus the tag input and add current tag if any
  const handleAddTag = () => {
    const inputElement = document.getElementById("tag-input") as HTMLInputElement
    if (inputElement) {
      if (tagInput.trim()) {
        // If there's text in the input, add it as a tag
        handleAddPendingTag();
      }
      inputElement.focus();
    }
  };

  // Handle editing tags - focuses the input and shows command bar if there are pending tags
  const handleEditTags = () => {
    if (pendingTags.length > 0) {
      setTagsSelected(true);
    }
    document.getElementById('tag-input')?.focus();
  };
  
  // Handle tag input change
  const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTagInput(e.target.value);
  };
  

  
  // Handle key press in tag input
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    
    // If Enter is pressed, add the tag
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      // Only add to pending tags, don't submit yet
      const tagValue = tagInput.trim();
      if (tagValue) {
        setPendingTags([...pendingTags, tagValue]);
        setTagInput('');
        setTagsSelected(true);
      }
    }
    // If comma is pressed, add the tag and allow for more
    else if (e.key === "," && tagInput.trim()) {
      e.preventDefault();
      const tagValue = tagInput.replace(/,/g, '').trim();
      if (tagValue) {
        setPendingTags([...pendingTags, tagValue]);
        setTagInput('');
        setTagsSelected(true);
      }
    }
    // If Tab is pressed with content, add the tag
    else if (e.key === "Tab" && tagInput.trim()) {
      // Only add to pending tags, don't submit yet
      const tagValue = tagInput.trim();
      if (tagValue) {
        setPendingTags([...pendingTags, tagValue]);
        setTagInput('');
        setTagsSelected(true);
      }
      // Don't prevent default to allow focus to move naturally
    }
  };
  
  // Submit pending tags and current input if any
  // This is called by handleAddTag
  const handleAddPendingTag = () => {
    if (tagInput.trim()) {
      // Add current input to pending tags
      // Split by commas if present to handle multiple tags
      const tagValues = tagInput.trim().split(/[,\s]+/).filter(t => t.trim().length > 0);
      setPendingTags([...pendingTags, ...tagValues]);
      setTagInput('');
      setTagsSelected(true);
    } else if (pendingTags.length > 0) {
      // Submit pending tags
      submitTags();
    }
  };
  
  // Submit all pending tags
  const submitTags = async () => {
    if (pendingTags.length > 0) {
      try {
        // Ensure we're sending a valid payload with unique tags
        const uniqueTags = [...new Set(pendingTags)];
        await addTags.mutateAsync({ name: uniqueTags })
        toast.success('Tags added successfully');
        setPendingTags([]);
        setTagsSelected(false);
        // No need to refresh the page - React Query will handle cache invalidation
      } catch (error: any) {
        console.error("Error adding tags:", error);
        toast.error(error?.message || 'Failed to add tags');
      }
    }
  };
  
  // Clear all pending tags
  const clearTags = () => {
    setPendingTags([]);
    setTagsSelected(false);
  };
  
  // Remove a pending tag
  const removePendingTag = (index: number) => {
    const newPendingTags = [...pendingTags];
    newPendingTags.splice(index, 1);
    setPendingTags(newPendingTags);
  };
  
  const removeTagFromCaches = (tagId: string) => {
    queryClient.setQueryData(tagsListQueryKey, (prev: Record<string, any> | undefined) => {
      if (!prev) {
        return prev
      }

      const currentTags = (prev[PERSON_RESOURCE_META.tags.listKey] as Tag[] | undefined) ?? []
      const nextTags = currentTags.filter((tag) => tag.id !== tagId)

      return {
        ...prev,
        [PERSON_RESOURCE_META.tags.listKey]: nextTags,
        count: nextTags.length,
      }
    })

    queryClient.setQueriesData(
      { queryKey: personsQueryKeys.detail(personId), exact: false },
      (old: { person?: AdminPerson } | undefined) => {
        if (!old?.person?.tags) {
          return old
        }

        return {
          ...old,
          person: {
            ...old.person,
            tags: old.person.tags.filter((tag) => tag.id !== tagId),
          },
        }
      },
    )
  }

  // Handle deleting a tag
  const handleDeleteTag = async (tagId: string) => {
    try {
      await deleteTag.mutateAsync(tagId)
      toast.success('Tag deleted successfully');
      removeTagFromCaches(tagId)
    } catch (error: any) {
      console.error("Error deleting tag:", error);
      toast.error(error?.message || 'Failed to delete tag');
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="px-4 md:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-y-2">
          <div>
            <Heading level="h2">{t("Tags")}</Heading>
            <Text className="text-ui-fg-subtle mt-1" size="small">
              Tags associated with this person
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            <ActionMenu
              groups={[
                {
                  actions: [
                    {
                      label: t("actions.edit"),
                      icon: <PencilSquare />,
                      onClick: handleEditTags,
                    },
                  ],
                },
              ]}
            />
          </div>
        </div>
        
        {/* Command Bar for tag actions */}
        <CommandBar open={tagsSelected}>
          <CommandBar.Bar>
            <CommandBar.Value>
              {pendingTags.length} tag{pendingTags.length !== 1 ? "s" : ""} selected
            </CommandBar.Value>
            <CommandBar.Seperator />
            <CommandBar.Command
              action={submitTags}
              label="Save"
              shortcut="s"
            />
            <CommandBar.Seperator />
            <CommandBar.Command
              action={clearTags}
              label="Clear"
              shortcut="c"
            />
          </CommandBar.Bar>
        </CommandBar>
        
        {/* Full-width tag input section */}
        <div className="w-full p-0">
          <div className="w-full mb-4 relative">
            <Input
              id="tag-input"
              placeholder="Type tag and press Enter or comma to add"
              value={tagInput}
              onChange={handleTagInputChange}
              onKeyDown={handleKeyPress}
              className="w-full mb-2"
              autoComplete="off"
            />

          </div>

        </div>
      </div>
      <div className="p-3">
        <div className="flex flex-wrap gap-2">
          {/* Pending tags */}
          {pendingTags.map((tag, index) => (
            <div key={`pending-${index}`} className="relative group">
              <Button
                variant="transparent"
                size="small"
                className="absolute -top-2 -right-2 p-0 h-4 w-4 bg-ui-bg-base rounded-full z-10 opacity-0 sm:group-hover:opacity-100 active:opacity-100 transition-opacity"
                onClick={() => removePendingTag(index)}
              >
                <XMarkMini className="w-3 h-3" />
              </Button>
              <Badge color="blue">
                {tag}
              </Badge>
            </div>
          ))}
          
          {/* Existing tags */}
          {tags
            ?.filter((tag) => tag && tag.id)
            .map((tag) => {
              const displayValue = getTagDisplayValue(tag)
              if (!displayValue) {
                return null
              }

              return (
                <div key={tag.id} className="relative group">
                  <Button
                    variant="transparent"
                    size="small"
                    className="absolute -top-2 -right-2 p-0 h-4 w-4 bg-ui-bg-base rounded-full z-10 opacity-0 sm:group-hover:opacity-100 active:opacity-100 transition-opacity"
                    onClick={() => handleDeleteTag(tag.id)}
                  >
                    <XMarkMini className="w-3 h-3" />
                  </Button>
                  <Tooltip content={displayValue}>
                    <Badge color={getTagColor(tag)}>{displayValue}</Badge>
                  </Tooltip>
                </div>
              )
            })}
          
          {/* Empty state */}
          {pendingTags.length === 0 && (!tags || tags.length === 0) && (
            <div className="flex flex-col sm:flex-row items-center justify-center py-4 w-full gap-y-2">
              <Text className="text-ui-fg-subtle">No tags found</Text>
              <Button
                variant="secondary"
                size="small"
                className="sm:ml-2 w-full sm:w-auto"
                onClick={handleAddTag}
              >
                Add Tag
              </Button>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
};
