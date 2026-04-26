import { Badge, Container, Heading, Text, Button, Tooltip, Input, toast, CommandBar } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import {  XMarkMini } from "@medusajs/icons";
import { useState, KeyboardEvent } from "react";
import { AdminDesign, useUpdateDesign } from "../../hooks/api/designs";

interface DesignTagsSectionProps {
  design: AdminDesign;
}

export const DesignTagsSection = ({ design }: DesignTagsSectionProps) => {
  const { t } = useTranslation();
  const [tagInput, setTagInput] = useState("");
  const [pendingTags, setPendingTags] = useState<string[]>([]);
  const [tagsSelected, setTagsSelected] = useState(false);
  
  // Use mutation hook for updating design
  const { mutateAsync: updateDesign } = useUpdateDesign(design.id);

  // Function to get a color for a tag based on its value
  const getTagColor = (tag: string) => {
    const colors = ["green", "blue", "orange", "purple", "red", "grey"] as const;
    
    // Simple hash function to consistently assign colors based on tag string
    const hash = tag.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  }; 
  
  // Handle tag input change
  const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTagInput(e.target.value);
  };
  
  // Handle key press in tag input
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
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
        // Get existing tags or initialize empty array
        const existingTags = design.tags || [];
        
        // Combine existing and new tags, ensuring uniqueness
        const uniqueTags = [...new Set([...existingTags, ...pendingTags])];
        
        // Update the design with new tags
        await updateDesign({ tags: uniqueTags });
        
        toast.success('Tags added successfully');
        setPendingTags([]);
        setTagsSelected(false);
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
  
  // Handle deleting a tag
  const handleDeleteTag = async (tagToDelete: string) => {
    try {
      // Filter out the tag to delete
      const updatedTags = (design.tags || []).filter(tag => tag !== tagToDelete);
      
      // Update the design with the filtered tags
      await updateDesign({ tags: updatedTags });
      
      toast.success('Tag deleted successfully');
    } catch (error: any) {
      console.error("Error deleting tag:", error);
      toast.error(error?.message || 'Failed to delete tag');
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Heading level="h2">{t("Tags")}</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Tags associated with this design
            </Text>
          </div>
          <div className="flex items-center gap-x-2">
            
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
              placeholder="Type tag and press Enter or comma to add, then press 'S' to save"
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
          {design.tags && design.tags.map((tag, index) => (
            <div key={`tag-${index}`} className="relative group">
              <Button
                variant="transparent"
                size="small"
                className="absolute -top-2 -right-2 p-0 h-4 w-4 bg-ui-bg-base rounded-full z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDeleteTag(tag)}
              >
                <XMarkMini className="w-3 h-3" />
              </Button>
              <Tooltip content={tag}>
                <Badge color={getTagColor(tag)}>
                  {tag}
                </Badge>
              </Tooltip>
            </div>
          ))}
          
          {/* Empty state */}
          {pendingTags.length === 0 && (!design.tags || design.tags.length === 0) && (
            <div className="flex items-center justify-center py-4 w-full">
              <Text className="text-ui-fg-subtle">No tags found</Text>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
};
