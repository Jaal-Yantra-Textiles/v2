import { runGenerator } from '../generate-integration-test';
import { parseModel } from '../utils/model-parser';
import { generateTestFileContent } from '../utils/test-template';
import fs from 'fs/promises';
import path from 'path';

// Mock the modules that have side effects or are external dependencies
jest.mock('fs/promises');
jest.mock('../utils/model-parser');
jest.mock('../utils/test-template');

// Mock process.cwd() to ensure consistent paths
const mockCwd = '/test/project/root';
const originalCwd = process.cwd;

// Mock console methods
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

describe('generate-integration-test Script', () => {
  // Cast mocks to their Jest-mocked types for type safety
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedParseModel = parseModel as jest.MockedFunction<typeof parseModel>;
  const mockedGenerateTestFileContent = generateTestFileContent as jest.MockedFunction<typeof generateTestFileContent>;

  beforeAll(() => {
    // @ts-ignore
    process.cwd = jest.fn(() => mockCwd);
  });

  afterAll(() => {
    // @ts-ignore
    process.cwd = originalCwd; // Restore original cwd
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // Reset mocks before each test
    mockedFs.mkdir.mockClear();
    mockedFs.writeFile.mockClear();
    mockedParseModel.mockClear();
    mockedGenerateTestFileContent.mockClear();
    mockConsoleLog.mockClear();
    mockConsoleError.mockClear();

    // Default mock implementations (can be overridden in specific tests)
    mockedParseModel.mockResolvedValue({ dependencies: [], requiredFields: [] });
    mockedGenerateTestFileContent.mockReturnValue('// Generated test content');
    mockedFs.mkdir.mockResolvedValue(undefined); // Corresponds to { recursive: true } success
    mockedFs.writeFile.mockResolvedValue(undefined);
  });

  it('should call parseModel with the correct model path', async () => {
    const moduleName = 'socials'; // Changed to snake_case
    const modelName = 'SocialPlatform';
    await runGenerator(moduleName, modelName);

    const expectedModelPath = path.join(mockCwd, 'src', 'modules', 'socials', 'models', 'SocialPlatform.ts');
    expect(mockedParseModel).toHaveBeenCalledWith(expectedModelPath);
  });

  it('should call generateTestFileContent with correct parameters', async () => {
    const moduleName = 'UserManagement';
    const modelName = 'UserProfile';
    const mockDeps = [{ name: 'role', pascal: 'Role', kebab: 'role', var: 'role' }]; // Added name: 'role'
    const mockFields = [{ name: 'email', type: 'string' }];

    mockedParseModel.mockResolvedValue({ dependencies: mockDeps, requiredFields: mockFields });

    await runGenerator(moduleName, modelName);

    expect(mockedGenerateTestFileContent).toHaveBeenCalledWith(
      'UserProfile',      // modelNamePascal
      'user-profile',     // modelNameKebab
      mockDeps,
      mockFields
    );
  });

  it('should call fs.mkdir and fs.writeFile with correct paths and content', async () => {
    const moduleName = 'Orders';
    const modelName = 'LineItem';
    const generatedContent = '// Test content for LineItem';
    mockedGenerateTestFileContent.mockReturnValue(generatedContent);

    await runGenerator(moduleName, modelName);

    const expectedTestDir = path.join(mockCwd, 'integration-tests', 'http', 'orders');
    const expectedTestFilePath = path.join(expectedTestDir, 'line-item-api.spec.ts');

    expect(mockedFs.mkdir).toHaveBeenCalledWith(expectedTestDir, { recursive: true });
    expect(mockedFs.writeFile).toHaveBeenCalledWith(expectedTestFilePath, generatedContent);
  });

  it('should log success messages on successful generation', async () => {
    const moduleName = 'Products';
    const modelName = 'ProductVariant';

    await runGenerator(moduleName, modelName);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining(`Generating integration test for model 'ProductVariant' in module 'Products'...`)
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Successfully generated test for ProductVariant at:')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith('Dependencies found:', []);
    expect(mockConsoleLog).toHaveBeenCalledWith('Required fields found:', []);
  });

  it('should log an error and rethrow if parseModel fails', async () => {
    const moduleName = 'Inventory';
    const modelName = 'StockLocation';
    const errorMessage = 'Failed to parse model';
    mockedParseModel.mockRejectedValue(new Error(errorMessage));

    await expect(runGenerator(moduleName, modelName)).rejects.toThrow(errorMessage);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Error generating test for StockLocation:`),
      expect.any(Error)
    );
  });

   it('should log an error and rethrow if fs.writeFile fails', async () => {
    const moduleName = 'Customers';
    const modelName = 'CustomerGroup';
    const errorMessage = 'Failed to write file';
    mockedFs.writeFile.mockRejectedValue(new Error(errorMessage));

    await expect(runGenerator(moduleName, modelName)).rejects.toThrow(errorMessage);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Error generating test for CustomerGroup:`),
      expect.any(Error)
    );
  });

  it('should correctly convert mixed-case inputs for module and model names', async () => {
    // moduleNameInput is expected to be the snake_case directory name by runGenerator for model path
    const moduleNameInput = 'user_management_system'; // Changed to snake_case
    const modelNameInput = 'userProfile-Detail'; // This will be cased by the script for model/test file names

    await runGenerator(moduleNameInput, modelNameInput);

    // Assert that paths are constructed with correctly cased names
    // modelNamePascal becomes 'UserProfileDetail', modelNameKebab becomes 'user-profile-detail'
    // moduleNameInput ('user_management_system') is used directly for model path's module directory.
    // moduleNameKebab for test directory becomes 'user-management-system' (from toKebabCase(moduleNameInput)).
    const expectedModelPath = path.join(mockCwd, 'src', 'modules', 'user_management_system', 'models', 'UserProfileDetail.ts');
    const expectedTestDir = path.join(mockCwd, 'integration-tests', 'http', 'user-management-system');
    const expectedTestFilePath = path.join(expectedTestDir, 'user-profile-detail-api.spec.ts');

    expect(mockedParseModel).toHaveBeenCalledWith(expectedModelPath);
    expect(mockedFs.mkdir).toHaveBeenCalledWith(expectedTestDir, { recursive: true });
    expect(mockedFs.writeFile).toHaveBeenCalledWith(expectedTestFilePath, '// Generated test content');
    expect(mockedGenerateTestFileContent).toHaveBeenCalledWith(
      'UserProfileDetail', 
      'user-profile-detail',
      [],
      []
    );
  });

  it('should log an error and rethrow if fs.mkdir fails', async () => {
    const moduleName = 'Discounts';
    const modelName = 'DiscountRule';
    const errorMessage = 'Failed to create directory';
    mockedFs.mkdir.mockRejectedValue(new Error(errorMessage));

    await expect(runGenerator(moduleName, modelName)).rejects.toThrow(errorMessage);
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(`Error generating test for DiscountRule:`),
      expect.any(Error)
    );
  });

  it('should log correct dependency and required field names on success', async () => {
    const moduleName = 'Shipping';
    const modelName = 'ShippingOption';
    const mockDeps = [{ name: 'region', pascal: 'Region', kebab: 'region', var: 'region' }]; // Added name: 'region'
    const mockFields = [{ name: 'price', type: 'number' }, { name: 'name', type: 'string' }];

    mockedParseModel.mockResolvedValue({ dependencies: mockDeps, requiredFields: mockFields });

    await runGenerator(moduleName, modelName);

    expect(mockConsoleLog).toHaveBeenCalledWith('Dependencies found:', ['Region']);
    expect(mockConsoleLog).toHaveBeenCalledWith('Required fields found:', ['price', 'name']);
  });

  // Add more tests: e.g., for specific dependency/field outputs in logs

});
