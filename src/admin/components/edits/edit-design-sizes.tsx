import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { Badge, Text, Button, Switch, Input } from "@medusajs/ui";
import { Trash, Plus } from "@medusajs/icons";
import { useRouteModal } from "../modal/use-route-modal";
import { useUpdateDesign, AdminDesign, CustomSize } from "../../hooks/api/designs";
import { DynamicForm, type FieldConfig } from "../common/dynamic-form";
import { useState } from "react";

// Define standard size options
const standardSizes = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

// Define common measurement fields
const commonMeasurements = ["chest", "length", "shoulder", "sleeve", "waist", "hip"];

// Schema for sizes form
const sizesSchema = z.object({
  custom_sizes_json: z.string().min(1, "Size data is required"),
});

type SizesFormData = z.infer<typeof sizesSchema>;

// Helper to convert CustomSize to JSON string
const customSizeToJsonString = (customSizes?: CustomSize): string => {
  if (!customSizes) {
    return JSON.stringify({});
  }
  return JSON.stringify(customSizes, null, 2);
};

// Helper to convert JSON string back to CustomSize
const jsonStringToCustomSize = (jsonString: string): CustomSize => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return {};
  }
};

type EditDesignSizesProps = {
  design: AdminDesign;
};

// Type for structured size data
type SizeData = {
  name: string;
  measurements: {
    name: string;
    value: number;
  }[];
};

