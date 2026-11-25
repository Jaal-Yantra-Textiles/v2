import { useState, useRef, useEffect } from "react";
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Switch,
  Text,
  toast,
} from "@medusajs/ui";
import { XMarkMini, Plus } from "@medusajs/icons";

import { SketchPicker } from "react-color";
import { useUpdateDesign, AdminDesign } from "../../hooks/api/designs";
import { useModalChrome } from "../modal/chrome/use-modal-chrome";

interface ColorEntry {
  name: string;
  hex_code: string;
  usage_notes?: string;
  order?: number;
}

const getInitialColors = (design: AdminDesign): ColorEntry[] => {
  if (design.colors?.length) {
    return design.colors.map((c, i) => ({
      name: c.name,
      hex_code: c.hex_code,
      usage_notes: c.usage_notes ?? undefined,
      order: c.order ?? i,
    }));
  }
  if (design.color_palette?.length) {
    return design.color_palette.map((c, i) => ({
      name: c.name,
      hex_code: c.code,
      order: i,
    }));
  }
  return [];
};

export const ColorPaletteEditor = ({ design }: { design: AdminDesign }) => {
  const { mutateAsync: updateDesign, isPending: isSaving } = useUpdateDesign(
    design.id
  );
  /**
   * Body and footer come from the shell: the `@edit-color-palette` drawer at
   * its own route, or the design graph's stacked modal.
   */
  const Chrome = useModalChrome();

  const [colors, setColors] = useState<ColorEntry[]>(() =>
    getInitialColors(design)
  );

  // #2500 — colours that are parts of ONE piece (base + contrast embroidery)
  // are not separate colourways: a run of this design is completed by size only.
  const [colorsAreParts, setColorsAreParts] = useState(
    design.color_mode === "parts"
  );

  const [newColor, setNewColor] = useState<{ hex_code: string; name: string }>({
    hex_code: "#5048E5",
    name: "",
  });

  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(
    null
  );

  const handleColorChange = (color: any) => {
    setNewColor({ ...newColor, hex_code: color.hex });
    setTimeout(() => setShowColorPicker(false), 300);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        colorPickerRef.current &&
        !colorPickerRef.current.contains(event.target as Node)
      ) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAddColor = () => {
    if (!/^#([A-Fa-f0-9]{3}){1,2}$/.test(newColor.hex_code)) {
      toast.error(
        "Invalid hex color code. Must start with # followed by 3 or 6 hex digits."
      );
      return;
    }
    if (!newColor.name.trim()) {
      toast.error("Color name is required");
      return;
    }

    if (selectedColorIndex !== null) {
      const updated = [...colors];
      updated[selectedColorIndex] = {
        ...updated[selectedColorIndex],
        name: newColor.name,
        hex_code: newColor.hex_code,
      };
      setColors(updated);
      setSelectedColorIndex(null);
    } else {
      if (
        colors.some(
          (c) => c.hex_code.toLowerCase() === newColor.hex_code.toLowerCase()
        )
      ) {
        toast.error("This color code already exists in the palette");
        return;
      }
      setColors([
        ...colors,
        { name: newColor.name, hex_code: newColor.hex_code, order: colors.length },
      ]);
    }

    setNewColor({ hex_code: "#000000", name: "" });
  };

  const handleEditColor = (index: number) => {
    setNewColor({
      name: colors[index].name,
      hex_code: colors[index].hex_code,
    });
    setSelectedColorIndex(index);
  };

  const handleRemoveColor = (index: number) => {
    setColors(colors.filter((_, i) => i !== index));
    if (selectedColorIndex === index) {
      setNewColor({ hex_code: "#000000", name: "" });
      setSelectedColorIndex(null);
    }
  };

  const handleSave = async () => {
    try {
      await updateDesign({
        colors: colors.map((c, i) => ({
          name: c.name,
          hex_code: c.hex_code,
          usage_notes: c.usage_notes,
          order: i,
        })),
        color_mode: colorsAreParts ? "parts" : "variants",
      });
      toast.success(`Color palette saved with ${colors.length} colors`);
      Chrome.onDone();
    } catch (error) {
      toast.error("Failed to save color palette");
      console.error(error);
    }
  };

  return (
    <>
      <Chrome.Body className="flex flex-1 flex-col overflow-y-auto p-0">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-y-8 px-6 py-8">
          <div>
            <Heading level="h2">Colours</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              The colours this design is made in. Click one to edit it.
            </Text>
          </div>

          {/* Current palette */}
          <Container className="divide-y p-0">
            <div className="flex items-center gap-x-2 px-6 py-4">
              <Heading level="h2">Palette</Heading>
              <Badge size="2xsmall">{colors.length}</Badge>
            </div>
            {colors.length === 0 ? (
              <div className="px-6 py-6">
                <Text size="small" className="text-ui-fg-subtle">
                  No colours yet. Add the first one below.
                </Text>
              </div>
            ) : (
              colors.map((color, index) => (
                <div
                  key={`color-${index}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleEditColor(index)}
                  onKeyDown={(e) => e.key === "Enter" && handleEditColor(index)}
                  className={`flex cursor-pointer items-center gap-x-4 px-6 py-3 transition-colors ${
                    selectedColorIndex === index ? "bg-ui-bg-base-pressed" : "hover:bg-ui-bg-base-hover"
                  }`}
                >
                  <div
                    className="h-8 w-8 flex-shrink-0 rounded-md border border-ui-border-base"
                    style={{ backgroundColor: color.hex_code }}
                  />
                  <div className="min-w-0 flex-1">
                    <Text size="small" weight="plus" leading="compact" className="truncate">
                      {color.name}
                    </Text>
                    <Text size="xsmall" className="font-mono text-ui-fg-subtle">
                      {color.hex_code.toUpperCase()}
                    </Text>
                  </div>
                  {selectedColorIndex === index && (
                    <Badge size="2xsmall" color="blue">
                      Editing
                    </Badge>
                  )}
                  <IconButton
                    size="small"
                    variant="transparent"
                    type="button"
                    aria-label={`Remove ${color.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveColor(index);
                    }}
                  >
                    <XMarkMini />
                  </IconButton>
                </div>
              ))
            )}
          </Container>

          {/* #2500 — what these colours mean for production */}
          <Container className="flex items-start justify-between gap-x-4 px-6 py-4">
            <div className="flex flex-col gap-y-1">
              <Label htmlFor="colors-are-parts" size="small" weight="plus">
                These colours are parts of one piece
              </Label>
              <Text size="small" className="text-ui-fg-subtle">
                On for a base fabric with contrast embroidery: partners report pieces by size only. Off when
                each colour is its own version. Applies to production runs created from now on.
              </Text>
            </div>
            <Switch id="colors-are-parts" checked={colorsAreParts} onCheckedChange={setColorsAreParts} />
          </Container>

          {/* Add / edit a colour */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">{selectedColorIndex !== null ? "Edit colour" : "Add a colour"}</Heading>
            </div>
            <div className="flex flex-wrap items-end gap-3 px-6 py-4">
              <div className="relative flex flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Colour
                </Label>
                <button
                  type="button"
                  aria-label="Pick a colour"
                  className="h-8 w-14 rounded-md border border-ui-border-base"
                  style={{ backgroundColor: newColor.hex_code }}
                  onClick={() => setShowColorPicker(!showColorPicker)}
                />
                {showColorPicker && (
                  <div ref={colorPickerRef} className="absolute left-0 top-full z-10 mt-2 shadow-lg">
                    <SketchPicker
                      color={newColor.hex_code}
                      onChange={handleColorChange}
                      disableAlpha={true}
                      presetColors={[
                        "#F44336", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5",
                        "#2196F3", "#03A9F4", "#00BCD4", "#009688", "#4CAF50",
                        "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107", "#FF9800",
                        "#FF5722", "#795548", "#9E9E9E", "#607D8B", "#000000",
                        "#FFFFFF",
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="flex w-32 flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Hex
                </Label>
                <Input
                  size="small"
                  placeholder="#000000"
                  value={newColor.hex_code}
                  onChange={(e) => setNewColor({ ...newColor, hex_code: e.target.value })}
                />
              </div>
              <div className="flex min-w-[200px] flex-1 flex-col gap-y-2">
                <Label size="small" weight="plus">
                  Name
                </Label>
                <Input
                  size="small"
                  placeholder="e.g. Indigo"
                  value={newColor.name}
                  onChange={(e) => setNewColor({ ...newColor, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddColor();
                    }
                  }}
                />
              </div>
              <div className="flex items-center gap-x-2">
                {selectedColorIndex !== null && (
                  <Button
                    size="small"
                    variant="transparent"
                    type="button"
                    onClick={() => {
                      setNewColor({ hex_code: "#5048E5", name: "" });
                      setSelectedColorIndex(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
                <Button size="small" variant="secondary" type="button" onClick={handleAddColor}>
                  {selectedColorIndex !== null ? "Update colour" : (
                    <>
                      <Plus />
                      Add colour
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Container>
        </div>
      </Chrome.Body>

      <Chrome.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </Chrome.Close>
          <Button
            size="small"
            type="button"
            onClick={handleSave}
            isLoading={isSaving}
          >
            Save
          </Button>
        </div>
      </Chrome.Footer>
    </>
  );
};

export default ColorPaletteEditor;
