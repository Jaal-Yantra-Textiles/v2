#!/usr/bin/env node

import { BaseGenerator } from "./generators/base-generator";
import { DataTableGenerator } from "./generators/datatable-generator";
import { DetailGenerator } from "./generators/detail-generator";
import { EditGenerator } from "./generators/edit-generator";
import { CreateGenerator } from "./generators/create-generator";

interface GenerateUIOptions {
  model: string;
  route?: string;
  components?: string[];
}

class UIGenerator extends BaseGenerator {
  private dataTableGenerator: DataTableGenerator;
  private detailGenerator: DetailGenerator;
  private editGenerator: EditGenerator;
  private createGenerator: CreateGenerator;

  constructor() {
    super();
    this.dataTableGenerator = new DataTableGenerator();
    this.detailGenerator = new DetailGenerator();
    this.editGenerator = new EditGenerator();
    this.createGenerator = new CreateGenerator();
  }

  async generateUI(options: GenerateUIOptions) {
    const { model: modelName, route: routePath, components = ['all'] } = options;

    console.log(`🚀 Starting UI generation for model: ${modelName}`);
    
    // Find and parse the model file
    const modelFile = await this.findModelFile(modelName);
    if (!modelFile) {
      throw new Error(`Model file not found for: ${modelName}`);
    }

    const model = await this.parseModelFile(modelFile);
    if (!model) {
      throw new Error(`Failed to parse model file: ${modelFile}`);
    }

    console.log(`📋 Parsed model: ${model.name} (${model.pluralName})`);
    console.log(`📊 Found ${model.fields.length} fields, ${model.filterableFields.length} filterable`);

    // Generate components based on options
    if (components.includes('all') || components.includes('datatable')) {
      await this.dataTableGenerator.generateDataTablePage(model, routePath || '');
      await this.dataTableGenerator.generateColumnHook(model);
    }

    if (components.includes('all') || components.includes('detail')) {
      await this.detailGenerator.generateDetailPage(model, routePath || '');
      await this.detailGenerator.generateGeneralSection(model);
    }

    if (components.includes('all') || components.includes('edit')) {
      await this.editGenerator.generateEditPage(model, routePath || '');
      await this.editGenerator.generateEditComponent(model);
    }

    if (components.includes('all') || components.includes('create')) {
      await this.createGenerator.generateCreatePage(model, routePath || '');
      await this.createGenerator.generateCreateComponent(model, routePath);
    }

    console.log(`✅ UI generation completed for ${modelName}!`);
    
    // Print summary
    console.log('\n📁 Generated files:');
    const routeBase = routePath || this.toKebabCase(model.pluralName);
    console.log(`  📊 DataTable: src/admin/routes/${routeBase}/page.tsx`);
    console.log(`  📄 Detail: src/admin/routes/${routeBase}/[id]/page.tsx`);
    console.log(`  ✏️ Edit: src/admin/routes/${routeBase}/[id]/@edit/page.tsx`);
    console.log(`  ➕ Create: src/admin/routes/${routeBase}/create/page.tsx`);
    console.log(`  🔗 Columns: src/admin/hooks/columns/use${this.toPascalCase(model.pluralName)}TableColumns.ts`);
    console.log(`  🔧 Create Component: src/admin/components/creates/create-${this.toKebabCase(model.name)}.tsx`);
    console.log(`  ✏️ Edit Component: src/admin/components/edits/edit-${this.toKebabCase(model.name)}.tsx`);
    console.log(`  📋 General Section: src/admin/components/${this.toKebabCase(model.pluralName)}/${this.toKebabCase(model.name)}-general-section.tsx`);
  }
}

// Main run function following the original pattern
const run = async ({ args }: { args: string[] }) => {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: npx medusa exec ./src/scripts/generate-ui-v2.ts <model> [route]

Arguments:
  model                 Model name (required)
  route                 Custom route path (optional)

Examples:
  npx medusa exec ./src/scripts/generate-ui-v2.ts email-template
  npx medusa exec ./src/scripts/generate-ui-v2.ts email-template settings/email-templates
`);
    return;
  }

  const positionalArgs = args.filter(arg => !arg.startsWith('--'));

  if (positionalArgs.length < 1) {
    console.error("Error: Missing required argument: modelName.");
    console.log(`
Usage: npx medusa exec ./src/scripts/generate-ui-v2.ts <model> [route]
`);
    return;
  }

  const [modelName, routePath = ''] = positionalArgs;

  if (!modelName) {
    console.error("Error: modelName must be provided.");
    return;
  }

  try {
    const generator = new UIGenerator();
    await generator.generateUI({
      model: modelName,
      route: routePath,
      components: ['all']
    });
  } catch (error) {
    console.error(`❌ Error during UI generation: ${error.message}`);
    throw error;
  }
};

export default run;

export { UIGenerator };
