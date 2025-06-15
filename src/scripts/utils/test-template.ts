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
      ...requiredFields.map(field => `${field.name}: ${field.type === 'enum' ? '"draft"' : `"Test ${field.name}"`}`)
    ].join(',\n            ');
  
    const updatePayloadField = requiredFields.length > 0
      ? `${requiredFields[0].name}: "Updated ${requiredFields[0].name}"`
      : `// Add a field to update here`;
      
    const updateAssertion = requiredFields.length > 0 
      ? `expect(updateResponse.data.${modelNameCamel}.${requiredFields[0].name}).toEqual("Updated ${requiredFields[0].name}");` 
      : '';
  
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