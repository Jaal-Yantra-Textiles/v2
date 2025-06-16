# MedusaJS Module and Test Generation: Complete Flow

This document outlines the steps to generate a new MedusaJS module, including its model, service, workflows, API routes, and integration tests, using the provided scripts.

## Complete Generation and Testing Workflow

The following steps outline the process from creating a module structure to testing its API. Note that while scripts automate much of the boilerplate, manual review and refinement are crucial at several stages.

### Step 1: Define Module and Generate Model

This initial step establishes the module's directory structure and creates the core model file, a basic service, and registers the module with Medusa.

*   **Action:** Use the `generate-model.ts` script.
*   **Command:**
    ```bash
    npx medusa exec ./src/scripts/generate-model.ts <ModuleNameSnakeCase> <ModelNamePascalCase> "fieldName1:type fieldName2:type ..."
    ```
    *   `<ModuleNameSnakeCase>` (e.g., `test_sample`): This defines the primary directory for your module's components (`src/modules/<ModuleNameSnakeCase>/`).
    *   `<ModelNamePascalCase>` (e.g., `TestItem`): The name of your entity.
    *   `"fieldName1:type ..."`: Fields for your model.
*   **Outcome:** 
    *   Creates `src/modules/<ModuleNameSnakeCase>/models/<ModelNamePascalCase>.ts`.
    *   Creates `src/modules/<ModuleNameSnakeCase>/service.ts`.
    *   Adds the module to `medusa-config.ts`.
*   **Manual Review & Refinement:**
    *   **Model Definition:** Open the generated model file. Review field types, add relationships (`belongsTo`, `hasMany`, etc.), and define any custom properties or methods.
    *   **`medusa-config.ts`:** Confirm the module (e.g., `{ resolve: "./src/modules/<ModuleNameSnakeCase>" }`) is correctly listed. For complex modules with inter-dependencies, ensure the order is appropriate.
    *   **Service File:** The generated service is basic. Plan to enhance it with specific business logic as needed.

### Step 2: Generate Workflows

Workflows orchestrate the logic for your module's operations.

*   **Action:** Use the `generate-workflows.ts` script.
*   **Command:**
    ```bash
    npx medusa exec ./src/scripts/generate-workflows.ts <ModuleNameSnakeCase> <ModelNamePascalCase>
    ```
*   **Outcome:** Creates CRUD workflow files (e.g., `create-<modelNameKebabCase>.ts`, `update-<modelNameKebabCase>.ts`) in `src/workflows/<ModuleNameSnakeCase>/`.
*   **Manual Review & Refinement:**
    *   **Workflow Inputs:** Examine the `Input` type defined in each workflow (e.g., `CreateTestItemWorkflow.Input`). The generator makes basic assumptions; you may need to add, remove, or modify fields to match your precise requirements for creation or updates (e.g., making certain fields conditionally required, adding non-model data).
    *   **Workflow Logic:** Review the steps within each workflow. For complex operations, you might need to add more steps, integrate other services, or customize transaction behavior.

### Step 3: Generate API Routes & Validators

This step creates the HTTP interface for your module.

*   **Action:** Use the `generate-api.ts` script.
*   **Command:**
    ```bash
    npx medusa exec ./src/scripts/generate-api.ts <ModuleNameSnakeCase> <ModelNamePascalCase>
    ```
