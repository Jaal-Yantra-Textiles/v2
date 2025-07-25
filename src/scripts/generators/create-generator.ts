import { BaseGenerator, ModelStructure } from "./base-generator";
import * as fs from "fs/promises";
import * as path from "path";

export class CreateGenerator extends BaseGenerator {
  async generateCreatePage(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath, "create")
      : path.join(this.adminRoutesDir, this.toKebabCase(model.pluralName), "create");
    
    await fs.mkdir(routeDir, { recursive: true });
    
    const pageContent = this.generateCreatePageContent(model);
    await fs.writeFile(path.join(routeDir, "page.tsx"), pageContent);
    
    console.log(`➕ Generated create page at ${routeDir}`);
  }

  async generateCreateComponent(model: ModelStructure, routePath?: string) {
    const componentDir = path.join(this.adminComponentsDir, "creates");
    await fs.mkdir(componentDir, { recursive: true });
    
    const componentContent = this.generateCreateComponentContent(model, routePath);
    const componentFile = path.join(componentDir, `create-${this.toKebabCase(model.name)}.tsx`);
    await fs.writeFile(componentFile, componentContent);
    
    console.log(`🔧 Generated create component at ${componentFile}`);
  }

  private generateCreatePageContent(model: ModelStructure): string {
    const singularPascal = this.toPascalCase(model.name);
    const singularKebab = this.toKebabCase(model.name);

    return `import { Create${singularPascal} } from "../../../../components/creates/create-${singularKebab}";

const Create${singularPascal}Page = () => {
  return <Create${singularPascal} />;
};

export default Create${singularPascal}Page;
`;
  }

  private generateCreateComponentContent(model: ModelStructure, routePath?: string): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralPascal = this.toPascalCase(model.pluralName);
    const pluralKebab = this.toKebabCase(model.pluralName);
    
    // Get creatable fields (exclude system fields)
    const creatableFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    // Generate zod schema fields
    const zodFields = creatableFields.map(field => {
      let zodType = 'z.string()';
      const fieldCamel = this.toCamelCase(field.name);
      
      if (field.type === 'number') {
        zodType = 'z.number()';
      } else if (field.type === 'boolean') {
        zodType = 'z.boolean()';
      } else if (field.isEnum && field.enumValues) {
        const enumValues = field.enumValues.map(v => `"${v}"`).join(', ');
        zodType = `z.enum([${enumValues}])`;
      }
      
      if (field.isOptional) {
        zodType += '.optional()';
      }
      
      return `  ${fieldCamel}: ${zodType},`;
    }).join('\n');

    // Generate form fields
    const formFields = creatableFields.map(field => {
      let fieldComponent = '';
      const fieldCamel = this.toCamelCase(field.name);
      const fieldLabel = field.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (field.isEnum && field.enumValues) {
        const options = field.enumValues.map(val => 
          `              <Select.Option value="${val}">${val}</Select.Option>`
        ).join('\n');
        
        fieldComponent = `            <Form.Field
              control={form.control}
              name="${fieldCamel}"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>${fieldLabel}</Form.Label>
                  <Form.Control>
                    <Select {...formField}>
                      <Select.Trigger>
                        <Select.Value placeholder="Select ${fieldLabel.toLowerCase()}" />
                      </Select.Trigger>
                      <Select.Content>
${options}
                      </Select.Content>
                    </Select>
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />`;
      } else if (field.type === 'boolean') {
        fieldComponent = `            <Form.Field
              control={form.control}
              name="${fieldCamel}"
              render={({ field: formField }) => (
                <Form.Item>
                  <div className="flex items-center space-x-2">
                    <Form.Control>
                      <Switch
                        checked={formField.value}
                        onCheckedChange={formField.onChange}
                      />
                    </Form.Control>
                    <Form.Label>${fieldLabel}</Form.Label>
                  </div>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />`;
      } else if (field.name.includes('description') || field.name.includes('notes')) {
        fieldComponent = `            <Form.Field
              control={form.control}
              name="${fieldCamel}"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>${fieldLabel}</Form.Label>
                  <Form.Control>
                    <Textarea {...formField} placeholder="Enter ${fieldLabel.toLowerCase()}" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />`;
      } else {
        const inputType = field.type === 'number' ? 'number' : 'text';
        fieldComponent = `            <Form.Field
              control={form.control}
              name="${fieldCamel}"
              render={({ field: formField }) => (
                <Form.Item>
                  <Form.Label>${fieldLabel}</Form.Label>
                  <Form.Control>
                    <Input {...formField} type="${inputType}" placeholder="Enter ${fieldLabel.toLowerCase()}" />
                  </Form.Control>
                  <Form.ErrorMessage />
                </Form.Item>
              )}
            />`;
      }
      
      return fieldComponent;
    }).join('\n');

    return `import { Button, Heading, Input, Select, Switch, Text, Textarea } from "@medusajs/ui";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { KeyboundForm } from "../utilitites/key-bound-form";
import { Form } from "../common/form";
import { useCreate${pluralPascal} } from "../../hooks/api/${pluralKebab}";

const create${singularPascal}Schema = z.object({
${zodFields}
});

type Create${singularPascal}FormData = z.infer<typeof create${singularPascal}Schema>;

export const Create${singularPascal} = () => {
  const navigate = useNavigate();
  const { mutateAsync: create${singularPascal}, isPending } = useCreate${pluralPascal}();

  const form = useForm<Create${singularPascal}FormData>({
    resolver: zodResolver(create${singularPascal}Schema),
    defaultValues: {
      ${creatableFields.map(f => {
        const fieldCamel = this.toCamelCase(f.name);
        if (f.type === 'boolean') return `${fieldCamel}: false,`;
        if (f.defaultValue) {
          // Properly quote and escape string default values
          let quotedValue;
          if (f.type === 'boolean') {
            quotedValue = String(f.defaultValue).toLowerCase() === 'true' ? 'true' : 'false';
          } else if (f.type === 'number') {
            quotedValue = f.defaultValue;
          } else {
            // For strings and any other type, always quote and escape
            const escapedValue = String(f.defaultValue).replace(/"/g, '\\"').replace(/\\/g, '\\\\');
            quotedValue = `"${escapedValue}"`;
          }
          return `${fieldCamel}: ${quotedValue},`;
        }
        return `${fieldCamel}: "",`;
      }).join('\n      ')}
    },
  });

  const handleSubmit = async (data: Create${singularPascal}FormData) => {
    try {
      const result = await create${singularPascal}(data);
      toast.success("${singularPascal} created successfully");
      navigate(\`${routePath ? `/${routePath}` : `/${pluralKebab}`}/\${result.${this.toCamelCase(model.name)}.id}\`);
    } catch (error) {
      toast.error("Failed to create ${this.toCamelCase(model.name)}");
    }
  };

  return (
    <RouteFocusModal>
      <RouteFocusModal.Form form={form}>
        <KeyboundForm
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex h-full flex-col overflow-hidden"
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
                type="submit"
                isLoading={isPending}
                className="shrink-0"
              >
                Create
              </Button>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="flex flex-1 flex-col items-center overflow-y-auto py-8 md:py-16 px-4 md:px-6">
            <div className="flex w-full max-w-[720px] flex-col gap-y-6 md:gap-y-8">
              <div>
                <Heading className="text-xl md:text-2xl">{"Create ${singularPascal.replace(/([A-Z])/g, ' $1').trim()}"}</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  {"Create a new ${this.toCamelCase(model.name).replace(/([A-Z])/g, ' $1').toLowerCase().trim()}"}
                </Text>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
${formFields}
              </div>
            </div>
          </RouteFocusModal.Body>
        </KeyboundForm>
      </RouteFocusModal.Form>
    </RouteFocusModal>
  );
};
`;
  }
}
