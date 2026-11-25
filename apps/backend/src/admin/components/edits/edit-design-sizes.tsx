import { Badge, Button, Container, Heading, IconButton, Input, Label, Select, Switch, Table, Text, Textarea, toast } from "@medusajs/ui";
import { Plus, Trash, XMarkMini } from "@medusajs/icons";
import { useModalChrome } from "../modal/chrome/use-modal-chrome";
import { useUpdateDesign, AdminDesign, CustomSize } from "../../hooks/api/designs";
import { useState } from "react";
import { convertCustomSizesToSizeSets } from "../../../workflows/designs/helpers/size-set-utils";

// Define standard size options
const standardSizes = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"];

// Define common measurement fields
const commonMeasurements = ["chest", "length", "shoulder", "sleeve", "waist", "hip"];

// Standard size charts (measurements in inches)
type GenderType = "women" | "men" | "unisex";

const STANDARD_SIZE_CHARTS: Record<GenderType, Record<string, Record<string, number>>> = {
  women: {
    XS:   { chest: 32, waist: 24, hip: 34, shoulder: 14, sleeve: 22, length: 25 },
    S:    { chest: 34, waist: 26, hip: 36, shoulder: 14.5, sleeve: 22.5, length: 25.5 },
    M:    { chest: 36, waist: 28, hip: 38, shoulder: 15, sleeve: 23, length: 26 },
    L:    { chest: 38, waist: 30, hip: 40, shoulder: 15.5, sleeve: 23.5, length: 26.5 },
    XL:   { chest: 40, waist: 32, hip: 42, shoulder: 16, sleeve: 24, length: 27 },
    XXL:  { chest: 42, waist: 34, hip: 44, shoulder: 16.5, sleeve: 24.5, length: 27.5 },
    XXXL: { chest: 44, waist: 36, hip: 46, shoulder: 17, sleeve: 25, length: 28 },
  },
  men: {
    XS:   { chest: 34, waist: 28, hip: 34, shoulder: 16, sleeve: 24, length: 27 },
    S:    { chest: 36, waist: 30, hip: 36, shoulder: 17, sleeve: 25, length: 28 },
    M:    { chest: 38, waist: 32, hip: 38, shoulder: 18, sleeve: 25.5, length: 29 },
    L:    { chest: 40, waist: 34, hip: 40, shoulder: 18.5, sleeve: 26, length: 30 },
    XL:   { chest: 42, waist: 36, hip: 42, shoulder: 19, sleeve: 26.5, length: 31 },
    XXL:  { chest: 44, waist: 38, hip: 44, shoulder: 19.5, sleeve: 27, length: 32 },
    XXXL: { chest: 46, waist: 40, hip: 46, shoulder: 20, sleeve: 27.5, length: 33 },
  },
  unisex: {
    XS:   { chest: 33, waist: 26, hip: 34, shoulder: 15, sleeve: 23, length: 26 },
    S:    { chest: 35, waist: 28, hip: 36, shoulder: 15.5, sleeve: 23.5, length: 27 },
    M:    { chest: 37, waist: 30, hip: 38, shoulder: 16.5, sleeve: 24, length: 28 },
    L:    { chest: 39, waist: 32, hip: 40, shoulder: 17, sleeve: 25, length: 29 },
    XL:   { chest: 41, waist: 34, hip: 42, shoulder: 17.5, sleeve: 25.5, length: 30 },
    XXL:  { chest: 43, waist: 36, hip: 44, shoulder: 18, sleeve: 26, length: 31 },
    XXXL: { chest: 45, waist: 38, hip: 46, shoulder: 18.5, sleeve: 26.5, length: 32 },
  },
};

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
  const [gender, setGender] = useState<GenderType>("women");
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
        measurements: Object.entries(measurements as Record<string, any>).map(([name, value]) => {
          let numericValue: number = 0
          if (typeof value === 'number') {
            numericValue = value
          } else if (typeof value === 'string') {
            const trimmed = value.trim()
            const maybeNum = Number(trimmed)
            numericValue = isNaN(maybeNum) ? 0 : maybeNum
          }
          return { name, value: numericValue }
        }),
      }));
      
      setStructuredSizes(newStructuredSizes);
      onChange(jsonValue);
    } catch (error) {
      console.error("Error parsing JSON:", error);
      toast.error("Invalid JSON format");
    }
  };

  const handleAddStandardSize = (sizeName: string) => {
    // Get standard measurements for this size + gender
    const chart = STANDARD_SIZE_CHARTS[gender]
    const standardMeasurements = chart[sizeName] || { chest: 0, length: 0 }

    if (showJsonEditor) {
      // JSON editor mode
      try {
        const currentSizes = value ? JSON.parse(value) : {};

        if (!currentSizes[sizeName]) {
          currentSizes[sizeName] = { ...standardMeasurements };
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
            measurements: Object.entries(standardMeasurements).map(([name, val]) => ({
              name,
              value: val,
            })),
          }
        ];

        updateJsonFromStructured(newStructuredSizes);
      } else {
        toast.error(`Size ${sizeName} already exists`);
      }
    }
  };

  const handleAddAllStandardSizes = () => {
    const chart = STANDARD_SIZE_CHARTS[gender]
    const existingNames = new Set(structuredSizes.map(s => s.name))
    const newSizes: SizeData[] = []

    for (const sizeName of standardSizes) {
      if (!existingNames.has(sizeName)) {
        newSizes.push({
          name: sizeName,
          measurements: Object.entries(chart[sizeName] || {}).map(([name, val]) => ({
            name,
            value: val,
          })),
        })
      }
    }

    if (newSizes.length === 0) {
      toast.error("All standard sizes already exist")
      return
    }

    updateJsonFromStructured([...structuredSizes, ...newSizes])
    toast.success(`Added ${newSizes.length} sizes with ${gender} measurements`)
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
    // Use the selected gender chart's measurement keys with zero values
    const chart = STANDARD_SIZE_CHARTS[gender]
    const sampleKeys = Object.keys(chart["M"] || { chest: 0, length: 0 })

    const newStructuredSizes = [
      ...structuredSizes,
      {
        name: "",
        measurements: sampleKeys.map((name) => ({ name, value: 0 })),
      }
    ];

    updateJsonFromStructured(newStructuredSizes);
  };

  const handleRemoveSize = (index: number) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes.splice(index, 1);
    updateJsonFromStructured(newStructuredSizes);
  };



  const handleSizeNameChange = (sizeIndex: number, newName: string) => {
    const newStructuredSizes = [...structuredSizes];
    newStructuredSizes[sizeIndex].name = newName;
    updateJsonFromStructured(newStructuredSizes);
  };



  /** Every measurement used by any size, in first-seen order: the chart's columns. */
  const columns = Array.from(
    new Set(structuredSizes.flatMap((s) => s.measurements.map((m) => m.name).filter(Boolean)))
  );
  const missingQuick = commonMeasurements.filter((m) => !columns.includes(m));
  const existingSizeNames = new Set(structuredSizes.map((s) => s.name));

  const setCell = (sizeIndex: number, name: string, raw: string) => {
    const next = structuredSizes.map((s, i) => {
      if (i !== sizeIndex) return s;
      const value = raw === "" ? 0 : Number(raw);
      const has = s.measurements.some((m) => m.name === name);
      return {
        ...s,
        measurements: has
          ? s.measurements.map((m) => (m.name === name ? { ...m, value } : m))
          : [...s.measurements, { name, value }],
      };
    });
    updateJsonFromStructured(next);
  };

  const removeColumn = (name: string) =>
    updateJsonFromStructured(
      structuredSizes.map((s) => ({ ...s, measurements: s.measurements.filter((m) => m.name !== name) }))
    );

  const [customColumn, setCustomColumn] = useState("");
  const addCustomColumn = () => {
    const name = customColumn.trim().toLowerCase();
    if (!name) return;
    if (columns.includes(name)) {
      toast.error(`${name} is already a column`);
      return;
    }
    handleAddMeasurement(name);
    setCustomColumn("");
  };

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-y-8 px-6 py-8">
      <div className="flex items-start justify-between gap-x-4">
        <div>
          <Heading level="h2">Sizes</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            One row per size, one column per measurement, in inches.
          </Text>
        </div>
        <div className="flex items-center gap-x-2">
          <Label htmlFor="sizes-json" size="small" className="text-ui-fg-subtle">
            Edit as JSON
          </Label>
          <Switch id="sizes-json" checked={showJsonEditor} onCheckedChange={setShowJsonEditor} />
        </div>
      </div>

      {showJsonEditor ? (
        <div className="flex flex-col gap-y-2">
          <Textarea
            className="min-h-[320px] font-mono text-sm"
            value={value || ""}
            onChange={(e) => {
              onChange(e.target.value);
              // Only update the chart on valid JSON.
              try {
                JSON.parse(e.target.value);
                updateStructuredFromJson(e.target.value);
              } catch {
                // keep typing
              }
            }}
            placeholder={`{\n  "S": { "chest": 36, "length": 28 }\n}`}
          />
          <Text size="xsmall" className="text-ui-fg-subtle">
            Size name → measurement → value.
          </Text>
        </div>
      ) : (
        <>
          <Container className="divide-y p-0">
            <div className="flex flex-col gap-y-3 px-6 py-4">
              <div className="flex items-center justify-between gap-x-4">
                <div>
                  <Text size="small" weight="plus" leading="compact">
                    Start from a standard chart
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle">
                    Adds the size with that chart's measurements filled in.
                  </Text>
                </div>
                <div className="w-40">
                  <Select size="small" value={gender} onValueChange={(v) => setGender(v as GenderType)}>
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="women">Women's</Select.Item>
                      <Select.Item value="men">Men's</Select.Item>
                      <Select.Item value="unisex">Unisex</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {standardSizes.map((size) => (
                  <Button
                    key={size}
                    size="small"
                    variant="secondary"
                    type="button"
                    disabled={existingSizeNames.has(size)}
                    onClick={() => handleAddStandardSize(size)}
                  >
                    {size}
                  </Button>
                ))}
                <Button size="small" variant="transparent" type="button" onClick={handleAddAllStandardSizes}>
                  Add all
                </Button>
              </div>
            </div>
          </Container>

          <Container className="divide-y p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-x-2">
                <Heading level="h2">Size chart</Heading>
                <Badge size="2xsmall">{structuredSizes.length}</Badge>
              </div>
              <Button size="small" variant="secondary" type="button" onClick={handleAddSize}>
                <Plus />
                Add size
              </Button>
            </div>

            {structuredSizes.length === 0 ? (
              <div className="px-6 py-8">
                <Text size="small" className="text-ui-fg-subtle">
                  No sizes yet. Add one, or start from a standard chart above.
                </Text>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell className="w-28">Size</Table.HeaderCell>
                      {columns.map((col) => (
                        <Table.HeaderCell key={col} className="w-28">
                          <div className="flex items-center gap-x-1">
                            <span className="capitalize">{col}</span>
                            <IconButton
                              size="2xsmall"
                              variant="transparent"
                              type="button"
                              aria-label={`Remove ${col}`}
                              onClick={() => removeColumn(col)}
                            >
                              <XMarkMini />
                            </IconButton>
                          </div>
                        </Table.HeaderCell>
                      ))}
                      <Table.HeaderCell className="w-10" />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {structuredSizes.map((size, sizeIndex) => (
                      <Table.Row key={sizeIndex}>
                        <Table.Cell>
                          <Input
                            size="small"
                            className="w-24"
                            value={size.name}
                            placeholder="e.g. M"
                            onChange={(e) => handleSizeNameChange(sizeIndex, e.target.value)}
                          />
                        </Table.Cell>
                        {columns.map((col) => {
                          const m = size.measurements.find((x) => x.name === col);
                          return (
                            <Table.Cell key={col}>
                              <Input
                                size="small"
                                type="number"
                                step="any"
                                inputMode="decimal"
                                className="w-20"
                                value={m ? m.value : ""}
                                placeholder="-"
                                onChange={(e) => setCell(sizeIndex, col, e.target.value)}
                              />
                            </Table.Cell>
                          );
                        })}
                        <Table.Cell>
                          <IconButton
                            size="small"
                            variant="transparent"
                            type="button"
                            aria-label={`Remove size ${size.name || sizeIndex + 1}`}
                            onClick={() => handleRemoveSize(sizeIndex)}
                          >
                            <Trash />
                          </IconButton>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-6 py-4">
              <Text size="small" className="text-ui-fg-subtle mr-1">
                Add a measurement:
              </Text>
              {missingQuick.map((m) => (
                <Button key={m} size="small" variant="secondary" type="button" onClick={() => handleAddMeasurement(m)}>
                  <Plus />
                  <span className="capitalize">{m}</span>
                </Button>
              ))}
              <div className="flex items-center gap-x-2">
                <Input
                  size="small"
                  className="w-36"
                  placeholder="Other, e.g. inseam"
                  value={customColumn}
                  onChange={(e) => setCustomColumn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomColumn();
                    }
                  }}
                />
                <Button size="small" variant="transparent" type="button" onClick={addCustomColumn}>
                  Add
                </Button>
              </div>
            </div>
          </Container>
        </>
      )}
    </div>
  );
};

/**
 * The design's sizes as the editor's `{ label: measurements }` map.
 *
 * 🔴 From `size_sets` (the real table) first; `custom_sizes` is the older JSON
 * copy and can lag it. Falling back keeps designs that only ever had the JSON.
 */
const initialSizes = (design: AdminDesign): CustomSize => {
  if (design.size_sets?.length) {
    return Object.fromEntries(
      design.size_sets.map((z) => [z.size_label, { ...(z.measurements ?? {}) }])
    ) as CustomSize;
  }
  return design.custom_sizes ?? {};
};

/**
 * Edit a design's sizes. Body and footer come from the shell (the
 * `@edit-size` drawer, or the design graph's stacked modal), like the colour
 * editor, so one form serves both. It used a route-only form before, which
 * the graph could not host, so sizes could not be edited from the graph.
 */
export const EditDesignSizes = ({ design }: EditDesignSizesProps) => {
  const Chrome = useModalChrome();
  const { mutateAsync, isPending } = useUpdateDesign(design.id);
  const [json, setJson] = useState(() => customSizeToJsonString(initialSizes(design)));

  const handleSave = async () => {
    const customSizes = jsonStringToCustomSize(json);
    if (Object.keys(customSizes).length === 0) {
      toast.error("Please add at least one size");
      return;
    }
    try {
      const { design: saved } = await mutateAsync({
        custom_sizes: customSizes,
        size_sets: convertCustomSizesToSizeSets(customSizes),
      });
      // Plain words: the old i18n key never existed and the toast printed it raw.
      toast.success(`Sizes saved for ${saved.name}`);
      Chrome.onDone();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not save the sizes");
    }
  };

  return (
    <>
      <Chrome.Body className="flex flex-1 flex-col overflow-y-auto p-0">
        <SizesJsonEditor value={json} onChange={setJson} />
      </Chrome.Body>
      <Chrome.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <Chrome.Close asChild>
            <Button size="small" variant="secondary" type="button">
              Cancel
            </Button>
          </Chrome.Close>
          <Button size="small" type="button" onClick={handleSave} isLoading={isPending}>
            Save
          </Button>
        </div>
      </Chrome.Footer>
    </>
  );
};

export default EditDesignSizes;
