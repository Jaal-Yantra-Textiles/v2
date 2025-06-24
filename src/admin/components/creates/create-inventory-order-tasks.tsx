import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Badge,
  Button,
  Container,
  Heading,
  RadioGroup,
  Select,
  Text,
  toast,
} from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useRouteModal } from "../modal/use-route-modal";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { Form } from "../common/form";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { useMemo } from "react";
import {
  AdminTaskTemplate,
  TaskCategory,
  useTaskTemplates,
} from "../../hooks/api/task-templates";
import { useCreateInventoryOrderTasks } from "../../hooks/api/inventory-orders";
import { TaskTemplateCanvas } from "../tasks/task-template-canvas";

// Schema
const templateSchema = z.object({
  category_id: z.string().min(1, "Select a category"),
  template_ids: z.array(z.string()).min(1, "Select at least one template"),
  dependency_type: z.enum(["blocking", "non_blocking", "related"]),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

export const CreateInventoryOrderTasks = () => {
  const { t } = useTranslation();
  const { id: orderId } = useParams();
  const { handleSuccess } = useRouteModal();

  // Fetch all templates then filter to inventory-order ones
  const { task_templates: allTemplates = [] } = useTaskTemplates();

  const templates = useMemo(() => {
    return allTemplates.filter((tpl) => {
      let catName: string | undefined;
      if (typeof tpl.category === "string") {
        catName = tpl.category;
      } else if (tpl.category && typeof tpl.category === "object") {
        catName = (tpl.category as TaskCategory).name;
      }
      return catName?.toLowerCase().includes("inventory");
    });
  }, [allTemplates]);

  const { mutateAsync: createTasks, isPending } = useCreateInventoryOrderTasks(orderId!);

  // Form
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      category_id: "",
      template_ids: [],
      dependency_type: "blocking",
    },
  });

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  // Group templates by category
  const templatesByCategory = useMemo(() => {
    const grouped: Record<string, AdminTaskTemplate[]> = {};
    templates.forEach((template) => {
      let category = "Uncategorized";
      if (typeof template.category === "string") {
        category = template.category;
      } else if (template.category && typeof template.category === "object") {
        const categoryObj = template.category as TaskCategory;
        category = categoryObj.name || "Uncategorized";
      }
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(template);
    });
    return grouped;
  }, [templates]);

  const categories = useMemo(
    () =>
      Object.keys(templatesByCategory).map((name) => ({
        id: name,
        name,
        templates: templatesByCategory[name] as AdminTaskTemplate[],
      })),
    [templatesByCategory],
  );

  const selectedCategoryId = watch("category_id");
  const selectedTemplateIds = watch("template_ids") || [];
  const dependencyType = watch("dependency_type") as "blocking" | "non_blocking" | "related";

  const selectedCategory = useMemo(() => {
    if (!selectedCategoryId) return null;
    return categories.find((cat) => cat.id === selectedCategoryId) || null;
  }, [selectedCategoryId, categories]);

  const selectedTemplates = useMemo(() => {
    if (!templates.length || !selectedTemplateIds.length) return [];
    return templates.filter((t) => selectedTemplateIds.includes(t.id || ""));
  }, [templates, selectedTemplateIds]);

  const orderedTemplates = useMemo(() => {
    if (!selectedTemplates.length) return [] as AdminTaskTemplate[];
    return selectedTemplateIds
      .map((id) => templates.find((t) => t.id === id))
      .filter(Boolean) as AdminTaskTemplate[];
  }, [selectedTemplateIds, templates, selectedTemplates]);

  const handleTemplateClick = (templateId: string) => {
    const newIds = selectedTemplateIds.includes(templateId)
      ? selectedTemplateIds.filter((id) => id !== templateId)
      : [...selectedTemplateIds, templateId];
    setValue("template_ids", newIds, { shouldValidate: true, shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (data) => {
    if (!selectedTemplates.length) return;
    try {
      await createTasks(
        {
          type: "template",
          template_names: selectedTemplates.map((t) => t.name),
          dependency_type: data.dependency_type,
        },
        {
          onSuccess: () => {
            toast.success(t("tasks.templates.create.success"));
            handleSuccess(`/inventory/orders/${orderId}`);
          },
          onError: (err: any) => toast.error(err.message),
        },
      );
    } catch (e: any) {
      console.error(e);
      toast.error(t("tasks.templates.create.error"));
    }
  });

  // UI
  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
      <RouteFocusModal.Header>
        <div>
          <Heading level="h2">{t("tasks.templates.create.title")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("tasks.templates.create.subtitle")}
          </Text>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-8 overflow-y-auto p-6">
        {/* Category selection */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h3">{t("tasks.templates.categories.title")}</Heading>
          </div>
          <div className="px-6 py-4">
            <Form.Field
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("tasks.templates.category.select")}</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value || ""}
                      onValueChange={(val) => {
                        field.onChange(val);
                        setValue("template_ids", []);
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder={t("common.select") as string} />
                      </Select.Trigger>
                      <Select.Content>
                        {categories.map((cat) => (
                          <Select.Item key={cat.id} value={cat.id}>
                            {cat.name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />
            {errors.category_id?.message && (
              <Text size="small" className="mt-2 text-ui-fg-error">
                {errors.category_id.message}
              </Text>
            )}
          </div>
        </Container>

        {/* dependency type */}
        {selectedCategory && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h3">{t("tasks.templates.dependency.title")}</Heading>
            </div>
            <div className="px-6 py-4">
              <Form.Field
                control={form.control}
                name="dependency_type"
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange}>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <RadioGroup.Item value="blocking" id="blocking" />
                        <label htmlFor="blocking">{t("tasks.templates.dependency.blocking")}</label>
                      </div>
                      <div className="flex items-start gap-2">
                        <RadioGroup.Item value="non_blocking" id="non_blocking" />
                        <label htmlFor="non_blocking">{t("tasks.templates.dependency.non_blocking")}</label>
                      </div>
                      <div className="flex items-start gap-2">
                        <RadioGroup.Item value="related" id="related" />
                        <label htmlFor="related">{t("tasks.templates.dependency.related")}</label>
                      </div>
                    </div>
                  </RadioGroup>
                )}
              />
            </div>
          </Container>
        )}

        {/* template selection */}
        {selectedCategory && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h3">{t("tasks.templates.available.title")}</Heading>
            </div>
            <div className="px-6 py-4">
              {/* selected list */}
              {selectedTemplates.length > 0 && (
                <div className="mb-4">
                  <Text size="small" className="mb-2 text-ui-fg-subtle">
                    {t("tasks.templates.selected")}
                  </Text>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplates.map((tpl) => (
                      <Badge key={tpl.id} className="gap-x-2">
                        {tpl.name}
                        <button
                          type="button"
                          className="text-ui-fg-subtle hover:text-ui-fg-base"
                          onClick={() => {
                            const newIds = selectedTemplateIds.filter((id) => id !== tpl.id);
                            setValue("template_ids", newIds, { shouldDirty: true, shouldValidate: true });
                          }}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* available */}
              <div className="flex flex-wrap gap-2">
                {selectedCategory.templates
                  .filter((tpl) => !selectedTemplateIds.includes(tpl.id || ""))
                  .map((tpl) => (
                    <Badge
                      key={tpl.id}
                      className="cursor-pointer hover:bg-ui-bg-base"
                      onClick={() => {
                        setValue("template_ids", [...selectedTemplateIds, tpl.id || ""], {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                      }}
                    >
                      {tpl.name}
                    </Badge>
                  ))}
              </div>
              {errors.template_ids?.message && (
                <Text size="small" className="mt-2 text-ui-fg-error">
                  {errors.template_ids.message}
                </Text>
              )}
            </div>
          </Container>
        )}

        {/* Visualization */}
        {selectedTemplates.length > 0 && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h3">{t("tasks.templates.visualization.title")}</Heading>
            </div>
            <div className="px-6 py-4">
              <div className="h-[400px] w-full border rounded-lg overflow-hidden">
                <TaskTemplateCanvas
                  templates={orderedTemplates}
                  dependencyType={dependencyType}
                  onTemplateClick={handleTemplateClick}
                  selectedTemplates={selectedTemplateIds}
                />
              </div>
            </div>
          </Container>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <Button variant="secondary" type="button" onClick={() => handleSuccess()}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={isPending} isLoading={isPending} onClick={onSubmit}>
          {t("common.create")}
        </Button>
      </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  );
};
