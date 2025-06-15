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
  const fieldRegex = /^\s*(\w+):\s*model\.([a-zA-Z]+)/;
  
  for (const line of lines) {
    const fieldMatch = line.match(fieldRegex);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldType = fieldMatch[2];

      const isRelation = fieldType === 'belongsTo' || fieldType === 'hasMany' || fieldType === 'id';
      // Check if this field was already captured as a belongsTo dependency
      const isAlreadyDependency = dependencies.some(dep => dep.name === fieldName);
      const isNullable = line.includes('.nullable()');
      
      if (fieldName !== 'id' && !isRelation && !isAlreadyDependency && !isNullable) {
        requiredFields.push({ name: fieldName, type: fieldType });
      }
    }
  }

  return { dependencies, requiredFields };
};