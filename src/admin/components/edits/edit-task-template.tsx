import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Select, Switch } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { AdminTaskTemplate, useUpdateTaskTemplate } from "../../hooks/api/task-templates";
import { useTaskTemplateCategories } from "../../hooks/api/task-template-categories";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteDrawer } from "../modal/route-drawer/route-drawer";
import { CategorySearch } from "../common/category-search";
import { useState } from "react";
import { toast } from "sonner";

const taskTemplateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  category: z.object({
    id: z.string().optional(),
    name: z.string().min(1, "Category name is required"),
    description: z.string().optional(),
  }),
  estimated_duration: z.number().min(0),
  priority: z.enum(["low", "medium", "high"]),
  eventable: z.boolean(),
  notifiable: z.boolean(),
  message_template: z.string().optional(),
});

type TaskTemplateFormData = z.infer<typeof taskTemplateSchema>;

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type EditTaskTemplateFormProps = {
  template: AdminTaskTemplate;
};

export const EditTaskTemplateForm = ({ template }: EditTaskTemplateFormProps) => {
  const { t } = useTranslation();
  const { handleSuccess } = useRouteModal();
  const [searchQuery, setSearchQuery] = useState("");
  
  const { categories = [] } = useTaskTemplateCategories(
    searchQuery.length >= 3 ? { name: searchQuery } : undefined
  );

  const { mutateAsync, isPending } = useUpdateTaskTemplate(template.id!);

  const form = useForm<TaskTemplateFormData>({
    resolver: zodResolver(taskTemplateSchema),
    defaultValues: {
      name: template.name,
      description: template.description,
      category: {
        id: template.category?.id,
        name: template.category?.name || "",
        description: template.category?.description || "",
      },
      estimated_duration: template.estimated_duration || 0,
      priority: template.priority || "medium",
      eventable: template.eventable || false,
      notifiable: template.notifiable || false,
      message_template: template.message_template || "",
    },
  });

  const selectedCategory = form.watch("category");
  const isNewCategory = !selectedCategory.id && selectedCategory.name;

  const handleSubmit = form.handleSubmit(async (data) => {
    await mutateAsync(
      {
        name: data.name,
        description: data.description,
        category: data.category.id 
          ? { 
              id: data.category.id,
              name: data.category.name,
              description: data.category.description,
            }
          : {
              name: data.category.name,
              description: data.category.description || "",
            },
        priority: data.priority,
        estimated_duration: data.estimated_duration,
        eventable: data.eventable,
        notifiable: data.notifiable,
        message_template: data.message_template,
      },
      {
        onSuccess: ({ task_template }) => {
          toast.success(
            t("taskTemplate.updateSuccess", {
              name: task_template.name,
            })
          );
          handleSuccess();
        },
        onError: (error) => {
          toast.error(error.message);
        },
      }
    );
  });

  return (
    <RouteDrawer.Form form={form}>
      <KeyboundForm
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <RouteDrawer.Body className="flex flex-1 flex-col gap-y-8 overflow-y-auto">
          <div className="flex flex-col gap-y-4">
            <Form.Field
              control={form.control}
              name="name"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("fields.name")}</Form.Label>
                  <Form.Control>
                    <Input {...field} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="description"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("fields.description")}</Form.Label>
                  <Form.Control>
                    <Input {...field} value={field.value || ""} />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            <Form.Field
              control={form.control}
              name="category"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("fields.category")}</Form.Label>
                  <Form.Control>
                    <CategorySearch
                      defaultValue={field.value.name}
                      categories={categories}
                      onSelect={(category) => {
                        if (category) {
                          field.onChange({
                            id: category.id,
                            name: category.name,
                            description: category.description || "",
                          });
                        }
                      }}
                      onValueChange={(value) => {
                        setSearchQuery(value);
                        field.onChange({
                          ...field.value,
                          id: undefined,
                          name: value,
                        });
                      }}
                      error={form.formState.errors.category?.name?.message}
                    />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />

            {isNewCategory && (
              <Form.Field
                control={form.control}
                name="category.description"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.categoryDescription")}</Form.Label>
                    <Form.Control>
                      <Input {...field} value={field.value || ""} />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-x-8">
              <Form.Field
                control={form.control}
                name="priority"
                render={({ field: { value, onChange, ...rest } }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.priority")}</Form.Label>
                    <Form.Control>
                      <Select value={value} onValueChange={onChange} {...rest}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select priority" />
                        </Select.Trigger>
                        <Select.Content>
                          {priorityOptions.map((option) => (
                            <Select.Item key={option.value} value={option.value}>
                              {option.label}
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
                name="estimated_duration"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.estimatedDuration")}</Form.Label>
                    <Form.Control>
                      <Input
                        type="number"
                        autoComplete="off"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>

            <div className="flex flex-col gap-y-4">
              <Form.Field
                control={form.control}
                name="eventable"
                render={({ field: { value, onChange } }) => (
                  <div className="flex items-center justify-between">
                    <div>
                      <Form.Label>{t("fields.eventable")}</Form.Label>
                      <Form.Hint>
                        {t("taskTemplate.eventableDescription")}
                      </Form.Hint>
                    </div>
                    <Switch checked={value} onCheckedChange={onChange} />
                  </div>
                )}
              />

              <Form.Field
                control={form.control}
                name="notifiable"
                render={({ field: { value, onChange } }) => (
                  <div className="flex items-center justify-between">
                    <div>
                      <Form.Label>{t("fields.notifiable")}</Form.Label>
                      <Form.Hint>
                        {t("taskTemplate.notifiableDescription")}
                      </Form.Hint>
                    </div>
                    <Switch checked={value} onCheckedChange={onChange} />
                  </div>
                )}
              />

              <Form.Field
                control={form.control}
                name="message_template"
                render={({ field }) => (
                  <Form.Item>
                    <Form.Label>{t("fields.messageTemplate")}</Form.Label>
                    <Form.Control>
                      <Input
                        {...field}
                        value={field.value || ""}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    </Form.Control>
                    <Form.ErrorMessage />
                  </Form.Item>
                )}
              />
            </div>
          </div>
        </RouteDrawer.Body>
        <RouteDrawer.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteDrawer.Close asChild>
              <Button size="small" variant="secondary">
                {t("actions.cancel")}
              </Button>
            </RouteDrawer.Close>
            <Button size="small" type="submit" isLoading={isPending}>
              {t("actions.save")}
            </Button>
          </div>
        </RouteDrawer.Footer>
      </KeyboundForm>
    </RouteDrawer.Form>
  );
};
