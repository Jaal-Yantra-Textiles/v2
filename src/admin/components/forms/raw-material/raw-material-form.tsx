import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { RawMaterialFormType, rawMaterialFormSchema } from "./schema"
import { Form } from "../../common/form"
import { Button, Input, Select, Textarea, toast } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { RouteFocusModal } from "../../modal/route-focus-modal"
import { KeyboundForm } from "../../utilitites/key-bound-form"
import { useCreateRawMaterial } from "../../../hooks/api/raw-materials"
import { Heading, Text } from "@medusajs/ui"
import { useRouteModal } from "../../modal/use-route-modal"

export const RawMaterialForm = () => {
  const { id: inventoryId } = useParams();
  const { handleSuccess } = useRouteModal();

  const form = useForm<RawMaterialFormType>({
    resolver: zodResolver(rawMaterialFormSchema),
    defaultValues: {
      status: "Active",
      unit_of_measure: "Other",
      material_type: {
        category: "Other",
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
        className="flex flex-col overflow-hidden"
      >
        <RouteFocusModal.Header>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={createMutation.isPending}
            >
              Create
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>{"Add New Raw Material"}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {"Enter the details of the raw material including its specifications and requirements."}
              </Text>
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
                        <Input autoComplete="off" {...field} placeholder="e.g., 100% Cotton" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>

              <div className="mt-4">
                <Form.Field
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{"Description"}</Form.Label>
                      <Form.Control>
                        <Textarea {...field} placeholder="Enter detailed description" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>

            {/* Material Specifications */}
            <div>
              <Text className="mb-4 font-semibold">Material Specifications</Text>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{"Color"}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
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
                      <Form.Label optional>{"Width"}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{"Weight"}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
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
                      <Form.Label optional>{"Grade"}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>

            {/* Requirements and Guidelines */}
            <div>
              <Text className="mb-4 font-semibold">Requirements and Guidelines</Text>
              <div className="grid grid-cols-1 gap-4">
                <Form.Field
                  control={form.control}
                  name="usage_guidelines"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{"Usage Guidelines"}</Form.Label>
                      <Form.Control>
                        <Textarea {...field} placeholder="Enter usage guidelines and instructions" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="storage_requirements"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{"Storage Requirements"}</Form.Label>
                      <Form.Control>
                        <Textarea {...field} placeholder="Enter storage requirements and conditions" />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>

            {/* Order and Status */}
            <div>
              <Text className="mb-4 font-semibold">Order Details and Status</Text>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="unit_of_measure"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{"Unit of Measure"}</Form.Label>
                      <Form.Control>
                        <Select {...field}>
                          <option value="Meter">Meter</option>
                          <option value="Yard">Yard</option>
                          <option value="Kilogram">Kilogram</option>
                          <option value="Gram">Gram</option>
                          <option value="Piece">Piece</option>
                          <option value="Roll">Roll</option>
                          <option value="Other">Other</option>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{"Status"}</Form.Label>
                      <Form.Control>
                        <Select {...field}>
                          <option value="Active">Active</option>
                          <option value="Discontinued">Discontinued</option>
                          <option value="Under_Review">Under Review</option>
                          <option value="Development">Development</option>
                        </Select>
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />

                <Form.Field
                  control={form.control}
                  name="minimum_order_quantity"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label optional>{"Minimum Order Quantity"}</Form.Label>
                      <Form.Control>
                        <Input 
                          type="number" 
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
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
                      <Form.Label optional>{"Lead Time (Days)"}</Form.Label>
                      <Form.Control>
                        <Input 
                          type="number" 
                          {...field}
                          onChange={e => field.onChange(Number(e.target.value))}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  )}
                />
              </div>
            </div>

            {/* Material Type */}
            <div>
              <Text className="mb-4 font-semibold">Material Type</Text>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Form.Field
                  control={form.control}
                  name="material_type.name"
                  render={({ field }) => (
                    <Form.Item>
                      <Form.Label>{"Type Name"}</Form.Label>
                      <Form.Control>
                        <Input {...field} />
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
                            defaultValue={field.value}
                          >
                            <Select.Trigger>
                              <Select.Value placeholder="Select a Category" />
                            </Select.Trigger>
                            <Select.Content>
                              {categories.map((item) => (
                                <Select.Item key={item.value} value={item.value}>
                                  {item.label}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select>
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />

                <div className="col-span-2">
                  <Form.Field
                    control={form.control}
                    name="material_type.description"
                    render={({ field }) => (
                      <Form.Item>
                        <Form.Label optional>{"Type Description"}</Form.Label>
                        <Form.Control>
                          <Textarea {...field} placeholder="Enter material type description" />
                        </Form.Control>
                        <Form.ErrorMessage />
                      </Form.Item>
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
