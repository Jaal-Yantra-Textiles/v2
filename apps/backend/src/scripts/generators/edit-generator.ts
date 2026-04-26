import { BaseGenerator, ModelStructure } from "./base-generator";
import * as fs from "fs/promises";
import * as path from "path";

export class EditGenerator extends BaseGenerator {
  async generateEditPage(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath, "[id]", "@edit")
      : path.join(this.adminRoutesDir, this.toKebabCase(model.pluralName), "[id]", "@edit");
    
    await fs.mkdir(routeDir, { recursive: true });
    
    const pageContent = this.generateEditPageContent(model, routePath);
    await fs.writeFile(path.join(routeDir, "page.tsx"), pageContent);
    
    console.log(`✏️ Generated edit page at ${routeDir}`);
  }

  private generateEditPageContent(model: ModelStructure, routePath: string): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralKebab = this.toKebabCase(model.pluralName);
    
    // Get editable fields (exclude system fields)
    const editableFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    const fieldConfigs = editableFields.map(field => {
      let fieldType = 'text';
      let options = '';
      const fieldCamel = this.toCamelCase(field.name);
      const fieldLabel = field.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (field.isEnum && field.enumValues) {
        fieldType = 'select';
        options = `,
        options: [
          ${field.enumValues.map(val => `{ label: "${val}", value: "${val}" }`).join(',\n          ')}
        ]`;
      } else if (field.type === 'boolean') {
        fieldType = 'switch';
      } else if (field.type === 'number') {
        fieldType = 'number';
      } else if (field.name.includes('description') || field.name.includes('notes')) {
        fieldType = 'text';
      }

      return `    { 
      name: "${fieldCamel}", 
      type: "${fieldType}", 
      label: "${fieldLabel}", 
      required: ${!field.isOptional}${options}
    },`;
    }).join('\n');

    return `import { useParams } from "react-router-dom";
import { use${singularPascal} } from "../../../../../hooks/api/${pluralKebab}";
import { Heading } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { RouteDrawer } from "../../../../../components/modal/route-drawer/route-drawer";
import { Edit${singularPascal}Form } from "../../../../../components/edits/edit-${this.toKebabCase(model.name)}";

export default function Edit${singularPascal}Page() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { ${this.toCamelCase(model.name)}: ${this.toCamelCase(model.name)}, isLoading } = use${singularPascal}(id!, {
    undefined,
  });

  const ready = !!${this.toCamelCase(model.name)};

  if (isLoading || !${this.toCamelCase(model.name)}) {
    return null; // Add loading state if needed
  }

  return (
    <RouteDrawer>
      <RouteDrawer.Header>
        <Heading>{t("${this.toCamelCase(model.name)}.edit.header")}</Heading>
      </RouteDrawer.Header>
      {ready && <Edit${singularPascal}Form ${this.toCamelCase(model.name)}={${this.toCamelCase(model.name)}} />}
    </RouteDrawer>
  );
}
`;
  }

  async generateEditComponent(model: ModelStructure) {
    const componentDir = path.join(this.adminComponentsDir, "edits");
    await fs.mkdir(componentDir, { recursive: true });
    
    const componentContent = this.generateEditComponentContent(model);
    const componentFile = path.join(componentDir, `edit-${this.toKebabCase(model.name)}.tsx`);
    await fs.writeFile(componentFile, componentContent);
    
    console.log(`✏️ Generated edit component at ${componentFile}`);
  }

  private generateEditComponentContent(model: ModelStructure): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralKebab = this.toKebabCase(model.pluralName);
    
    // Get editable fields (exclude system fields)
    const editableFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    );

    const fieldConfigs = editableFields.map(field => {
      let fieldType = 'text';
      let options = '';
      const fieldCamel = this.toCamelCase(field.name);
      const fieldLabel = field.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      
      if (field.isEnum && field.enumValues) {
        fieldType = 'select';
        options = `,
        options: [
          ${field.enumValues.map(val => `{ label: "${val}", value: "${val}" }`).join(',\n          ')}
        ]`;
      } else if (field.type === 'boolean') {
        fieldType = 'switch';
      } else if (field.type === 'number') {
        fieldType = 'number';
      }
      
      return `    {
      name: "${fieldCamel}",
      type: "${fieldType}", 
      label: "${fieldLabel}", 
      required: ${!field.isOptional}${options}
    },`;
    }).join('\n');

    return `import { useUpdate${singularPascal} } from "../../hooks/api/${pluralKebab}";
import { DynamicForm, FieldConfig } from "../common/dynamic-form";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Admin${singularPascal} } from "../../hooks/api/${pluralKebab}";
import { useRouteModal } from "../../components/modal/use-route-modal";

type Edit${singularPascal}FormProps = {
  ${this.toCamelCase(model.name)}: Admin${singularPascal};
};

export const Edit${singularPascal}Form = ({ ${this.toCamelCase(model.name)} }: Edit${singularPascal}FormProps) => {
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useUpdate${singularPascal}(${this.toCamelCase(model.name)}.id);
  const { handleSuccess } = useRouteModal();

  const handleSubmit = async (data: any) => {
    try {
      await mutateAsync(data);
      toast.success("${singularPascal} updated successfully");
      handleSuccess();
    } catch (error) {
      toast.error("Failed to update ${this.toCamelCase(model.name)}");
    }
  };

  const fields: FieldConfig<any>[] = [
${fieldConfigs}
  ];

  return (
    <DynamicForm<any>
      fields={fields}
      defaultValues={{
${editableFields.map(f => {
        const fieldCamel = this.toCamelCase(f.name);
        return `        ${fieldCamel}: ${this.toCamelCase(model.name)}.${fieldCamel} || ${f.type === 'boolean' ? 'false' : f.type === 'number' ? '0' : '""'},`;
      }).join('\n')}
      }}
      onSubmit={handleSubmit}
      layout={{
        showDrawer: true,
        gridCols: 1,
      }}
      isPending={isPending}
    />
  );
};
`;
  }
}