*   **Outcome:** Creates API route handlers (e.g., `src/api/admin/<model_name_kebab_case>/route.ts`), Zod schemas for validation (`validators.ts`), and helper functions (`helpers.ts`).
*   **Manual Review & Refinement:**
    *   **API Validators (`validators.ts`):** This is a critical step. Open the generated `validators.ts` file. Review and adjust the Zod schemas (e.g., `TestItemCreateSchema`, `TestItemUpdateSchema`). Ensure they accurately reflect the expected request payloads for creating and updating your entity. Pay attention to optional vs. required fields, data types, and any specific validation rules (e.g., min/max length, enums).
    *   **Route Handlers (`route.ts`):** Check how `req.validatedBody` (from the validators) is used. Ensure the data passed to workflows is correct. Review response structures and status codes.
    *   **Middleware Considerations:** For standard admin API routes in `src/api/admin/`, Medusa's file-based routing and global admin authentication usually suffice. However, if you have custom authentication needs, rate limiting, or other specific middleware requirements for these routes, you might need to add a `config` export to your `route.ts` files or, for more global middleware, adjust `medusa-config.ts`.

### Step 4: Generate Integration Test

Automated tests verify that your API behaves as expected.

*   **Action:** Use the `generate-integration-test.ts` script.
*   **Command:** (Covered in more detail in the next section)
    ```bash
    npx medusa exec ./src/scripts/generate-integration-test.ts <ModuleNameSnakeCase> <ModelNamePascalCase>
    ```
*   **Outcome:** Creates an integration test file (e.g., `integration-tests/http/<module_name_snake_case>/<model_name_kebab_case>-api.spec.ts`).
*   **Manual Review & Refinement:**
    *   **Test Payloads:** Verify that the `createPayload` and `updatePayload` in the test match the (now manually refined) API validators and workflow inputs.
    *   **Assertions:** Ensure the test asserts the correct response data, status codes, and any side effects.

### Step 5: Run the Integration Test

Execute the test to confirm end-to-end functionality.

*   **Command:**
    ```bash
    TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules npx jest integration-tests/http/<module_name_snake_case>/<model_name_kebab_case>-api.spec.ts --verbose
    ```
*   **Troubleshooting:**
    *   **404 Errors:** If tests fail with 404 errors, **restart your Medusa development server**. This is often the primary solution after adding new modules or API routes.
    *   **Validation Errors (400/422):** Check your API validators (`validators.ts`) and the payloads sent by the integration test.
    *   **Workflow Errors (500):** Debug the relevant workflow and its interaction with the service and database.
    *   **Other Failures:** Examine test output, API route handlers, and workflow logic.

---

# Integration Test Generator (`generate-integration-test.ts`)

(This section focuses specifically on the `generate-integration-test.ts` script, which is Step 4 in the complete flow.)

## Purpose

This script automates the creation of Jest-based full CRUD (Create, Read, Update, Delete) integration test files for MedusaJS modules. It parses a given MedusaJS model file to identify its dependencies (from `belongsTo` relationships) and required fields, then generates a `.spec.ts` file with a complete test suite.

## Prerequisites

1.  **Node.js and TypeScript Environment:** The script is written in TypeScript and needs `ts-node` to run directly, or it can be compiled to JavaScript first.
2.  **MedusaJS Project Structure:** The script assumes it's being run within a MedusaJS project, particularly for resolving model paths and outputting test files to the conventional `integration-tests/http/` directory.
3.  **Model File:** The target MedusaJS model file (e.g., `SocialPlatform.ts`) must exist in the `src/modules/<module_name>/models/` directory.
4.  **Dependencies:** Ensure all necessary MedusaJS testing utilities and project dependencies are installed (e.g., `@medusajs/test-utils`, `jest`).

## How to Run

The script is executed using `ts-node` (or `node` if compiled) and requires two arguments:

```bash
npx medusa exec ./src/scripts/generate-integration-test.ts <ModelNamePascalCase> <ModuleNameSnakeCase>
```

Or, if you have a yarn/npm script configured in `package.json` (e.g., `"gen:test": "ts-node src/scripts/generate-integration-test.ts"`):

```bash
yarn gen:test <ModelNamePascalCase> <ModuleNameSnakeCase>
```

### Arguments

1.  **`<ModelNamePascalCase>` (Required):**
    *   The name of the MedusaJS model in PascalCase (e.g., `SocialPlatform`, `UserProfile`).
    *   This is used to locate the model file (e.g., `src/modules/<module_name>/models/<ModelNamePascalCase>.ts`).

