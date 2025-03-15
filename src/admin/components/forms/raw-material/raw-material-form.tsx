import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { RawMaterialFormType, rawMaterialFormSchema } from "./schema"
import { Form } from "../../common/form"
import { Input, Select, Textarea, toast, ProgressTabs, ProgressStatus, Button, Heading } from "@medusajs/ui"
import { useParams, useNavigate } from "react-router-dom"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { useCreateRawMaterial } from "../../../hooks/api/raw-materials"
import { Text } from "@medusajs/ui"
import { useRouteModal } from "../../modal/use-route-modal"
import { useState, useEffect } from "react"

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

  const form = useForm<RawMaterialFormType>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: {
      status: "Active",
      unit_of_measure: "Other",
      material_type: {
        category: "Other",
        name: "", // Required field according to schema
      },
    },
  });

  const categories = [
    {
      value: "Fiber",
      label: "Fiber"
    },
    {
      value: "Yarn",
      label: "Yarn"
    },
    {
      value: "Fabric",
      label: "Fabric"
    },
    {
      value: "Trim",
      label: "Trim"
    },
    {
      value: "Dye",
      label: "Dye"
    },
    {
      value: "Chemical",
      label: "Chemical"
    },
    {
      value: "Accessory",
      label: "Accessory"
    },
    {
      value: "Other",
      label: "Other"
    }
  ];

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
    await createMutation.mutateAsync(
      {
        rawMaterialData:{
          ...data,
          material_type: data.material_type,
        }
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
                  <Text className="mb-4 font-semibold">Basic Information</Text>
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
                              value={field.value}
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

                {/* Additional Information */}
                <div>
                  <Text className="mb-4 font-semibold">Additional Information</Text>
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

                {/* Status */}
                <div>
                  <Text className="mb-4 font-semibold">Status</Text>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Status"}</Form.Label>
                          <Form.Control>
                            <Select
                              value={field.value}
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
                  <Text className="mb-4 font-semibold">Material Type Configuration</Text>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Form.Field
                      control={form.control}
                      name="material_type.name"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Material Type Name"}</Form.Label>
                          <Form.Control>
                            <Input autoComplete="off" {...field} />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="material_type.category"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Category"}</Form.Label>
                          <Form.Control>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <Select.Trigger>
                                <Select.Value placeholder="Select Category" />
                              </Select.Trigger>
                              <Select.Content>
                                {categories.map((category) => (
                                  <Select.Item key={category.value} value={category.value}>
                                    {category.label}
                                  </Select.Item>
                                ))}
                              </Select.Content>
                            </Select>
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )}
                    />

                    <Form.Field
                      control={form.control}
                      name="material_type.description"
                      render={({ field }) => (
                        <Form.Item>
                          <Form.Label>{"Material Type Description"}</Form.Label>
                          <Form.Control>
                            <Textarea
                              className="min-h-[100px]"
                              placeholder="Description of the material type"
                              {...field}
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
