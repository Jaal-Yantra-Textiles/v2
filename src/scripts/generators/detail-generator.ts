import { BaseGenerator, ModelStructure } from "./base-generator";
import * as fs from "fs/promises";
import * as path from "path";

export class DetailGenerator extends BaseGenerator {
  async generateDetailPage(model: ModelStructure, routePath: string) {
    const routeDir = routePath 
      ? path.join(this.adminRoutesDir, routePath, "[id]")
      : path.join(this.adminRoutesDir, this.toKebabCase(model.pluralName), "[id]");
    
    await fs.mkdir(routeDir, { recursive: true });
    
    const pageContent = this.generateDetailPageContent(model, routePath);
    await fs.writeFile(path.join(routeDir, "page.tsx"), pageContent);
    
    console.log(`📄 Generated detail page at ${routeDir}`);
  }

  async generateGeneralSection(model: ModelStructure) {
    const componentDir = path.join(this.adminComponentsDir, this.toKebabCase(model.pluralName));
    await fs.mkdir(componentDir, { recursive: true });
    
    const sectionContent = this.generateGeneralSectionContent(model);
    const sectionFile = path.join(componentDir, `${this.toKebabCase(model.name)}-general-section.tsx`);
    await fs.writeFile(sectionFile, sectionContent);
    
    console.log(`📋 Generated general section at ${sectionFile}`);
  }

  private generateDetailPageContent(model: ModelStructure, routePath: string): string {
    const singularPascal = this.toPascalCase(model.name);
    const singularKebab = this.toKebabCase(model.name);
    const pluralKebab = this.toKebabCase(model.pluralName);
    const componentName = `${singularPascal}GeneralSection`;

    return `import { UIMatch, useParams } from "react-router-dom";
import { ${componentName} } from "../../../../components/${pluralKebab}/${singularKebab}-general-section";
import { use${singularPascal} } from "../../../../hooks/api/${pluralKebab}";
import { SingleColumnPageSkeleton } from "../../../../components/table/skeleton";
import { SingleColumnPage } from "../../../../components/pages/single-column-pages";

const ${singularPascal}DetailPage = () => {
  const { id } = useParams();
  const { ${this.toCamelCase(model.name)}, isLoading, isError } = use${singularPascal}(id!);

  if (isLoading || !${this.toCamelCase(model.name)}) {
    return <SingleColumnPageSkeleton sections={1} showJSON showMetadata />;
  }

  if (isError) {
    throw new Error("Failed to load ${this.toCamelCase(model.name).replace(/([A-Z])/g, ' $1').toLowerCase().trim()}");
  }

  return (
    <SingleColumnPage
      data={${this.toCamelCase(model.name)}}
      hasOutlet
      showJSON
      showMetadata
    >
      <${componentName} ${this.toCamelCase(model.name)}={${this.toCamelCase(model.name)}} />
    </SingleColumnPage>
  );
};

export default ${singularPascal}DetailPage;

export const handle = {
  breadcrumb: (match: UIMatch<{ id: string }>) => {
    const { id } = match.params;
    return id;
  },
};
`;
  }

  private generateGeneralSectionContent(model: ModelStructure): string {
    const singularPascal = this.toPascalCase(model.name);
    const pluralKebab = this.toKebabCase(model.pluralName);
    
    // Get key display fields (first 4-5 important fields)
    const displayFields = model.fields.filter(f => 
      !['id', 'created_at', 'updated_at', 'deleted_at'].includes(f.name)
    ).slice(0, 5);

    const fieldDisplays = displayFields.map(field => {
      const fieldCamel = this.toCamelCase(field.name);
      const modelCamel = this.toCamelCase(model.name);
      
      if (field.type === 'boolean') {
        return `          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("${pluralKebab}.fields.${fieldCamel}.label")}
            </Text>
            <Badge size="2xsmall" color={${modelCamel}.${fieldCamel} ? "green" : "grey"}>
              {${modelCamel}.${fieldCamel} ? t("general.enabled") : t("general.disabled")}
            </Badge>
          </div>`;
      } else {
        return `          <div className="grid grid-cols-2 items-center px-6 py-4">
            <Text size="small" leading="compact" weight="plus">
              {t("${pluralKebab}.fields.${fieldCamel}.label")}
            </Text>
            <Text size="small" leading="compact">
              {${modelCamel}.${fieldCamel} || "-"}
            </Text>
          </div>`;
      }
    }).join('\n');

    return `import { PencilSquare, Trash } from "@medusajs/icons";
import { Container, Heading, Text, usePrompt, Badge } from "@medusajs/ui";
import { useTranslation } from "react-i18next";
import { ActionMenu } from "../common/action-menu";
import { Admin${singularPascal} } from "../../hooks/api/${pluralKebab}";

type ${singularPascal}GeneralSectionProps = {
  ${this.toCamelCase(model.name)}: Admin${singularPascal};
};

export const ${singularPascal}GeneralSection = ({ ${this.toCamelCase(model.name)} }: ${singularPascal}GeneralSectionProps) => {
  const { t } = useTranslation();
  const prompt = usePrompt();

  const handleDelete = async () => {
    const res = await prompt({
      title: t("general.areYouSure"),
      description: t("${pluralKebab}.delete.confirmation", {
        name: ${this.toCamelCase(model.name)}.${this.toCamelCase(displayFields[0]?.name || 'name')},
      }),
      confirmText: t("actions.delete"),
      cancelText: t("actions.cancel"),
      variant: "danger",
    });

    if (!res) {
      return;
    }

    // TODO: Implement delete functionality
    console.log("Delete ${this.toCamelCase(model.name)}:", ${this.toCamelCase(model.name)}.id);
  };

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex flex-col">
          <Heading level="h2">{${this.toCamelCase(model.name)}.${this.toCamelCase(displayFields[0]?.name || 'name')}}</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {t("${pluralKebab}.subtitle")}
          </Text>
        </div>
        <ActionMenu
          groups={[
            {
              actions: [
                {
                  icon: <PencilSquare />,
                  label: t("actions.edit"),
                  to: \`edit\`,
                },
              ],
            },
            {
              actions: [
                {
                  icon: <Trash />,
                  label: t("actions.delete"),
                  onClick: handleDelete,
                },
              ],
            },
          ]}
        />
      </div>
      <div className="text-ui-fg-subtle grid divide-y">
${fieldDisplays}
      </div>
    </Container>
  );
};
`;
  }
}
