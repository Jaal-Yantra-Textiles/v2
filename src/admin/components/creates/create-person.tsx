import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, DatePicker, Heading, Input, Text, toast } from "@medusajs/ui";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreatePerson } from "../../hooks/api/persons";
import { Form } from "../common/form";

const personSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().email(),
  date_of_birth: z.date().nullable(),
});

type PersonFormData = z.infer<typeof personSchema>;

export const CreatePersonComponent = () => {
  const form = useForm<PersonFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      date_of_birth: null,
    },
  });

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useCreatePerson();

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email,
        date_of_birth: data.date_of_birth,
        metadata: {}
      },
      {
        onSuccess: ({ person }) => {
          toast.success(
            `Person created succesfully, enjoy with ${person.first_name}`,
          );
          handleSuccess(`/persons/${person.id}`);
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
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteFocusModal.Header />
        <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-16">
          <div className="flex w-full max-w-[720px] flex-col gap-y-8">
            <div>
              <Heading>{"Lets get someone onboarded"}</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                {"It will be fun"}
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="first_name"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>{"First Name"}</Form.Label>
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
                name="last_name"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>{"Last Name"}</Form.Label>
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
                name="email"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label>{"Email"}</Form.Label>
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
                name="date_of_birth"
                render={({ field }) => {
                  return (
                    <Form.Item>
                      <Form.Label optional>{"Date of Birth"}</Form.Label>
                      <Form.Control>
                        <DatePicker
                          value={field.value}
                          onChange={(date) => {
                            field.onChange(date);
                          }}
                        />
                      </Form.Control>
                      <Form.ErrorMessage />
                    </Form.Item>
                  );
                }}
              />
            </div>
          </div>
        </RouteFocusModal.Body>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary">
                {"Cancel"}
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
            >
              {"Create"}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
