import { useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import {
  Button,
  Heading,
  Input,
  Select,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { useRouteModal } from "../../../../components/modal/use-route-modal";
import { Form } from "../../../../components/common/form";
import { KeyboundForm } from "../../../../components/utilitites/key-bound-form";
import {
  useDesign,
  useReviseDesign,
  AdminDesign,
} from "../../../../hooks/api/designs";

const reviseSchema = z.object({
  revision_notes: z.string().min(1, "Revision notes are required"),
  name: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  designer_notes: z.string().optional(),
});

type ReviseFormValues = z.infer<typeof reviseSchema>;

const PRIORITY_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Urgent", label: "Urgent" },
];

const ReviseDesignForm = ({ design }: { design: AdminDesign }) => {
  const { handleSuccess } = useRouteModal();
  const { mutateAsync: revise, isPending } = useReviseDesign(design.id);

  const form = useForm<ReviseFormValues>({
    resolver: zodResolver(reviseSchema),
    defaultValues: {
      revision_notes: "",
      name: "",
      priority: undefined,
      designer_notes: "",
    },
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    const overrides: Record<string, any> = {};
    if (data.name) overrides.name = data.name;
    if (data.priority) overrides.priority = data.priority;
    if (data.designer_notes) overrides.designer_notes = data.designer_notes;

    try {
      const result = await revise({
        revision_notes: data.revision_notes,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      });
      toast.success("Design revised successfully");
      handleSuccess(`/designs/${result.design.id}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to revise design");
    }
  });

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <div className="bg-ui-bg-subtle rounded-lg p-4">
            <Text size="small" className="text-ui-fg-subtle">
              This will create a new design based on{" "}
              <span className="font-medium text-ui-fg-base">
                {design.name}
              </span>{" "}
              and mark the original as superseded. All partner links, colors,
              sizes, and specifications will be copied to the new revision.
            </Text>
          </div>

          <Form.Field
            control={form.control}
            name="revision_notes"
            render={({ field }) => (
              <Form.Item>
                <Form.Label>What changed?</Form.Label>
                <Form.Control>
                  <Textarea
                    {...field}
                    placeholder="Describe what needs to change in this revision..."
                    className="min-h-[100px]"
                  />
                </Form.Control>
                <Form.ErrorMessage />
              </Form.Item>
            )}
          />

          <div className="border-t border-ui-border-base pt-4 flex flex-col gap-y-4">
            <Text size="small" className="text-ui-fg-subtle">
              Optionally override fields on the new revision:
            </Text>

            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Name</Form.Label>
                  <Form.Control>
                    <Input {...field} placeholder={design.name} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="priority"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Priority</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value || ""}
                      onValueChange={field.onChange}
                    >
                      <Select.Trigger>
                        <Select.Value
                          placeholder={design.priority || "Select priority"}
                        />
                      </Select.Trigger>
                      <Select.Content>
                        {PRIORITY_OPTIONS.map((opt) => (
                          <Select.Item key={opt.value} value={opt.value}>
                            {opt.label}
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
              name="designer_notes"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>Designer Notes</Form.Label>
                  <Form.Control>
                    <Textarea
                      {...field}
                      placeholder="Additional notes for the revised design..."
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
          </div>
        </RouteDrawer.Body>

        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                Cancel
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              Create Revision
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  );
};

export default function ReviseDesignPage() {
  const { id } = useParams();
  const { design, isLoading } = useDesign(id!);

  if (isLoading || !design) return null;

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>Revise Design</Heading>
      </RouteDrawer.Header>
      <ReviseDesignForm design={design} />
    </RouteDrawer>
  );
}
