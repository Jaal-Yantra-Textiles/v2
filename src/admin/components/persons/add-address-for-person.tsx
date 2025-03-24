import { Button, Heading, Input, Text, toast } from "@medusajs/ui";
import { useAddAddressToPerson } from "../../hooks/api/persons";

import { useForm } from "react-hook-form";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useRouteModal } from "../modal/use-route-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const addressSchema = z.object({
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
  const { mutateAsync, isPending } = useAddAddressToPerson(id!);

  const handleSubmit = form.handleSubmit(async (data) => {
    console.log('Form submitted with data:', data);
    try {
      const response = await mutateAsync(data);
      console.log('API response:', response);
      
      if (response?.address) {
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
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
          <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
            <div>
              <Heading className="text-xl md:text-2xl">Add New Address</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
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
        <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" className="w-full sm:w-auto">
                Cancel
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
              className="w-full sm:w-auto"
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
