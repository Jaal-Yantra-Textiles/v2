import { ModelDependency, RequiredField } from "./model-parser";

export const generateTestFileContent = (
    modelNamePascal: string,
    modelNameKebab: string,
    dependencies: ModelDependency[],
    requiredFields: RequiredField[]
  ): string => {
    const modelNameTitleCase = modelNamePascal.replace(/([A-Z])/g, ' $1').trim();
    const modelNameVar = modelNameKebab.replace(/-/g, '_'); // Still used for delete object key, may need adjustment
    const modelNameCamel = modelNamePascal.charAt(0).toLowerCase() + modelNamePascal.slice(1);
    const pluralModelNameCamel = modelNameCamel.endsWith('s') ? modelNameCamel : modelNameCamel + 's'; // Simple pluralization
  
    const dependencyCreationBlock = dependencies.map(dep => `
        // Create ${dep.pascal}
        const ${dep.name}Response = await api.post(
          '/admin/${dep.kebab}',
          { name: 'Test ${dep.pascal}' },
          adminHeaders
        );
        expect(${dep.name}Response.status).toBe(201);
        ${dep.name}Id = ${dep.name}Response.data.${(dep.pascal.charAt(0).toLowerCase() + dep.pascal.slice(1))}.id;`).join('');
  
    const createPayloadFields = [
      ...dependencies.map(dep => `${dep.name}_id: ${dep.name}Id`),
      ...requiredFields.map(field => {
        if (field.type === 'enum') {
          let value = '"MISSING_ENUM_VALUE"'; // Fallback
          if (field.defaultValue && field.enumValues && field.enumValues.includes(field.defaultValue)) {
            value = JSON.stringify(field.defaultValue);
          } else if (field.enumValues && field.enumValues.length > 0) {
            value = JSON.stringify(field.enumValues[0]);
          }
          return `${field.name}: ${value}`;
        } else {
          return `${field.name}: "Test ${field.name}"`;
        }
      })
    ].join(',\n            ');
  
    let updatePayloadField = '// Add a field to update here';
    let updateAssertion = '';

    if (requiredFields.length > 0) {
      const firstField = requiredFields[0];
      if (firstField.type === 'enum' && firstField.enumValues && firstField.enumValues.length > 0) {
        // Try to pick a different enum value for update
        // If create used defaultValue or enumValues[0], try enumValues[1] or fallback to enumValues[0]
        let createValue = firstField.defaultValue && firstField.enumValues.includes(firstField.defaultValue) 
                          ? firstField.defaultValue 
                          : firstField.enumValues[0];
        let updateValue = firstField.enumValues[0]; // Default to first if no other option
        if (firstField.enumValues.length > 1) {
          updateValue = (firstField.enumValues[0] === createValue) ? firstField.enumValues[1] : firstField.enumValues[0];
        } else {
          updateValue = firstField.enumValues[0]; // Only one value, use it
        }
        updatePayloadField = `${firstField.name}: ${JSON.stringify(updateValue)}`;
        updateAssertion = `expect(updateResponse.data.${modelNameCamel}.${firstField.name}).toEqual(${JSON.stringify(updateValue)});`;
      } else {
        // Non-enum field update logic
        const updatedValue = `Updated ${firstField.name}`;
        updatePayloadField = `${firstField.name}: ${JSON.stringify(updatedValue)}`;
        updateAssertion = `expect(updateResponse.data.${modelNameCamel}.${firstField.name}).toEqual(${JSON.stringify(updatedValue)});`;
      }
    }
  
    return `
  import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
  import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
  
  jest.setTimeout(60000);
  
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      let adminHeaders;
      ${dependencies.map(dep => `let ${dep.name}Id;`).join('\\n    ')}
  
      beforeEach(async () => {
        const container = getContainer();
        await createAdminUser(container);
        adminHeaders = await getAuthHeaders(api);
  ${dependencyCreationBlock}
      });
  
      describe("${modelNameTitleCase} API", () => {
        it("should perform full CRUD for a ${modelNameTitleCase.toLowerCase()}", async () => {
          // 1. Create
          const createPayload = {
            ${createPayloadFields}
          };
          const createResponse = await api.post(
            "/admin/${modelNameKebab}",
            createPayload,
            adminHeaders
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.${modelNameCamel}).toBeDefined();
          const createdId = createResponse.data.${modelNameCamel}.id;
          expect(createdId).not.toBeNull();
  
          // 2. Get
          const getResponse = await api.get(\`/admin/${modelNameKebab}/\${createdId}\`, adminHeaders);
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.${modelNameCamel}.id).toEqual(createdId);
  
          // 3. Update
          const updatePayload = {
            ${updatePayloadField}
          };
          const updateResponse = await api.post(
            \`/admin/${modelNameKebab}/\${createdId}\`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          ${updateAssertion}
  
          // 4. List
          const listResponse = await api.get(\`/admin/${modelNameKebab}\`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.${pluralModelNameCamel}).toBeInstanceOf(Array);
          
          // 5. Delete
          const deleteResponse = await api.delete(\`/admin/${modelNameKebab}/\${createdId}\`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "${modelNameVar}", // Medusa default is often snake_case for 'object' key, verify if this needs to be modelNameCamel
            deleted: true,
          });
  
          // 6. Verify Deletion
          await api.get(\`/admin/${modelNameKebab}/\${createdId}\`, adminHeaders).catch(err => {
            expect(err.response.status).toBe(404);
          });
        });
      });
    },
  });
  `;
  };