// Custom component for sizes JSON editor with helper UI
const SizesJsonEditor = ({ value, onChange }: any) => {
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [structuredSizes, setStructuredSizes] = useState<SizeData[]>(() => {
    try {
      const parsedSizes = value ? JSON.parse(value) : {};
      return Object.entries(parsedSizes).map(([sizeName, measurements]) => ({
        name: sizeName,
        measurements: Object.entries(measurements as Record<string, number>).map(([name, value]) => ({
          name,
          value,
        })),
      }));
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return [];
    }
  });

  // Convert structured sizes to JSON string
  const updateJsonFromStructured = (newStructuredSizes: SizeData[]) => {
    const sizesObject: CustomSize = {};
    
    newStructuredSizes.forEach((size) => {
      if (size.name) {
        sizesObject[size.name] = {};
        size.measurements.forEach((measurement) => {
          if (measurement.name) {
            sizesObject[size.name][measurement.name] = measurement.value;
          }
        });
      }
    });
    
    onChange(JSON.stringify(sizesObject, null, 2));
    setStructuredSizes(newStructuredSizes);
  };

  // Update structured sizes from JSON
  const updateStructuredFromJson = (jsonValue: string) => {
    try {
      const parsedSizes = JSON.parse(jsonValue);
      const newStructuredSizes = Object.entries(parsedSizes).map(([sizeName, measurements]) => ({
        name: sizeName,
        measurements: Object.entries(measurements as Record<string, number>).map(([name, value]) => ({
          name,
          value: typeof value === 'number' ? value : 0,
        })),
      }));
      
      setStructuredSizes(newStructuredSizes);
      onChange(jsonValue);
    } catch (error) {
      console.error("Error parsing JSON:", error);
      toast.error("Invalid JSON format");
    }
  };

  const handleAddStandardSize = (sizeName: string) => {
    if (showJsonEditor) {
      // JSON editor mode
      try {
        const currentSizes = value ? JSON.parse(value) : {};
        
        // Only add if it doesn't exist
        if (!currentSizes[sizeName]) {
          currentSizes[sizeName] = {
            chest: 0,
            length: 0
          };
          onChange(JSON.stringify(currentSizes, null, 2));
        } else {
          toast.error(`Size ${sizeName} already exists`);
        }
      } catch (error) {
        console.error("Error parsing JSON:", error);
        toast.error("Invalid JSON format");
      }
    } else {
      // Structured editor mode
      const sizeExists = structuredSizes.some(size => size.name === sizeName);
      
      if (!sizeExists) {
        const newStructuredSizes = [
          ...structuredSizes,
          {
            name: sizeName,
            measurements: [
              { name: "chest", value: 0 },
              { name: "length", value: 0 }
            ]
          }
        ];
        
        updateJsonFromStructured(newStructuredSizes);
      } else {
        toast.error(`Size ${sizeName} already exists`);
      }
    }
  };

  const handleAddMeasurement = (measurementName: string) => {
    if (showJsonEditor) {
      // JSON editor mode
      try {
        let currentSizes = value ? JSON.parse(value) : {};
        const sizeKeys = Object.keys(currentSizes);
        
        // Add the measurement to all sizes if they don't have it
        let updated = false;
        sizeKeys.forEach(sizeKey => {
          if (currentSizes[sizeKey][measurementName] === undefined) {
            currentSizes[sizeKey][measurementName] = 0;
            updated = true;
          }
        });
        
        if (updated) {
          onChange(JSON.stringify(currentSizes, null, 2));
        } else if (sizeKeys.length > 0) {
          toast.error(`All sizes already have ${measurementName} measurement`);
        } else {
          toast.error("Add a size first before adding measurements");
        }
      } catch (error) {
        console.error("Error parsing JSON:", error);
        toast.error("Invalid JSON format");
      }
    } else {
      // Structured editor mode
      if (structuredSizes.length === 0) {
        toast.error("Add a size first before adding measurements");
        return;
      }
      
      let updated = false;
      const newStructuredSizes = structuredSizes.map(size => {
        const measurementExists = size.measurements.some(m => m.name === measurementName);
        
        if (!measurementExists) {
          updated = true;
          return {
            ...size,
            measurements: [...size.measurements, { name: measurementName, value: 0 }]
          };
        }
        
        return size;
      });
      
      if (updated) {
        updateJsonFromStructured(newStructuredSizes);
      } else {
        toast.error(`All sizes already have ${measurementName} measurement`);
      }
    }
  };

  const handleAddSize = () => {
    const newStructuredSizes = [
      ...structuredSizes,
      {
        name: "",
        measurements: [
          { name: "chest", value: 0 },
          { name: "length", value: 0 }
        ]
      }
    ];
    
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleRemoveSize = (index: number) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes.splice(index, 1);
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleAddSizeMeasurement = (sizeIndex: number) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].measurements.push({ name: "", value: 0 });
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleRemoveSizeMeasurement = (sizeIndex: number, measurementIndex: number) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].measurements.splice(measurementIndex, 1);
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleSizeNameChange = (sizeIndex: number, newName: string) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].name = newName;
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleMeasurementNameChange = (sizeIndex: number, measurementIndex: number, newName: string) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].measurements[measurementIndex].name = newName;
    updateJsonFromStructured(newStructuredSizes);
  };

  const handleMeasurementValueChange = (sizeIndex: number, measurementIndex: number, newValue: number) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].measurements[measurementIndex].value = newValue;
    updateJsonFromStructured(newStructuredSizes);
  };

  return (
    <div className="space-y-4">
      {/* Toggle switch between structured editor and JSON editor */}
      <div className="flex items-center justify-between mb-4">
        <Text>Editor Mode</Text>
        <div className="flex items-center gap-2">
          <Text size="small" className={!showJsonEditor ? "font-medium" : "text-ui-fg-subtle"}>Form</Text>
          <Switch
            checked={showJsonEditor}
            onCheckedChange={setShowJsonEditor}
          />
          <Text size="small" className={showJsonEditor ? "font-medium" : "text-ui-fg-subtle"}>JSON</Text>
        </div>
      </div>

      {/* Quick add buttons (available in both modes) */}
      <div>
        <Text className="mb-2 font-medium">Quick Add Size:</Text>
        <div className="flex flex-wrap gap-2 mb-4">
          {standardSizes.map((size) => (
            <Badge 
              key={size} 
              className="cursor-pointer hover:bg-ui-bg-base-hover"
              onClick={() => handleAddStandardSize(size)}
            >
              {size}
            </Badge>
          ))}
        </div>
      </div>
      
      <div>
        <Text className="mb-2 font-medium">Quick Add Measurement:</Text>
        <div className="flex flex-wrap gap-2 mb-4">
          {commonMeasurements.map((measurement) => (
            <Badge 
              key={measurement} 
              className="cursor-pointer hover:bg-ui-bg-base-hover"
              onClick={() => handleAddMeasurement(measurement)}
            >
              {measurement}
            </Badge>
          ))}
        </div>
      </div>
      
      {showJsonEditor ? (
        // JSON Editor
        <>
          <textarea
            className="w-full h-64 p-2 font-mono text-sm border border-ui-border-base rounded-md"
            value={value || ''}
            onChange={(e) => {
              onChange(e.target.value);
              // Only update structured data on valid JSON
              try {
                JSON.parse(e.target.value);
                updateStructuredFromJson(e.target.value);
              } catch (e) {
                // Invalid JSON, don't update structured data
              }
            }}
            placeholder={`{\n  "S": {\n    "chest": 36,\n    "length": 28\n  }\n}`}
          />
          <Text size="small" className="text-ui-fg-subtle">
            Format: Each size (S, M, L, etc.) with measurements as key-value pairs
          </Text>
        </>
      ) : (
        // Structured Editor
        <>
          <div className="space-y-6">
            {structuredSizes.map((size, sizeIndex) => (
              <div key={sizeIndex} className="border border-ui-border-base rounded-md p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex-1">
                    <Text className="mb-1 font-medium">Size Name:</Text>
                    <Input 
                      value={size.name}
                      onChange={(e) => handleSizeNameChange(sizeIndex, e.target.value)}
                      placeholder="e.g. S, M, L, Custom"
                    />
                  </div>
                  <Button 
                    variant="secondary" 
                    size="small" 
                    type="button"
                    onClick={() => handleRemoveSize(sizeIndex)}
                    className="ml-2"
                  >
                    <Trash className="text-ui-fg-error" />
                  </Button>
                </div>

                {/* Measurements for this size */}
                <div className="space-y-3">
                  <Text className="font-medium">Measurements:</Text>
                  
                  {/* Measurement fields */}
                  {size.measurements.map((measurement, measurementIndex) => (
                    <div key={measurementIndex} className="flex items-center gap-x-3">
                      <div className="flex-1">
                        <Input 
                          value={measurement.name}
                          onChange={(e) => handleMeasurementNameChange(sizeIndex, measurementIndex, e.target.value)}
                          placeholder="Measurement name"
                        />
                      </div>
                      <div className="flex-1">
                        <Input 
                          type="number"
                          value={measurement.value}
                          onChange={(e) => handleMeasurementValueChange(sizeIndex, measurementIndex, Number(e.target.value))}
                          placeholder="Value"
                        />
                      </div>
                      <Button 
                        variant="secondary" 
                        size="small" 
                        type="button"
                        onClick={() => handleRemoveSizeMeasurement(sizeIndex, measurementIndex)}
                      >
                        <Trash className="text-ui-fg-error" />
                      </Button>
                    </div>
                  ))}
                  
                  {/* Add measurement button */}
                  <Button 
                    variant="secondary" 
                    size="small" 
                    type="button"
                    onClick={() => handleAddSizeMeasurement(sizeIndex)}
                    className="mt-2"
                  >
                    <Plus className="mr-1" /> Add Measurement
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Add size button */}
          <Button 
            variant="secondary" 
            type="button"
            onClick={handleAddSize}
            className="w-full"
          >
            <Plus className="mr-1" /> Add Size
          </Button>
        </>
      )}
    </div>
  );
};

export const EditDesignSizes = ({ design }: EditDesignSizesProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdateDesign(design.id);

  const handleSubmit = async (data: SizesFormData) => {
    try {
      // Parse the JSON string to get the custom sizes object
      const customSizes = jsonStringToCustomSize(data.custom_sizes_json);
      
      // Validate that we have a valid object before submitting
      if (Object.keys(customSizes).length === 0) {
        toast.error("Please add at least one size");
        return;
      }
      
      await mutateAsync(
        {
          custom_sizes: customSizes,
        },
        {
          onSuccess: ({ design }) => {
            toast.success(
              t("designs.updateSizesSuccess", {
                name: design.name,
              })
            );
            handleSuccess();
          },
          onError: (error) => {
            toast.error(error.message);
          },
        }
      );
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.error("Invalid JSON format");
    }
  };

  const fields: FieldConfig<SizesFormData>[] = [
    {
      name: "custom_sizes_json",
      type: "custom",
      label: t("Design Sizes"),
      required: true,
      customComponent: SizesJsonEditor,
      gridCols: 1
    },
  ];

  return (
    <DynamicForm
      fields={fields}
      defaultValues={{
        custom_sizes_json: customSizeToJsonString(design.custom_sizes),
      }}
      onSubmit={handleSubmit}
      isPending={isPending}
      layout={{ showDrawer: true, gridCols: 1 }}
    />
  );
};
