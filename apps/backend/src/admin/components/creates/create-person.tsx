import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "@medusajs/framework/zod";
import { Button, DatePicker, Heading, Input, Text, toast } from "@medusajs/ui";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useCreatePerson } from "../../hooks/api/persons";
import { Form } from "../common/form";
// Import the validators directly to avoid duplication

// Define a form-specific schema with validation rules
const personFormSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  // Allow null for date_of_birth but validate if provided
  date_of_birth: z.union([
    z.date().refine(
      (val) => !isNaN(val.getTime()), 
      { message: "Invalid date format" }
    ),
    z.null()
  ]),
});

type PersonFormData = z.infer<typeof personFormSchema>;

export const CreatePersonComponent = () => {
  const form = useForm<PersonFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      date_of_birth: null,
    },
    resolver: zodResolver(personFormSchema),
  });

  const { handleSuccess } = useRouteModal();

  const { mutateAsync, isPending } = useCreatePerson();

  const handleSubmit = form.handleSubmit(
    async (data) => {
      try {
        // Validate data with the schema before submitting
        const validatedData = personFormSchema.parse(data);
        
        await mutateAsync(
          {
            first_name: validatedData.first_name,
            last_name: validatedData.last_name,
            email: validatedData.email,
            date_of_birth: validatedData.date_of_birth,
          },
          {
            onSuccess: ({ person }) => {
              toast.success(
                `Person created successfully, enjoy with ${person.first_name}`,
              );
              handleSuccess(`/persons/${person.id}`);
            },
            onError: (error) => {
              
              toast.error(error.message);
            },
          },
        );
      } catch (error) {
        // Handle Zod validation errors
        if (error instanceof z.ZodError) {
          error.errors.forEach((err) => {
            const fieldName = err.path.join('.');
            toast.error(`${fieldName}: ${err.message}`);
          });
        } else {
          toast.error('An unexpected error occurred');
          console.error(error);
        }
      }
    },
    (errors) => {
      // This callback handles react-hook-form validation errors
      const firstError = Object.values(errors).find(error => error);
      if (firstError?.message) {
        toast.error(firstError.message);
      }
    }
  );

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
              <Heading className="text-xl md:text-2xl">{"Let's get someone onboarded"}</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
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
                      <Form.Label>{"First Name"}</Form.Label>
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
                      <Form.Label>{"Last Name"}</Form.Label>
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
        <RouteFocusModal.Footer className="px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-col-reverse sm:flex-row justify-end items-center gap-y-2 gap-x-2 w-full">
            <RouteFocusModal.Close asChild>
              <Button size="small" variant="secondary" className="w-full sm:w-auto">
                {"Cancel"}
              </Button>
            </RouteFocusModal.Close>
            <Button
              size="small"
              variant="primary"
              type="submit"
              isLoading={isPending}
              className="w-full sm:w-auto"
            >
              {"Create"}
            </Button>
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