2.  **`<ModuleNameSnakeCase>` (Required):**
    *   The name of the module containing the model, in snake_case (e.g., `socials`, `user_management`, `test_sample`). This must match the directory name in `src/modules/`.
    *   This is used to determine the model's directory path and the output subdirectory for the test file.

### Example

To generate an integration test for the `SocialPost` model located in the `socials` module (`src/modules/socials/models/SocialPost.ts`):

```bash
npx ts-node src/scripts/generate-integration-test.ts SocialPost socials
```

## Expected Output

*   A new test file will be generated in the following location:
    `integration-tests/http/<module_name_snake_case>/<model_name_kebab_case>-api.spec.ts`
    For the example above (assuming module name `socials`): `integration-tests/http/socials/social-post-api.spec.ts`
*   The generated file will contain a Jest test suite with `beforeEach` setup (including creation of dependencies) and a test case for the full CRUD lifecycle of the specified model.

## Important Considerations & Best Practices

1.  **API Response Key Conventions:**
    *   The generated tests expect API responses to follow specific casing conventions for the main entity/entities in the JSON data:
        *   **Single Entity (Create, Get, Update):** camelCase (e.g., `response.data.socialPlatform`).
        *   **List of Entities:** Plural camelCase (e.g., `response.data.socialPlatforms`).
        *   **Delete Confirmation `object` Key:** snake_case (e.g., `response.data.object: "social_platform"`).
    *   Ensure your API route handlers (`src/api/admin/.../route.ts`) adhere to these conventions. If they differ, you will need to manually adjust the assertions in the generated test file.

2.  **API Route Structure and Validation:**
    *   The `generate-api.ts` script creates route handlers (e.g., `src/api/admin/<model_name_kebab_case>/route.ts`) and associated validator files (e.g., `validators.ts`).
    *   Medusa v2 uses file-based routing for API endpoints in the `src/api` directory. These routes should be automatically discovered.
    *   Ensure that the generated validators (`YourModelCreateSchema`, `YourModelUpdateSchema`, etc.) correctly define the expected request body and query parameters. The route handlers use these for validation (e.g., `req.validatedBody`).
    *   Authentication middleware for admin routes is typically handled globally by Medusa or can be specified in the route's `config` export if needed, but often isn't required per-route for standard admin authentication.
    *   If API routes are not found (404 errors), ensure your Medusa server has been restarted after file generation.

3.  **Model Parsing Limitations:**
    *   The script parses `belongsTo` relationships to identify dependencies. Ensure these are defined clearly in your model file.
    *   It identifies required fields (fields not explicitly marked `.nullable()`).
    *   Complex relationships or field types might require manual adjustments in the generated test's payload creation.

4.  **Dependency Creation in Tests:**
    *   The `beforeEach` block in the generated test attempts to create instances of identified dependencies. It assumes these dependencies have a simple creation API (e.g., `POST /admin/<dependency_kebab_case>` with a `{ name: 'Test DependencyName' }` payload).
    *   If dependency creation is more complex, you'll need to modify this part of the test.

5.  **Pluralization:**
    *   The script uses a simple pluralization logic (adds 's' unless already ending in 's') for generating the expected key for list responses (e.g., `socialPlatform` -> `socialPlatforms`). For models with irregular pluralizations (e.g., 'Company' -> 'Companies'), you may need to manually adjust the list assertion in the generated test.

6.  **Test Execution Environment:**
    *   Ensure your Jest tests are run with `NODE_OPTIONS=--experimental-vm-modules` if your project or its dependencies use ES Modules or dynamic imports, as this can cause `TypeError: A dynamic import callback was invoked without --experimental-vm-modules`.

By following these instructions and considerations, you can effectively use the integration test generator to streamline your MedusaJS backend testing workflow.
