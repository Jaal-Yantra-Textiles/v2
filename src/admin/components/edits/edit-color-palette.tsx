import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Button,
  Input,
  Text,
  Badge,
  Heading,
} from "@medusajs/ui";
import { XMarkMini, Plus } from "@medusajs/icons";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { SketchPicker } from "react-color";
import { useUpdateDesign, AdminDesign } from "../../hooks/api/designs";
import { useRouteModal } from "../modal/use-route-modal";

interface ColorEntry {
  name: string;
  hex_code: string;
  usage_notes?: string;
  order?: number;
}

const getContrastColor = (hexColor: string) => {
  try {
    hexColor = hexColor.replace(/^#/, "");
    let r, g, b;
    if (hexColor.length === 3) {
      r = parseInt(hexColor.charAt(0) + hexColor.charAt(0), 16);
      g = parseInt(hexColor.charAt(1) + hexColor.charAt(1), 16);
      b = parseInt(hexColor.charAt(2) + hexColor.charAt(2), 16);
    } else {
      r = parseInt(hexColor.substring(0, 2), 16);
      g = parseInt(hexColor.substring(2, 4), 16);
      b = parseInt(hexColor.substring(4, 6), 16);
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#000000" : "#FFFFFF";
  } catch {
    return "#000000";
  }
};

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
  const { handleSuccess } = useRouteModal();

  const [colors, setColors] = useState<ColorEntry[]>(() =>
    getInitialColors(design)
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
      });
      toast.success(`Color palette saved with ${colors.length} colors`);
      handleSuccess();
    } catch (error) {
      toast.error("Failed to save color palette");
      console.error(error);
    }
  };

  return (
    <>
      <RouteDrawer.Body className="flex flex-1 flex-col gap-y-6 overflow-y-auto">
        {/* Current palette */}
        {colors.length > 0 && (
          <div className="flex flex-col gap-y-2">
            <div className="flex items-center justify-between">
              <Text size="small" weight="plus">
                Current Palette
              </Text>
              <Badge size="2xsmall">{colors.length}</Badge>
            </div>
            <div className="flex flex-col gap-y-1">
              {colors.map((color, index) => (
                <div
                  key={`color-${index}`}
                  className={`group flex items-center gap-x-3 rounded-md p-2 cursor-pointer transition-colors ${
                    selectedColorIndex === index
                      ? "bg-ui-bg-base-pressed"
                      : "hover:bg-ui-bg-base-hover"
                  }`}
                  onClick={() => handleEditColor(index)}
                >
                  <div
                    className="w-8 h-8 rounded-md border border-ui-border-base flex-shrink-0"
                    style={{ backgroundColor: color.hex_code }}
                  />
                  <div className="flex-1 min-w-0">
                    <Text size="small" weight="plus" className="truncate">
                      {color.name}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle font-mono">
                      {color.hex_code.toUpperCase()}
                    </Text>
                  </div>
                  <Button
                    variant="transparent"
                    size="small"
                    className="p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveColor(index);
                    }}
                    type="button"
                  >
                    <XMarkMini className="w-4 h-4 text-ui-fg-subtle" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {colors.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-ui-bg-subtle flex items-center justify-center mb-3">
              <Plus className="w-5 h-5 text-ui-fg-subtle" />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              No colors yet. Add your first color below.
            </Text>
          </div>
        )}

        {/* Add / Edit color form */}
        <div className="border-t border-ui-border-base pt-4 flex flex-col gap-y-4">
          <Text size="small" weight="plus">
            {selectedColorIndex !== null ? "Edit Color" : "Add New Color"}
          </Text>

          {/* Color preview + picker */}
          <div className="flex items-start gap-x-4">
            <div className="relative">
              <div
                className="w-16 h-16 rounded-lg cursor-pointer border border-ui-border-base flex items-center justify-center transition-transform hover:scale-105"
                style={{
                  backgroundColor: newColor.hex_code,
                  color: getContrastColor(newColor.hex_code),
                }}
                onClick={() => setShowColorPicker(!showColorPicker)}
              >
                <Text
                  size="xsmall"
                  style={{ color: getContrastColor(newColor.hex_code) }}
                >
                  {showColorPicker ? "Close" : "Pick"}
                </Text>
              </div>

              {showColorPicker && (
                <div
                  ref={colorPickerRef}
                  className="absolute z-10 mt-2 shadow-lg"
                >
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

            <div className="flex-1 flex flex-col gap-y-3">
              <Input
                size="small"
                placeholder="#000000"
                value={newColor.hex_code}
                onChange={(e) =>
                  setNewColor({ ...newColor, hex_code: e.target.value })
                }
              />
              <Input
                size="small"
                placeholder="Color name, e.g. Royal Purple"
                value={newColor.name}
                onChange={(e) =>
                  setNewColor({ ...newColor, name: e.target.value })
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-x-2">
            {selectedColorIndex !== null && (
              <Button
                size="small"
                variant="secondary"
                type="button"
                onClick={() => {
                  setNewColor({ hex_code: "#5048E5", name: "" });
                  setSelectedColorIndex(null);
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              size="small"
              variant="secondary"
              type="button"
              onClick={handleAddColor}
            >
              {selectedColorIndex !== null ? "Update Color" : "Add Color"}
            </Button>
          </div>
        </div>
      </RouteDrawer.Body>

      <RouteDrawer.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteDrawer.Close asChild>
            <Button size="small" variant="secondary">
              Cancel
            </Button>
          </RouteDrawer.Close>
          <Button
            size="small"
            type="button"
            onClick={handleSave}
            isLoading={isSaving}
          >
            Save
          </Button>
        </div>
      </RouteDrawer.Footer>
    </>
  );
};

export default ColorPaletteEditor;
