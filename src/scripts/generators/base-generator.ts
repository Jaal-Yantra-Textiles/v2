import * as fs from "fs/promises";
import * as path from "path";

export interface ModelField {
  name: string;
  type: string;
  isOptional: boolean;
  isEnum: boolean;
  enumValues?: string[];
  isSearchable: boolean;
  isFilterable: boolean;
  defaultValue?: string;
}

export interface ModelStructure {
  name: string;
  pluralName: string;
  fields: ModelField[];
  hasSearchableFields: boolean;
  filterableFields: ModelField[];
  enumFields: ModelField[];
}

export abstract class BaseGenerator {
  protected projectRoot: string;
  protected modelsDir: string;
  protected adminRoutesDir: string;
  protected adminComponentsDir: string;
  protected adminHooksDir: string;
  protected apiDir: string;

  constructor() {
    this.projectRoot = path.join(__dirname, "..", "..");
    this.modelsDir = path.join(this.projectRoot, "/modules");
    this.adminRoutesDir = path.join(this.projectRoot, "/admin/routes");
    this.adminComponentsDir = path.join(this.projectRoot, "/admin/components");
    this.adminHooksDir = path.join(this.projectRoot, "/admin/hooks");
    this.apiDir = path.join(this.projectRoot, "/api/admin");
  }

  protected async findModelFile(modelName: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.modelsDir, { withFileTypes: true });
      
      // Generate possible model name variations
      const variations = [
        modelName,
        this.toSingular(modelName),
        modelName.replace(/-/g, '_'),
        this.toSingular(modelName).replace(/-/g, '_'),
        modelName.replace(/_/g, '-'),
        this.toSingular(modelName).replace(/_/g, '-')
      ];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Try each variation
          for (const variation of variations) {
            const modelPath = path.join(this.modelsDir, entry.name, "models", `${variation}.ts`);
            try {
              await fs.access(modelPath);
              console.log(`📁 Found model file: ${modelPath}`);
              return modelPath;
            } catch {
              continue;
            }
          }
        }
      }
      
      console.error(`❌ Model file not found for: ${modelName}`);
      console.error(`🔍 Searched variations: ${variations.join(', ')}`);
      return null;
    } catch (error) {
      console.error("Error finding model file:", error);
      return null;
    }
  }

  protected async parseModelFile(filePath: string): Promise<ModelStructure | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const modelName = path.basename(filePath, ".ts");
      
      // Extract plural name from model definition
      const pluralMatch = content.match(/tableName:\s*["']([^"']+)["']/);
      const pluralName = pluralMatch ? pluralMatch[1] : `${modelName}s`;
      
      // Parse fields
      const fields: ModelField[] = [];
      const fieldRegex = /(\w+):\s*([^,\n]+)/g;
      let match;
      
      while ((match = fieldRegex.exec(content)) !== null) {
        const [, fieldName, fieldType] = match;
        
        if (['id', 'created_at', 'updated_at', 'deleted_at'].includes(fieldName)) {
          continue;
        }
        
        const isOptional = fieldType.includes('?') || fieldType.includes('null');
        const isEnum = fieldType.includes('enum(') || content.includes(`${fieldName}:`);
        
        // Extract enum values if present
        let enumValues: string[] | undefined;
        if (isEnum) {
          const enumMatch = content.match(new RegExp(`${fieldName}.*?enum\\(\\[([^\\]]+)\\]`));
          if (enumMatch) {
            enumValues = enumMatch[1].split(',').map(v => v.trim().replace(/['"]/g, ''));
          }
        }
        
        // Determine searchable and filterable
        const isSearchable = fieldName === 'name' || fieldName === 'title' || fieldName === 'description';
        const isFilterable = isEnum || fieldType.includes('boolean') || fieldName === 'status';
        
        fields.push({
          name: fieldName,
          type: this.mapFieldType(fieldType),
          isOptional,
          isEnum,
          enumValues,
          isSearchable,
          isFilterable,
          defaultValue: this.extractDefaultValue(fieldType)
        });
      }
      
      return {
        name: modelName,
        pluralName,
        fields,
        hasSearchableFields: fields.some(f => f.isSearchable),
        filterableFields: fields.filter(f => f.isFilterable),
        enumFields: fields.filter(f => f.isEnum)
      };
    } catch (error) {
      console.error("Error parsing model file:", error);
      return null;
    }
  }

  private mapFieldType(fieldType: string): string {
    if (fieldType.includes('number') || fieldType.includes('int')) return 'number';
    if (fieldType.includes('boolean')) return 'boolean';
    if (fieldType.includes('Date')) return 'dateTime';
    if (fieldType.includes('text()')) return 'text';
    return 'string';
  }

  private extractDefaultValue(fieldType: string): string | undefined {
    const defaultMatch = fieldType.match(/default\(([^)]+)\)/);
    return defaultMatch ? defaultMatch[1].replace(/['"]/g, '') : undefined;
  }

  protected toPascalCase(str: string): string {
    // Convert hyphens, underscores, and first char to PascalCase
    return str.replace(/(?:^|[-_])(\w)/g, (_, char) => char.toUpperCase());
  }

  protected toCamelCase(str: string): string {
    // Convert hyphens and underscores to camelCase
    return str.replace(/[-_](.)/g, (_, char) => char.toUpperCase())
              .replace(/^[A-Z]/, char => char.toLowerCase());
  }

  protected toKebabCase(str: string): string {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
  }

  protected toSingular(str: string): string {
    if (str.endsWith('ies')) {
      return str.slice(0, -3) + 'y';
    }
    if (str.endsWith('s') && !str.endsWith('ss')) {
      return str.slice(0, -1);
    }
    return str;
  }
}
