import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Heading, Input, Text, toast } from "@medusajs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { sdk } from "../../lib/config";

// Mirrors CreateCrmPersonSchema in api/admin/crm/people/validators.ts. Email is
// optional but must be a valid address when present — the API rejects "" (it is
// `.email().nullish()`), so empty optionals are stripped before POST.
const crmPersonSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Enter a valid email").or(z.literal("")),
  phone: z.string(),
  title: z.string(),
  company_id: z.string(),
});

type CrmPersonFormData = z.infer<typeof crmPersonSchema>;

type CrmPerson = {
  id: string;
  first_name: string;
  last_name: string;
};

export const CreateCrmPersonComponent = () => {
  const form = useForm<CrmPersonFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      title: "",
      company_id: "",
    },
    resolver: zodResolver(crmPersonSchema),
  });

  const { handleSuccess } = useRouteModal();
  const queryClient = useQueryClient();

  const { mutateAsync, isPending } = useMutation({
    mutationFn: (body: Record<string, string | undefined>) =>
      sdk.client.fetch<{ crm_person: CrmPerson }>("/admin/crm/people", {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      // Prefix-match invalidates every paged/filtered crm-people query.
      queryClient.invalidateQueries({ queryKey: ["crm-people"] });
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    // Send only populated optionals — the API's email/phone/etc. are nullish,
    // and "" is not a valid email.
    const body = {
      first_name: data.first_name.trim(),
      last_name: data.last_name.trim(),
      email: data.email.trim() || undefined,
      phone: data.phone.trim() || undefined,
      title: data.title.trim() || undefined,
      company_id: data.company_id.trim() || undefined,
    };

    await mutateAsync(body, {
      onSuccess: ({ crm_person }) => {
        const name = [crm_person.first_name, crm_person.last_name]
          .filter(Boolean)
          .join(" ");
        toast.success(`Contact created${name ? `: ${name}` : ""}`);
        handleSuccess(`/crm/${crm_person.id}`);
      },
      onError: (error) => {
        toast.error((error as Error).message);
      },
    });
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
              <Heading>Add a Contact</Heading>
              <Text size="small" className="text-ui-fg-subtle">
                Create a new person on the multi-writer CRM node.
              </Text>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Form.Field
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>First Name</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>Last Name</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="email"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Email</Form.Label>
                    <Form.Control>
                      <Input type="email" autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Phone</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="title"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Title</Form.Label>
                    <Form.Control>
                      <Input autoComplete="off" {...field} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
              <Form.Field
                control={form.control}
                name="company_id"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label optional>Company ID</Form.Label>
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
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
