import { useParams, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "@medusajs/framework/zod";
import { Button, Heading, Input, Label, Select, Textarea, toast } from "@medusajs/ui";
import { RouteDrawer } from "../../../../components/modal/route-drawer/route-drawer";
import { useRouteModal } from "../../../../components/modal/use-route-modal";
import { useDesign, useReviseDesign, AdminDesign } from "../../../../hooks/api/designs";

const reviseSchema = z.object({
  revision_notes: z.string().min(1, "Revision notes are required"),
  name: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Urgent"]).optional(),
  designer_notes: z.string().optional(),
});

type ReviseFormValues = z.infer<typeof reviseSchema>;

const ReviseDesignForm = ({ design }: { design: AdminDesign }) => {
  const navigate = useNavigate();
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

  const onSubmit = async (data: ReviseFormValues) => {
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
      handleSuccess();
      navigate(`/designs/${result.design.id}`, { replace: true });
    } catch (err: any) {
      toast.error(err?.message || "Failed to revise design");
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-y-6 p-6"
    >
      <div className="bg-ui-bg-subtle rounded-lg p-4 mb-2">
        <p className="text-ui-fg-subtle text-sm">
          This will create a new design based on{" "}
          <span className="font-medium text-ui-fg-base">{design.name}</span>{" "}
          and mark the original as superseded. All partner links, colors, sizes,
          and specifications will be copied to the new revision.
        </p>
      </div>

      <div className="flex flex-col gap-y-2">
        <Label htmlFor="revision_notes" className="font-medium">
          What changed? *
        </Label>
        <Textarea
          id="revision_notes"
          placeholder="Describe what needs to change in this revision..."
          {...form.register("revision_notes")}
          className="min-h-[100px]"
        />
        {form.formState.errors.revision_notes && (
          <p className="text-ui-fg-error text-sm">
            {form.formState.errors.revision_notes.message}
          </p>
        )}
      </div>

      <div className="border-t border-ui-border-base pt-4">
        <p className="text-ui-fg-subtle text-sm mb-4">
          Optionally override fields on the new revision:
        </p>

        <div className="flex flex-col gap-y-4">
          <div className="flex flex-col gap-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder={design.name}
              {...form.register("name")}
            />
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={form.watch("priority") || ""}
              onValueChange={(val) =>
                form.setValue("priority", val as any)
              }
            >
              <Select.Trigger>
                <Select.Value placeholder={design.priority || "Select priority"} />
              </Select.Trigger>
              <Select.Content>
                {["Low", "Medium", "High", "Urgent"].map((p) => (
                  <Select.Item key={p} value={p}>
                    {p}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-col gap-y-2">
            <Label htmlFor="designer_notes">Designer Notes</Label>
            <Textarea
              id="designer_notes"
              placeholder="Additional notes for the revised design..."
              {...form.register("designer_notes")}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-x-2 pt-4">
        <RouteDrawer.Close asChild>
          <Button variant="secondary" type="button">
            Cancel
          </Button>
        </RouteDrawer.Close>
        <Button type="submit" isLoading={isPending}>
          Create Revision
        </Button>
      </div>
    </form>
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
      <RouteDrawer.Body>
        <ReviseDesignForm design={design} />
      </RouteDrawer.Body>
    </RouteDrawer>
  );
}
