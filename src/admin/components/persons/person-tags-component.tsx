import { Badge, Container, Heading, Text, Button, Tooltip, Input, toast, CommandBar } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { PencilSquare, XMarkMini } from "@medusajs/icons";
import { ActionMenu } from "../common/action-menu";
import { Tag } from "../../hooks/api/personandtype";
import { useAddTagsToPerson } from "../../hooks/api/person-tags";
import { useState, KeyboardEvent, useEffect } from "react";
import { sdk } from "../../lib/config";

interface PersonTagsComponentProps {
  person: {
    id: string;
    tags: Tag[];
    [key: string]: any;
  };
}

export const PersonTagsComponent = ({ person }: PersonTagsComponentProps) => {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tagsSelected, setTagsSelected] = useState(false);
  
  // Use person.tags directly instead of fetching
  const { mutateAsync: addTags } = useAddTagsToPerson(person.id);
  
  // Show tooltip briefly when component mounts
  useEffect(() => {
    setShowTooltip(true);
    const timer = setTimeout(() => setShowTooltip(false), 5000);
    return () => clearTimeout(timer);
  }, []);

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
    const inputElement = document.getElementById('tag-input') as HTMLInputElement;
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
  
  // Add a keyboard shortcut for Command+T that works globally
  useEffect(() => {
    const handleGlobalKeyPress = (e: globalThis.KeyboardEvent) => {
      // Check for Command/Ctrl + T outside of the input field
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        console.log('Global Command+T detected');
        // Focus the tag input
        const inputElement = document.getElementById('tag-input') as HTMLInputElement;
        if (inputElement) {
          e.preventDefault(); // Prevent browser's default behavior
          inputElement.focus();
        }
      }
    };
    
    // Add global event listener
    window.addEventListener('keydown', handleGlobalKeyPress);
    
    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyPress);
    };
  }, []);
  
  // Handle key press in tag input
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    console.log('Input key pressed:', e.key, 'Meta key:', e.metaKey, 'Ctrl key:', e.ctrlKey);
    
    // Check for Command/Ctrl + T to add multiple tags
    if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 't')) {
      e.preventDefault();
      console.log('Command+T detected, processing tags from:', tagInput);
      
      // If there's no input, just focus and return
      if (!tagInput.trim()) {
        return;
      }
      
      // Split by spaces and filter empty strings
      const newTags = tagInput
        .split(/\s+/)
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
      
      console.log('Parsed tags:', newTags);
      
      if (newTags.length > 0) {
        setPendingTags([...pendingTags, ...newTags]);
        setTagInput('');
        setTagsSelected(true);
        console.log('Tags added to pending list');
      }
      return;
    }
    
    // If Enter is pressed, add the tag
    if (e.key === 'Enter' && tagInput.trim()) {
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
    else if (e.key === ',' && tagInput.trim()) {
      e.preventDefault();
      const tagValue = tagInput.replace(/,/g, '').trim();
      if (tagValue) {
        setPendingTags([...pendingTags, tagValue]);
        setTagInput('');
        setTagsSelected(true);
      }
    }
    // If Tab is pressed with content, add the tag
    else if (e.key === 'Tab' && tagInput.trim()) {
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
      const tagValue = tagInput.trim();
      setPendingTags([...pendingTags, tagValue]);
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
        await addTags({ name: pendingTags });
        toast.success('Tags added successfully');
        setPendingTags([]);
        setTagsSelected(false);
        // No need to refresh the page - React Query will handle cache invalidation
      } catch (error: any) {
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
  
  // Handle deleting a tag
  const handleDeleteTag = async (tagId: string) => {
    try {
      // We need to modify the API call to include the tagId
      await sdk.client.fetch(`/admin/persons/${person.id}/tags/${tagId}`, {
        method: "DELETE",
      });
      toast.success('Tag deleted successfully');
      // Update the person object without refreshing the page
      // We'll filter out the deleted tag from the current person.tags array
      const updatedTags = person.tags.filter(tag => tag.id !== tagId);
      person.tags = updatedTags;
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add tags');
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Heading>{t("Tags")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
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
            <CommandBar.Value>{pendingTags.length} tag{pendingTags.length !== 1 ? 's' : ''} selected</CommandBar.Value>
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
              placeholder="Type tag and press Enter or comma to add multiple"
              value={tagInput}
              onChange={handleTagInputChange}
              onKeyDown={handleKeyPress}
              className="w-full mb-2"
              autoComplete="off"
            />
            {showTooltip && (
              <div className="absolute right-0 -top-8 bg-ui-bg-base shadow-md rounded-md p-2 text-xs z-20">
                <Text size="small">Press ⌘+T to add multiple tags at once</Text>
              </div>
            )}
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
                className="absolute -top-2 -right-2 p-0 h-4 w-4 bg-ui-bg-base rounded-full z-10 opacity-0 group-hover:opacity-100 transition-opacity"
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
          {person.tags && person.tags.filter(tag => tag && tag.id).map((tag) => {
            const displayValue = getTagDisplayValue(tag);
            if (!displayValue) return null;
            
            return (
              <div key={tag.id} className="relative group">
                <Button
                  variant="transparent"
                  size="small"
                  className="absolute -top-2 -right-2 p-0 h-4 w-4 bg-ui-bg-base rounded-full z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleDeleteTag(tag.id)}
                >
                  <XMarkMini className="w-3 h-3" />
                </Button>
                <Tooltip content={displayValue}>
                  <Badge color={getTagColor(tag)}>
                    {displayValue}
                  </Badge>
                </Tooltip>
              </div>
            );
          })}
          
          {/* Empty state */}
          {pendingTags.length === 0 && (!person.tags || person.tags.length === 0) && (
            <div className="flex items-center justify-center py-4 w-full">
              <Text className="text-ui-fg-subtle">No tags found</Text>
              <Button
                variant="secondary"
                size="small"
                className="ml-2"
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
