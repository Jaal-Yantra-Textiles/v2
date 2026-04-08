import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Text,
  Tooltip,
  toast,
} from "@medusajs/ui";
import { PencilSquare, XMarkMini } from "@medusajs/icons";
import { useState, KeyboardEvent } from "react";
import { ActionMenu } from "../common/action-menu";
import { AdminDesign, DesignSizeSet, useUpdateDesign } from "../../hooks/api/designs";

interface DesignAttributesSectionProps {
  design: AdminDesign;
}

const getTagColor = (tag: string) => {
  const colors = ["green", "blue", "orange", "purple", "red", "grey"] as const;
  const hash = tag.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

const renderMeasurements = (measurements: Record<string, number>) => (
  <div className="p-2 space-y-1">
    {Object.entries(measurements).map(([name, value]) => (
      <div key={name} className="flex items-center gap-x-2">
        <Text size="small" leading="compact" weight="plus">
          {name}:
        </Text>
        <Text size="small" leading="compact">
          {value}
        </Text>
      </div>
    ))}
  </div>
);

export const DesignAttributesSection = ({
  design,
}: DesignAttributesSectionProps) => {
  const [tagInput, setTagInput] = useState("");
  const { mutateAsync: updateDesign } = useUpdateDesign(design.id);

  // Colors
  const structuredColors =
    design.colors?.map((c) => ({
      name: c.name,
      code: c.hex_code,
      usage_notes: c.usage_notes,
    })) || [];

  const legacyPalette =
    design.color_palette?.map((c) => ({ name: c.name, code: c.code })) || [];

  const colorPalette = structuredColors.length ? structuredColors : legacyPalette;

  // Sizes
  const structuredSizeSets: DesignSizeSet[] = design.size_sets || [];
  const customSizes = design.custom_sizes || {};
  const hasStructuredSizes = structuredSizeSets.length > 0;
  const hasLegacySizes = Object.keys(customSizes).length > 0;
  const hasSizes = hasStructuredSizes || hasLegacySizes;

  // Tags
  const handleTagKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.replace(/,/g, "").trim();
      if (!newTag) return;
      try {
        const existing = design.tags || [];
        await updateDesign({ tags: [...new Set([...existing, newTag])] });
        setTagInput("");
        toast.success("Tag added");
      } catch (err: any) {
        toast.error(err?.message || "Failed to add tag");
      }
    }
  };

  const handleDeleteTag = async (tagToDelete: string) => {
    try {
      await updateDesign({
        tags: (design.tags || []).filter((t) => t !== tagToDelete),
      });
      toast.success("Tag removed");
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove tag");
    }
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Attributes</Heading>
      </div>

      {/* Colors */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <Text size="small" weight="plus" className="text-ui-fg-subtle">
            Colors
          </Text>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit Colors",
                    icon: <PencilSquare />,
                    to: "edit-color-palette",
                  },
                ],
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {colorPalette.length > 0 ? (
            colorPalette.map((color, i) => (
              <Tooltip
                key={i}
                content={
                  <div className="space-y-1">
                    <Text size="small" weight="plus">
                      {color.name}
                    </Text>
                    <Text size="small">{color.code?.toUpperCase()}</Text>
                    {(color as any).usage_notes && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {(color as any).usage_notes}
                      </Text>
                    )}
                  </div>
                }
              >
                <div className="flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-md border border-ui-border-base shadow-sm"
                    style={{ backgroundColor: color.code }}
                  />
                  <Text className="text-ui-fg-subtle mt-0.5" size="xsmall">
                    {color.name}
                  </Text>
                </div>
              </Tooltip>
            ))
          ) : (
            <Text size="small" className="text-ui-fg-muted">
              No colors
            </Text>
          )}
        </div>
      </div>

      {/* Sizes */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <Text size="small" weight="plus" className="text-ui-fg-subtle">
            Sizes
          </Text>
          <ActionMenu
            groups={[
              {
                actions: [
                  {
                    label: "Edit Sizes",
                    icon: <PencilSquare />,
                    to: "edit-size",
                  },
                ],
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {hasSizes ? (
            hasStructuredSizes
              ? structuredSizeSets.map((s) => (
                  <Tooltip
                    key={s.id || s.size_label}
                    content={renderMeasurements(s.measurements || {})}
                  >
                    <div>
                      <Badge className="text-xs px-2 py-1 cursor-pointer hover:bg-ui-bg-base-hover">
                        {s.size_label}
                      </Badge>
                    </div>
                  </Tooltip>
                ))
              : Object.entries(customSizes).map(([name, measurements]) => (
                  <Tooltip
                    key={name}
                    content={renderMeasurements(
                      (measurements as Record<string, number>) || {}
                    )}
                  >
                    <div>
                      <Badge className="text-xs px-2 py-1 cursor-pointer hover:bg-ui-bg-base-hover">
                        {name}
                      </Badge>
                    </div>
                  </Tooltip>
                ))
          ) : (
            <Text size="small" className="text-ui-fg-muted">
              No sizes
            </Text>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="px-6 py-4">
        <Text
          size="small"
          weight="plus"
          className="text-ui-fg-subtle mb-3 block"
        >
          Tags
        </Text>
        <Input
          placeholder="Type tag + Enter"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          className="mb-3"
          size="small"
          autoComplete="off"
        />
        <div className="flex flex-wrap gap-1.5">
          {design.tags?.map((tag, i) => (
            <div key={i} className="relative group">
              <Button
                variant="transparent"
                size="small"
                className="absolute -top-1.5 -right-1.5 p-0 h-3.5 w-3.5 bg-ui-bg-base rounded-full z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDeleteTag(tag)}
              >
                <XMarkMini className="w-2.5 h-2.5" />
              </Button>
              <Badge color={getTagColor(tag)} className="text-xs">
                {tag}
              </Badge>
            </div>
          ))}
          {(!design.tags || design.tags.length === 0) && (
            <Text size="small" className="text-ui-fg-muted">
              No tags
            </Text>
          )}
        </div>
      </div>
    </Container>
  );
};
