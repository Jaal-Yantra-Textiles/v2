import { Button, Heading, Input, Select, Text, toast } from "@medusajs/ui";
import { useAddContactToPerson } from "../../hooks/api/person-contacts";

import { useForm } from "react-hook-form";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useRouteModal } from "../modal/use-route-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const contactSchema = z.object({
  phone_number: z.string().min(1, "Phone number is required"),
  type: z.enum(["mobile", "home", "work"], {
    required_error: "Contact type is required",
  }),
});

type ContactFormData = z.infer<typeof contactSchema>;

const AddContactForPerson = () => {
  const form = useForm<ContactFormData>({
    defaultValues: {
      phone_number: "",
      type: "mobile",
    },
    resolver: zodResolver(contactSchema),
  });

  const { id } = useParams();
  const { handleSuccess } = useRouteModal();
  const { mutateAsync, isPending } = useAddContactToPerson(id!);

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      const response = await mutateAsync(data);
      
      if (response?.contact) {
        toast.success('Contact added successfully');
        handleSuccess(`/persons/${id}`);
      } else {
        toast.error('Failed to add contact: No response from server');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add contact');
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
              <Heading>Add New Contact</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Fill in the contact details below
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="phone_number"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Phone Number</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Type</Form.Label>
                    <Form.Control>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <Select.Trigger>
                          <Select.Value placeholder="Select a contact type" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="mobile">Mobile</Select.Item>
                          <Select.Item value="home">Home</Select.Item>
                          <Select.Item value="work">Work</Select.Item>
                        </Select.Content>
                      </Select>
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

export default AddContactForPerson;
