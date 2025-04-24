import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  Button,
  Heading,
  Text,
  toast,
  usePrompt,
  Select,
  Badge,
  Container,
} from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { useRouteModal } from "../modal/use-route-modal"
import { RouteFocusModal } from "../modal/route-focus-modal"
import { Form } from "../common/form"
import { useMemo } from "react"
import { AdminTaskTemplate, TaskCategory, useTaskTemplates } from "../../hooks/api/task-templates"
import { useCreateDesignTask } from "../../hooks/api/design-tasks"

// Define schema for template selection
const templateSchema = z.object({
  category_id: z.string().min(1, "Select a category"),
  template_ids: z.array(z.string()).min(1, "Select at least one template")
})

type TemplateFormValues = z.infer<typeof templateSchema>

export const CreateTasksFromTemplates = () => {
  const { t } = useTranslation()
  const { id: designId } = useParams()
  const { handleSuccess } = useRouteModal()
  const prompt = usePrompt()
  const { task_templates: templates = [] } = useTaskTemplates()
  const { mutateAsync: createTasks, isPending } = useCreateDesignTask(designId!)

  // Initialize form with react-hook-form and zod validation
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      category_id: "",
      template_ids: [],
    },
  })

  // Destructure form methods
  const { 
    handleSubmit, 
    watch, 
    setValue,
    formState: { errors } 
  } = form

  // Group templates by category
  const templatesByCategory = useMemo(() => {
    const grouped: Record<string, AdminTaskTemplate[]> = {}
    templates.forEach(template => {
      let category = "Uncategorized"
      
      if (typeof template.category === 'string') {
        category = template.category
      } else if (template.category && typeof template.category === 'object') {
        const categoryObj = template.category as TaskCategory
        category = categoryObj.name || "Uncategorized"
      }
      
      if (!grouped[category]) {
        grouped[category] = []
      }
      grouped[category].push(template)
    })
    return grouped
  }, [templates])
  
  // Get unique categories for selection
  const categories = useMemo(() => 
    Object.keys(templatesByCategory).map(name => ({
      id: name,
      name,
      templates: templatesByCategory[name] as AdminTaskTemplate[]
    }))
  , [templatesByCategory])
  
  // Get selected category and templates
  const selectedCategoryId = watch("category_id")
  const selectedTemplateIds = watch("template_ids") || []
  
  // Find the selected category and its templates
  const selectedCategory = useMemo(() => {
    if (!selectedCategoryId) return null
    return categories.find(cat => cat.id === selectedCategoryId) || null
  }, [selectedCategoryId, categories])
  
  // Get selected templates details
  const selectedTemplates = useMemo(() => {
    if (!templates.length || !selectedTemplateIds.length) return []
    return templates.filter(t => selectedTemplateIds.includes(t.id || ""))
  }, [templates, selectedTemplateIds])

  // Handle form submission
  const onSubmit = handleSubmit(async () => {
    if (!selectedTemplates.length) return;
    
    // Confirm with user before creating tasks
    const confirmed = await prompt({
      title: t("tasks.templates.create.confirmTitle", "Confirm Task Creation"),
      description: t("tasks.templates.create.confirmDescription", 
        `This will create ${selectedTemplates.length} tasks from the "${selectedCategory?.name}" category.`),
      confirmText: t("actions.create", "Create"),
      cancelText: t("actions.cancel", "Cancel"),
    })

    if (!confirmed) return

    try {
      // Create tasks from templates
      await createTasks(
        { 
          type: "template", 
          template_names: selectedTemplates.map(t => t.name)
        },
        {
          onSuccess: () => {
            toast.success(t("tasks.templates.create.success", "Tasks created successfully"))
            handleSuccess(`/designs/${designId}`)
          },
          onError: (error) => {
            toast.error(error.message)
          },
        }
      )
    } catch (error: any) {
      console.error("Failed to create tasks:", error)
      toast.error(t("tasks.templates.create.error", "Failed to create tasks"))
    }
  })

  // Render component
  return (
    <RouteFocusModal.Form form={form}>
      <RouteFocusModal.Header>
        <div>
          <Heading level="h2">{t("tasks.templates.create.title", "Create Tasks from Templates")}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("tasks.templates.create.subtitle", "Select templates by category to create tasks")}
          </Text>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="flex flex-col gap-y-8 overflow-y-auto p-6">
        {/* Category selection section */}
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <div className="flex justify-between items-center">
              <div>
                <Heading level="h3">{t("tasks.templates.categories.title", "Template Categories")}</Heading>
                <Text size="small" className="text-ui-fg-subtle">
                  {t("tasks.templates.categories.subtitle", "Select a category to view available templates")}
                </Text>
              </div>
            </div>
          </div>
          
          <div className="px-6 py-4">
            {/* Category selector */}
            <Form.Field
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <Form.Item>
                  <Form.Label>{t("tasks.templates.category.select", "Select a category")}</Form.Label>
                  <Form.Control>
                    <Select
                      value={field.value || ""}
                      onValueChange={(value) => {
                        field.onChange(value)
                        // Reset selected templates when category changes
                        setValue("template_ids", [])
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value placeholder="Select a category" />
                      </Select.Trigger>
                      <Select.Content>
                        {categories.map((category) => (
                          <Select.Item key={category.id} value={category.id}>
                            {category.name}
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
        
        {/* Templates selection section */}
        {selectedCategory && (
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <div className="flex justify-between items-center">
                <div>
                  <Heading level="h3">{t("tasks.templates.available.title", "Available Templates")}</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    {t("tasks.templates.available.subtitle", `Select templates from the "${selectedCategory.name}" category`)}
                  </Text>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4">
              {/* Selected templates as badges */}
              {selectedTemplates.length > 0 && (
                <div className="mb-4">
                  <Text size="small" className="mb-2 text-ui-fg-subtle">
                    {t("tasks.templates.selected", "Selected templates")}:
                  </Text>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplates.map((template) => (
                      <Badge key={template.id} className="gap-x-2">
                        {template.name}
                        <button
                          type="button"
                          className="text-ui-fg-subtle hover:text-ui-fg-base"
                          onClick={() => {
                            const newTemplateIds = selectedTemplateIds.filter(
                              id => id !== template.id
                            )
                            setValue("template_ids", newTemplateIds, {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }}
                        >
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Available templates in the selected category */}
              <div className="mt-4">
                <Text size="small" className="font-medium mb-2">
                  {t("tasks.templates.available.select", "Select templates to add")}:
                </Text>
                <div className="flex flex-wrap gap-2">
                  {selectedCategory.templates
                    .filter(template => !selectedTemplateIds.includes(template.id || ""))
                    .map((template: AdminTaskTemplate) => (
                      <Badge 
                        key={template.id} 
                        className="cursor-pointer hover:bg-ui-bg-base"
                        onClick={() => {
                          setValue("template_ids", [...selectedTemplateIds, template.id || ""], {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }}
                      >
                        {template.name}
                      </Badge>
                    ))
                  }
                </div>
              </div>
              
              {errors.template_ids?.message && (
                <Text size="small" className="mt-2 text-ui-fg-error">
                  {errors.template_ids.message}
                </Text>
              )}
            </div>
          </Container>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <Button
          variant="secondary"
          size="small"
          onClick={() => window.history.back()}
        >
          {t("actions.cancel", "Cancel")}
        </Button>
        <Button
          variant="primary"
          size="small"
          isLoading={isPending}
          onClick={onSubmit}
        >
          {t("actions.create", "Create")}
        </Button>
      </RouteFocusModal.Footer>
    </RouteFocusModal.Form>
  )
}
