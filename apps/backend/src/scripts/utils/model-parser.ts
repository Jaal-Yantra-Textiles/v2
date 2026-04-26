import fs from 'fs/promises';
import { toKebabCase } from './case-converters';

export interface ModelDependency {
  name: string;
  kebab: string;
  pascal: string;
}

export interface RequiredField {
  name: string;
  type: string;
  enumValues?: string[];
  defaultValue?: string;
}

export const parseModel = async (modelPath: string): Promise<{ dependencies: ModelDependency[], requiredFields: RequiredField[] }> => {
  const content = await fs.readFile(modelPath, 'utf-8');
  const dependencies: ModelDependency[] = [];
  const requiredFields: RequiredField[] = [];

  // Find belongsTo relationships
  // Corrected regex: ensures the ')' for belongsTo is outside the capturing group for the model name,
  // and allows for optional spaces before it.
  const belongsToRegex = /^\s*(\w+):\s*model\.belongsTo\(\s*\(\)\s*=>\s*(\w+)(\s*,\s*\{[^}]*\})?\s*\)/gm;
  let match;
  while ((match = belongsToRegex.exec(content)) !== null) {
    const depName = match[1]; // e.g., platform
    const depPascal = match[2]; // e.g., SocialPlatform
    dependencies.push({ name: depName, kebab: toKebabCase(depPascal), pascal: depPascal });
  }

  // Find other required fields by analyzing lines
  const lines = content.split('\n');
  const enumRegex = /^\s*(\w+):\s*model\.enum\(\s*(\[[^\]]+\])\s*\)(?:\.default\(\s*["'](\w+)["']\s*\))?/;
  const fieldRegex = /^\s*(\w+):\s*model\.([a-zA-Z]+)/;

  for (const line of lines) {
    const isNullable = line.includes('.nullable()');
    if (isNullable) continue; // Skip nullable fields for requiredFields

    const enumMatch = line.match(enumRegex);
    if (enumMatch) {
      const fieldName = enumMatch[1];
      const enumArrayString = enumMatch[2];
      const defaultValue = enumMatch[3]; // Might be undefined

      // Parse the enumArrayString (e.g., "[\"draft\", \"scheduled\"]") into string[]
      const enumValues = JSON.parse(enumArrayString.replace(/\'/g, '"')); // Ensure double quotes for JSON.parse
      
      requiredFields.push({
        name: fieldName,
        type: 'enum',
        enumValues: enumValues,
        defaultValue: defaultValue,
      });
    } else {
      const fieldMatch = line.match(fieldRegex);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldType = fieldMatch[2];

        // Avoid re-adding fields already processed as enums or if they are relations/id
        const isAlreadyProcessedAsEnum = requiredFields.some(rf => rf.name === fieldName && rf.type === 'enum');
        const isRelationOrId = fieldType === 'belongsTo' || fieldType === 'hasMany' || fieldType === 'id' || fieldName === 'id';
        const isAlreadyDependency = dependencies.some(dep => dep.name === fieldName);

        if (!isRelationOrId && !isAlreadyDependency && !isAlreadyProcessedAsEnum) {
          requiredFields.push({ name: fieldName, type: fieldType });
        }
      }
    }
  }

  return { dependencies, requiredFields };
};