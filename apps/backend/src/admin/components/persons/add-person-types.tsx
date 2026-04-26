import { Badge, Button, Heading, Text, toast } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { useParams } from "react-router-dom";
import { Select } from "@medusajs/ui";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { usePersonTypes } from "../../hooks/api/persontype";
import { AdminPersonType } from "../../hooks/api/personandtype";
import { useAddPersonTypes } from "../../hooks/api/persons";

const personTypesSchema = z.object({
  types: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })).min(1, "At least one person type must be selected"),
});

type PersonTypesFormData = z.infer<typeof personTypesSchema>;

const AddPersonTypes = () => {
  const { id } = useParams();
  const { handleSuccess } = useRouteModal();
  
  const { personTypes, isLoading } = usePersonTypes();
  const addPersonTypesMutation = useAddPersonTypes(id!);
  
  const form = useForm<PersonTypesFormData>({
    defaultValues: {
      types: [],
    },
    resolver: zodResolver(personTypesSchema),
  });

  const { setValue, watch } = form;
  const selectedTypes = watch("types") || [];
  


  const handleTypeSelect = (typeValue: string) => {
    const typeObj = personTypes?.find((type: AdminPersonType) => type.id === typeValue);
    
    if (typeObj && !selectedTypes.some(t => t.id === typeObj.id)) {
      setValue("types", [...selectedTypes, { id: typeObj.id, name: typeObj.name }]);
    }
  };

  const handleRemoveType = (typeId: string) => {
    setValue("types", selectedTypes.filter(t => t.id !== typeId));
  };

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await addPersonTypesMutation.mutateAsync({
        personTypeIds: data.types.map(t => t.id)
      });
      
      toast.success("Person types added successfully");
      handleSuccess(`/persons/${id}`);
    } catch (error: any) {
      toast.error(error?.message || "Failed to add person types");
    }
  });

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>Add Person Types</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Select the types for this person
              </Text>
            </div>
            <div className="flex flex-col gap-y-4">
              <Form.Field
                control={form.control}
                name="types"
                render={() => (
                  <Form.Item>
                    <Form.Label>Person Types</Form.Label>
                    <Form.Control>
                      <div className="flex flex-col gap-y-2">
                        <Select
                          disabled={isLoading}
                          value=""
                          onValueChange={handleTypeSelect}
                          size="small"
                        >
                          <Select.Trigger>
                            <Select.Value placeholder="Select person types" />
                          </Select.Trigger>
                          <Select.Content>
                            {personTypes?.map((type: AdminPersonType) => {
                              // Check if this type is already selected
                              const isSelected = selectedTypes.some(t => t.id === type.id);
                              
                              return (
                                <Select.Item 
                                  key={type.id} 
                                  value={type.id}
                                  disabled={isSelected}
                                >
                                  {type.name}{isSelected ? ' (Selected)' : ''}
                                </Select.Item>
                              );
                            })}
                          </Select.Content>
                        </Select>
                        
                        {selectedTypes.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-4">
                            {selectedTypes.map((type) => (
                              <Badge key={type.id} color="green" className="flex items-center gap-x-1">
                                <span>{type.name}</span>
                                <button
                                  type="button"
                                  className="text-ui-fg-subtle hover:text-ui-fg-base ml-1"
                                  onClick={() => handleRemoveType(type.id)}
                                >
                                  ×
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
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
              isLoading={addPersonTypesMutation.isPending}
              disabled={selectedTypes.length === 0}
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

export default AddPersonTypes;
