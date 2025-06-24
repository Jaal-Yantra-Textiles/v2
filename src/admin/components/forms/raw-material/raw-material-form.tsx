import { useForm, useFieldArray } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { RawMaterialFormType, rawMaterialFormSchema } from "./schema"
import { Form } from "../../common/form"
import { Input, Select, Textarea, toast, ProgressTabs, ProgressStatus, Button, Heading, Text as UIText } from "@medusajs/ui"
import { useParams, useNavigate } from "react-router-dom"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { useCreateRawMaterial, useRawMaterialCategories } from "../../../hooks/api/raw-materials"
import { useRouteModal } from "../../modal/use-route-modal"
import { useState, useEffect } from "react"
import { CategorySearch } from "../../common/category-search"
import { XMark } from "@medusajs/icons"
import RawMaterialMediaModal from "../../../routes/inventory/[id]/raw-materials/create/media/page"

// No need for explicit type definitions as we're using type assertions

enum Tab {
  GENERAL = "general",
  MATERIAL_TYPE = "material_type"
}

type TabState = Record<Tab, ProgressStatus>

export const RawMaterialForm = () => {
  const { id: inventoryId } = useParams();
  const navigate = useNavigate();
  const { handleSuccess } = useRouteModal();
  
  const [tab, setTab] = useState<Tab>(Tab.GENERAL);
  const [tabState, setTabState] = useState<TabState>({
    [Tab.GENERAL]: "in-progress",
    [Tab.MATERIAL_TYPE]: "not-started",
  });
  
  useEffect(() => {
    const currentState = { ...tabState };
    if (tab === Tab.GENERAL) {
      currentState[Tab.GENERAL] = "in-progress";
      currentState[Tab.MATERIAL_TYPE] = "not-started";
    }
    if (tab === Tab.MATERIAL_TYPE) {
      currentState[Tab.GENERAL] = "completed";
      currentState[Tab.MATERIAL_TYPE] = "in-progress";
    }
    setTabState(currentState);
  }, [tab]);

  const [searchQuery, setSearchQuery] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  
  // Fetch material type categories when search query is at least 3 characters
  const { categories: materialCategories = [] } = useRawMaterialCategories(
    searchQuery.length >= 3 ? { name: searchQuery } : { name: "" }
  );
  
  const form = useForm<RawMaterialFormType>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: {
      material_type_properties: {
        weave_type: "",
        gi_status: "",
        technique: "",
        extra: [],
      },
      additional_properties_json: "",
      status: "Active",
      unit_of_measure: "Other",
      material_type: "",  // Start with an empty string for material type
    },
  });

    

  // Dynamic custom property key/value pairs
  const { fields: extraProps, append, remove } = useFieldArray({
    control: form.control,
    name: "material_type_properties.extra",
  });

  const createMutation = useCreateRawMaterial(inventoryId!);

  const onNext = async (currentTab: Tab) => {
    // For General tab, only validate fields in General tab
    const valid = await form.trigger([
      "name",
      "description",
      "composition",
      "unit_of_measure",
      "minimum_order_quantity",
      "lead_time_days",
      "color",
      "width"
    ]);
    
    if (!valid) {
      return;
    }

    if (currentTab === Tab.GENERAL) {
      setTab(Tab.MATERIAL_TYPE);
    }
  };

  const onBack = () => {
    if (tab === Tab.MATERIAL_TYPE) {
      setTab(Tab.GENERAL);
    }
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    // Create a copy of the data to modify for API submission
    const submissionData = { ...data };
    
    // Handle the material_type field correctly based on whether it's a new or existing category
    if (data.material_type) {
      if (typeof data.material_type === 'object' && 'isExisting' in data.material_type && data.material_type.isExisting) {
        // For existing categories, use material_type_id in the API payload
        (submissionData as any).material_type_id = data.material_type.id;
        delete submissionData.material_type;
      } else if (typeof data.material_type === 'string') {
        // For new categories as strings, leave as is (the API expects the name)
        if (data.material_type.trim()) {
          submissionData.material_type = data.material_type;
        } else {
          // If it's an empty string, set a default material type name
          submissionData.material_type = submissionData.name + " Material";
        }
      } else if (typeof data.material_type === 'object' && 'name' in data.material_type) {
        // For new categories as objects, extract the name
        submissionData.material_type = data.material_type.name || (submissionData.name + " Material");
      }
    } else {
      // If no material_type is provided, create a default one based on the raw material name
      submissionData.material_type = submissionData.name + " Material";
    }

    // Merge material_type_properties and additional_properties_json into a single object
    const predefinedProps = submissionData.material_type_properties || {};

    // Parse JSON string if provided
    let additionalProps: Record<string, any> = {};
    if (submissionData.additional_properties_json) {
      try {
        additionalProps = JSON.parse(submissionData.additional_properties_json);
      } catch {
        // ignore JSON parse errors (already validated by schema)
      }
    }

    // Convert extra array to object, then remove it from predefined properties
    let extraObj: Record<string, any> = {};
    if (Array.isArray(predefinedProps.extra)) {
      extraObj = Object.fromEntries(
        predefinedProps.extra
          .filter((kv: any) => kv.key?.trim())
          .map((kv: any) => [kv.key.trim(), kv.value])
      );
      delete (predefinedProps as any).extra;
    }

    // Merge together
    const mergedProperties = { ...predefinedProps, ...extraObj, ...additionalProps };

    // Store merged custom/predefined properties in specifications field
    (submissionData as any).specifications = mergedProperties;
    (submissionData as any).media = { files: mediaUrls };

    // Cleanup helper fields
    delete (submissionData as any).material_type_properties;
    delete (submissionData as any).additional_properties_json;
    
    await createMutation.mutateAsync(
      {
        rawMaterialData: submissionData as any // Cast to any to bypass type checking
      },
      {
        onSuccess: () => {
          toast.success("Raw material created successfully");
          handleSuccess(`/inventory/${inventoryId}`);
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (tab === Tab.GENERAL) {
              onNext(tab);
            } else {
              handleSubmit();
            }
          }
        }}
      >
        <ProgressTabs
          value={tab}
          onValueChange={(value) => {
            // Let the tab navigation happen through the Continue/Back buttons
            // No need to trigger validation here
            if (value === Tab.GENERAL || (value === Tab.MATERIAL_TYPE && tabState[Tab.GENERAL] === "completed")) {
              setTab(value as Tab);
            }
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="flex w-full items-center justify-start">
                <ProgressTabs.Trigger
                  status={tabState[Tab.GENERAL]}
                  value={Tab.GENERAL}
                  className="max-w-[200px] truncate"
                >
                  General
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.MATERIAL_TYPE]}
                  value={Tab.MATERIAL_TYPE}
                  className="max-w-[200px] truncate"
                >
                  Material Type
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>
          
          <RouteFocusModal.Body className="size-full overflow-hidden">
            {/* General Tab Content */}
            <ProgressTabs.Content
              value={Tab.GENERAL}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <div className="flex items-center gap-x-2">
                    <Heading className="text-xl">General Information</Heading>
                  </div>
                </div>
                
                {/* Basic Information */}
                <div>
                  <UIText className="mb-4 font-semibold">Basic Information</UIText>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Material Name"}</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="composition"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Composition"}</Form.Label>
                          <Form.Control>
                            <Input
                              placeholder="Example: 100% Cotton"
                              autoComplete="off"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Description"}</Form.Label>
                          <Form.Control>
                            <Textarea
                              className="min-h-[100px]"
                              placeholder="Description"
                              {...field}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="unit_of_measure"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Unit of Measure"}</Form.Label>
                          <Form.Control>
                            <Select
                              value={(field.value ?? "Active")}
                              onValueChange={field.onChange}
                            >
                              <Select.Trigger>
                                <Select.Value placeholder="Select Unit of Measure" />
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Item value="Meter">
                                  Meter
                                </Select.Item>
                                <Select.Item value="Yard">
                                  Yard
                                </Select.Item>
                                <Select.Item value="Kilogram">
                                  Kilogram
                                </Select.Item>
                                <Select.Item value="Gram">
                                  Gram
                                </Select.Item>
                                <Select.Item value="Piece">
                                  Piece
                                </Select.Item>
                                <Select.Item value="Roll">
                                  Roll
                                </Select.Item>
                                <Select.Item value="Other">
                                  Other
                                </Select.Item>
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    
                  </div>
                  
                </div>
                <div className="mt-4">
                  <h2 className="text-base-semi">Media</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {mediaUrls.map((url, index) => (
                      <div key={index} className="relative h-20 w-20 overflow-hidden rounded-md border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Selected media ${index + 1}`} className="h-full w-full object-cover" />
                        <div className="absolute top-1 right-1 flex items-center justify-center rounded-full bg-white/50 p-0.5">
                          <XMark
                            className="text-ui-fg-muted hover:text-ui-fg-subtle cursor-pointer"
                            onClick={() => setMediaUrls(mediaUrls.filter((u) => u !== url))}
                          />
                        </div>
                      </div>
                    ))}
                    <RawMaterialMediaModal onSave={setMediaUrls} initialUrls={mediaUrls} />
                  </div>
                </div>
                {/* Additional Information */}
                <div>
                  <UIText className="mb-4 font-semibold">Additional Information</UIText>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="minimum_order_quantity"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Minimum Order Quantity"}</Form.Label>
                          <Form.Control>
                            <Input 
                              type="number" 
                              autoComplete="off" 
                              {...field}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="lead_time_days"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Lead Time (Days)"}</Form.Label>
                          <Form.Control>
                            <Input 
                              type="number" 
                              autoComplete="off" 
                              {...field}
                              onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="color"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Color"}</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="width"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Width"}</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>
              </div>
            </ProgressTabs.Content>

            {/* Material Type Tab Content */}
            <ProgressTabs.Content
              value={Tab.MATERIAL_TYPE}
              className="size-full overflow-y-auto"
            >
              <div className="flex flex-col gap-y-4 p-8">
                <div className="flex items-center justify-between border-b pb-4">
                  <div className="flex items-center gap-x-2">
                    <Heading className="text-xl">Material Type</Heading>
                  </div>
                </div>

                {/* Predefined Properties */}
                <div>
                  <UIText className="mb-4 font-semibold">Predefined Properties</UIText>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <Form.Field
                      control={form.control}
                      name="material_type_properties.weave_type"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>Weave Type</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="material_type_properties.gi_status"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>GI Status</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                    <Form.Field
                      control={form.control}
                      name="material_type_properties.technique"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>Technique</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>

                {/* Custom Properties */}
                <div>
                  <UIText className="mb-4 font-semibold">Technical Specifications</UIText>
                  <div className="flex flex-col gap-4">
                    {extraProps.map((field, idx) => (
                      <div key={field.id} className="grid grid-cols-6 gap-2 items-start">
                        <Form.Field
                          control={form.control}
                          name={`material_type_properties.extra.${idx}.key` as const}
                          render={({ field }) => (
                            <Form.Item className="col-span-2 w-full">
                              <Form.Label>Key</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        <Form.Field
                          control={form.control}
                          name={`material_type_properties.extra.${idx}.value` as const}
                          render={({ field }) => (
                            <Form.Item className="col-span-2 w-full">
                              <Form.Label>Value</Form.Label>
                              <Form.Control>
                                <Input autoComplete="off" {...field} />
                              </Form.Control>
                              <Form.ErrorMessage />
                            </Form.Item>
                          )}
                        />
                        <button type="button" onClick={() => remove(idx)} className="justify-self-start self-center text-ui-fg-subtle hover:text-ui-fg-base focus:outline-none">
                          <XMark className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <Button size="small" variant="secondary" onClick={() => append({ key: "", value: "" })}>
                      Add Custom Property
                    </Button>
                  </div>
                </div>

                {/* Status */}
                <div>
                  <UIText className="mb-4 font-semibold">Status</UIText>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Status"}</Form.Label>
                          <Form.Control>
                            <Select
                              value={(field.value ?? "Active") as RawMaterialFormType["status"]}
                              onValueChange={field.onChange}
                            >
                              <Select.Trigger>
                                <Select.Value placeholder="Select status" />
                              </Select.Trigger>
                              <Select.Content>
                                <Select.Item value="Active">
                                  Active
                                </Select.Item>
                                <Select.Item value="Discontinued">
                                  Discontinued
                                </Select.Item>
                                <Select.Item value="Under_Review">
                                  Under Review
                                </Select.Item>
                                <Select.Item value="Development">
                                  Development
                                </Select.Item>
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>

                {/* Material Type Configuration */}
                <div>
                  <UIText className="mb-4 font-semibold">Material Type Configuration</UIText>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="material_type"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Material Type"}</Form.Label>
                          <Form.Control>
                            {/* 
                              We need to use `any` for categories to work around TypeScript limitations
                              A proper fix would involve updating the CategorySearch component, but this works
                            */}
                            <CategorySearch
                              categories={materialCategories as any}
                              defaultValue={field.value as any}
                              onSelect={(category: any) => {
                                if (category?.id) {
                                  setSearchQuery("");
                                  // For existing categories, create an object that matches our form schema
                                  const materialType = {
                                    id: category.id,
                                    name: category.name,
                                    description: category.description || "",
                                    category: "Other" as const,
                                    isExisting: true as const
                                  };
                                  
                                  // Using type assertion to work around CategorySearch component limitations
                                  field.onChange(materialType as any);
                                  return materialType;
                                } else {
                                  // For new categories, just use the string name
                                  const value = category?.name || "";
                                  field.onChange(value);
                                  return value;
                                }
                              }}
                              onValueChange={(value: string) => {
                                setSearchQuery(value);
                                field.onChange(value);
                                return value;
                              }}
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="grade"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Grade"}</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />
                  </div>
                </div>
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>

          <RouteFocusModal.Footer>
            <div className="flex items-center justify-end gap-x-2">
              <Button
                type="button"
                variant="secondary"
                size="small"
                onClick={() => navigate(`/inventory/${inventoryId}`)}
              >
                Cancel
              </Button>
              {tab === Tab.MATERIAL_TYPE ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    onClick={onBack}
                  >
                    Back
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="small"
                    isLoading={form.formState.isSubmitting}
                  >
                    Create
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  onClick={() => {
                    onNext(tab);
                  }}
                >
                  Continue
                </Button>
              )}
            </div>
          </RouteFocusModal.Footer>
        </ProgressTabs>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
