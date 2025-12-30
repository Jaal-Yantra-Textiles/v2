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
import { RouteFocusModal } from "../modal/route-focus-modal";
import { SketchPicker } from "react-color";
import { useUpdateDesign } from "../../hooks/api/designs";
import { useParams } from "react-router-dom";
import { useRouteModal } from "../modal/use-route-modal";
import { convertColorPaletteToColors } from "../../../workflows/designs/helpers/size-set-utils";

// Define ColorPalette interface
interface ColorPalette {
  code: string;
  name: string;
}

// Helper function to determine if text should be white or black based on background color
const getContrastColor = (hexColor: string) => {
  try {
    // Remove the # if present
    hexColor = hexColor.replace(/^#/, '');
    
    // Parse the hex values
    let r, g, b;
    if (hexColor.length === 3) {
      // For shorthand hex (#RGB)
      r = parseInt(hexColor.charAt(0) + hexColor.charAt(0), 16);
      g = parseInt(hexColor.charAt(1) + hexColor.charAt(1), 16);
      b = parseInt(hexColor.charAt(2) + hexColor.charAt(2), 16);
    } else {
      // For full hex (#RRGGBB)
      r = parseInt(hexColor.substring(0, 2), 16);
      g = parseInt(hexColor.substring(2, 4), 16);
      b = parseInt(hexColor.substring(4, 6), 16);
    }
    
    // Calculate luminance - standard formula for perceived brightness
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  } catch (e) {
    return '#000000'; // Default to black if there's an error
  }
};



// Custom component for color palette editor with helper UI
export const ColorPaletteEditor = ({ value, onChange }: { value: string; onChange: (value: string) => void }) => {
  // Get design ID from URL params
  const { id } = useParams();
  const { mutateAsync: updateDesign, isPending: isSaving } = useUpdateDesign(id!);
  const { handleSuccess } = useRouteModal();
  
  const [colorPalette, setColorPalette] = useState<ColorPalette[]>(() => {
    try {
      return JSON.parse(value || '[]');
    } catch (e) {
      return [];
    }
  });
  
  const [newColor, setNewColor] = useState<ColorPalette>({
    code: '#5048E5', // A nice purple as default
    name: '',
  });
  
  // State for color picker visibility
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  
  // Handle color change from the color picker
  const handleColorChange = (color: any) => {
    setNewColor({ ...newColor, code: color.hex });
    // Close the color picker after a short delay to give visual feedback
    setTimeout(() => {
      setShowColorPicker(false);
    }, 300);
  };
  
  const [selectedColorIndex, setSelectedColorIndex] = useState<number | null>(null);
  
  // Update the form value whenever colorPalette changes
  const updateFormValue = (updatedPalette: ColorPalette[]) => {
    setColorPalette(updatedPalette);
    onChange(JSON.stringify(updatedPalette, null, 2));
  };
  
  // Close color picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle adding a new color
  const handleAddColor = () => {
    // Validate color code format
    if (!/^#([A-Fa-f0-9]{3}){1,2}$/.test(newColor.code)) {
      toast.error("Invalid hex color code. Must start with # followed by 3 or 6 hex digits.");
      return;
    }
    
    // Validate color name
    if (!newColor.name.trim()) {
      toast.error("Color name is required");
      return;
    }
    
    // Check if color code already exists
    if (colorPalette.some(color => color.code.toLowerCase() === newColor.code.toLowerCase())) {
      toast.error("This color code already exists in the palette");
      return;
    }
    
    if (selectedColorIndex !== null) {
      // Update existing color
      const updatedPalette = [...colorPalette];
      updatedPalette[selectedColorIndex] = { ...newColor };
      updateFormValue(updatedPalette);
      setSelectedColorIndex(null);
    } else {
      // Add new color
      updateFormValue([...colorPalette, { ...newColor }]);
    }
    
    // Reset input fields
    setNewColor({ code: '#000000', name: '' });
  };
  
  // Handle editing a color
  const handleEditColor = (index: number) => {
    setNewColor({ ...colorPalette[index] });
    setSelectedColorIndex(index);
  };
  
  // Handle removing a color
  const handleRemoveColor = (index: number) => {
    const updatedPalette = [...colorPalette];
    updatedPalette.splice(index, 1);
    updateFormValue(updatedPalette);
    
    // If the removed color was selected, reset the form
    if (selectedColorIndex === index) {
      setNewColor({ code: '#000000', name: '' });
      setSelectedColorIndex(null);
    }
  };
  
  
  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <Heading className="text-xl">Edit Color Palette</Heading>
        </div>
      </RouteFocusModal.Header>
      
      <div className="flex flex-col md:flex-row h-full">
        {/* Sidebar: Current Palette */}
        <div className="w-full md:w-72 lg:w-80 bg-ui-bg-subtle md:min-h-[calc(100vh-120px)]">
          <div className="px-6 py-5 flex items-center justify-between">
            <Heading className="text-base">Current Palette</Heading>
            <Badge className="px-2 py-0.5 text-xs">
              {colorPalette.length}
            </Badge>
          </div>
          
          {colorPalette.length > 0 ? (
            <div className="px-4 space-y-2 max-h-[calc(100vh-180px)] overflow-y-auto">
              {colorPalette.map((color, index) => (
                <div 
                  key={`color-${index}`}
                  className={`relative group flex items-center p-3 rounded-lg hover:bg-white transition-all cursor-pointer ${selectedColorIndex === index ? 'bg-white shadow-sm' : ''}`}
                  onClick={() => handleEditColor(index)}
                >
                  {/* Color Swatch */}
                  <div 
                    className="w-10 h-10 rounded-md flex-shrink-0"
                    style={{ backgroundColor: color.code }}
                  />
                  
                  {/* Color Info */}
                  <div className="ml-3 flex-1 min-w-0">
                    <Text className="font-medium text-sm truncate">{color.name}</Text>
                    <Text className="text-ui-fg-subtle text-xs font-mono">{color.code.toUpperCase()}</Text>
                  </div>
                  
                  {/* Delete Button */}
                  <Button
                    variant="transparent"
                    size="small"
                    className="p-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveColor(index);
                    }}
                    type="button"
                  >
                    <XMarkMini className="w-4 h-4 text-ui-fg-subtle hover:text-ui-fg-base" />
                  </Button>
                </div>
              ))}
              <div className="h-4"></div> {/* Bottom spacing */}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Text className="text-ui-fg-subtle text-sm mb-4">No colors yet</Text>
              <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mb-3">
                <Plus className="w-6 h-6 text-ui-fg-subtle" />
              </div>
              <Text className="text-ui-fg-subtle text-xs">Add your first color</Text>
            </div>
          )}
        </div>
        
        {/* Main Content: Color Editor */}
        <div className="flex-1 p-8">
          <div className="max-w-2xl mx-auto">
            <Heading className="text-xl mb-8">
              {selectedColorIndex !== null ? "Edit Color" : "Add New Color"}
            </Heading>
            
            <div 
              className="space-y-6 p-6 rounded-xl transition-all duration-300"
              style={{
                backgroundColor: `${newColor.code}10`, // 10% opacity version of the color
                boxShadow: `0 4px 20px ${newColor.code}20` // 20% opacity shadow of the color
              }}
            >
              {/* Color Preview and Picker */}
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div className="relative">
                  <div 
                    className="w-36 h-36 rounded-lg cursor-pointer flex items-center justify-center transition-all hover:scale-105 shadow-lg"
                    style={{ 
                      backgroundColor: newColor.code,
                      color: getContrastColor(newColor.code),
                      boxShadow: `0 10px 25px ${newColor.code}40` // 40% opacity shadow of the color
                    }}
                    onClick={() => setShowColorPicker(!showColorPicker)}
                  >
                    <Text className="font-medium" style={{ color: getContrastColor(newColor.code) }}>
                      {showColorPicker ? 'Close' : 'Pick Color'}
                    </Text>
                  </div>
                  
                  {/* React Color Picker */}
                  {showColorPicker && (
                    <div 
                      ref={colorPickerRef}
                      className="absolute z-10 mt-2 shadow-lg"
                    >
                      <SketchPicker
                        color={newColor.code}
                        onChange={handleColorChange}
                        disableAlpha={true}
                        presetColors={[
                          '#F44336', '#E91E63', '#9C27B0', '#673AB7', '#3F51B5',
                          '#2196F3', '#03A9F4', '#00BCD4', '#009688', '#4CAF50',
                          '#8BC34A', '#CDDC39', '#FFEB3B', '#FFC107', '#FF9800',
                          '#FF5722', '#795548', '#9E9E9E', '#607D8B', '#000000',
                          '#FFFFFF'
                        ]}
                      />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 space-y-4">
                  {/* Color Code Input */}
                  <div>
                    <Text className="font-medium mb-2">Color Code (Hex)</Text>
                    <Input
                      placeholder="#000000"
                      value={newColor.code}
                      onChange={(e) => setNewColor({ ...newColor, code: e.target.value })}
                    />
                  </div>
                  
                  {/* Color Name Input */}
                  <div>
                    <Text className="font-medium mb-2">Color Name</Text>
                    <Input
                      placeholder="e.g. Royal Purple"
                      value={newColor.name}
                      onChange={(e) => setNewColor({ ...newColor, name: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            
            </div>
            
            <div className="flex justify-end gap-x-3 pt-6 mt-2">
              {selectedColorIndex !== null && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setNewColor({ code: '#5048E5', name: '' });
                    setSelectedColorIndex(null);
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                type="button"
                onClick={handleAddColor}
              >
                {selectedColorIndex !== null ? "Update Color" : "Add Color"}
              </Button>
            </div>
          </div>
        </div>
        </div>
        <RouteFocusModal.Footer>
          <div className="flex justify-end w-full">
            {colorPalette.length > 0 && (
              <Button 
                variant="primary" 
                onClick={async () => {
                  try {
                    // Update the form value
                    onChange(JSON.stringify(colorPalette, null, 2));
                    
                    // Call the API to update the design
                    await updateDesign({
                      color_palette: colorPalette,
                      colors: convertColorPaletteToColors(colorPalette),
                    });
                    
                    toast.success(`Color palette saved with ${colorPalette.length} colors`);
                    handleSuccess();
                  } catch (error) {
                    toast.error("Failed to save color palette");
                    console.error(error);
                  }
                }}
                size="base"
                className="px-6"
                isLoading={isSaving}
              >
                Save
              </Button>
            )}
          </div>
        </RouteFocusModal.Footer>
      
    </RouteFocusModal>
  );
};


export default ColorPaletteEditor;

