import { Button, Heading, Input, Text, toast } from "@medusajs/ui";
import { useUpdatePerson } from "../../hooks/api/persons";

import { useForm } from "react-hook-form";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useRouteModal } from "../modal/use-route-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const addressSchema = z.object({
  id: z.string(),
  street: z.string().min(1, "Street is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  postal_code: z.string().min(1, "Postal Code is required"),
  country: z.string().min(1, "Country is required"),
});

type AddressFormData = z.infer<typeof addressSchema>;

const AddAddressForPerson = () => {
  const form = useForm<AddressFormData>({
    defaultValues: {
      id: '',
      street: "",
      city: "",
      state: "",
      postal_code: "",
      country: "",
    },
    resolver: zodResolver(addressSchema),
  });

  const { id } = useParams();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useUpdatePerson(id!);

  const handleSubmit = form.handleSubmit(async (data) => {
    console.log('Form submitted with data:', data);
    try {
     
      const response = await mutateAsync({
        addresses: [data],
      });
      console.log('API response:', response);
      
      if (response?.person) {
        
        toast.success('Address added successfully');
        handleSuccess(`/persons/${id}`);
      } else {
        
        toast.error('Failed to add address: No response from server');
      }
    } catch (error: any) {
      
      toast.error(error?.message || 'Failed to add address');
      // Don't close the modal on error
      return;
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
              <Heading>Add New Address</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Fill in the address details below
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="street"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Street</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="city"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>City</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="state"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>State</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="postal_code"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label >Postal Code</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="country"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label >Country</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
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
              isLoading={isPending}
            >
              Save
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};

export default AddAddressForPerson;
