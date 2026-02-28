import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { Button, Heading, Input, Text, toast } from "@medusajs/ui";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useCreatePersonType } from "../../hooks/api/persontype";
import { Form } from "../common/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyboundForm } from "../utilitites/key-bound-form";

const personTypeSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string(),
});

type PersonTypeFormData = z.infer<typeof personTypeSchema>;

export const CreatePersonTypeComponent = () => {
  const form = useForm<PersonTypeFormData>({
    defaultValues: {
      name: "",
      description: "",
    },
    resolver: zodResolver(personTypeSchema),
  });

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useCreatePersonType();

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
      },
      {
        onSuccess: ({ personType }) => {
          toast.success(`Person Type created successfully, ${personType.name}`);
          handleSuccess(`/settings/persontypes/${personType.id}`);
        },
        onError: (error) => {
          toast.error(error.message);
        },
      },
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
              isLoading={isPending}
            >
              Create
            </Button>
          </div>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>{"Define a New Person Type"}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {
                  "Provide a name and optionally a description for the person type."
                }
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="name"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>{"Type Name"}</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  );
                }}
              />
              <Form.Field
                control={form.control}
                name="description"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>{"Description"}</Form.Label>
                      <Form.Control>
                        <Input autoComplete="off" {...field} />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  );
                }}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
