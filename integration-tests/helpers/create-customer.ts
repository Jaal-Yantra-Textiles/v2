import { Modules } from "@medusajs/utils";
import { createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows";
import Scrypt from "scrypt-kdf";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";

// Store the generated credentials for the current test run
let testCustomerCredentials: {
  email: string;
  password: string;
  customerId?: string;
  authIdentityId?: string;
  publishableApiKey?: string;
} = {
  email: '',
  password: "customerpassword",  // Keep a fixed password for simplicity
};

function generateRandomString(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);
}

/**
 * Generates a JWT token directly for the customer (for testing purposes)
 * This avoids the need to call the auth API route
 * Also includes the publishable API key required for store routes
 */
export const getCustomerAuthHeaders = async () => {
  if (!testCustomerCredentials.customerId || !testCustomerCredentials.authIdentityId) {
    throw new Error("No test customer has been created yet. Call createTestCustomer first.");
  }

  const token = jwt.sign(
    {
      actor_id: testCustomerCredentials.customerId,
      actor_type: "customer",
      auth_identity_id: testCustomerCredentials.authIdentityId,
    },
    "supersecret",
    {
      expiresIn: "1d",
    }
  );

  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-publishable-api-key": testCustomerCredentials.publishableApiKey || "",
    },
  };
};

export const createTestCustomer = async (container: any) => {
  const customerModule = container.resolve(Modules.CUSTOMER);
  const authModule = container.resolve(Modules.AUTH);

  // Generate a random email for this test run
  const randomString = generateRandomString(8);
  const email = `customer-${randomString}@jyt.test`;

  const customer = await customerModule.createCustomers({
    first_name: "Test",
    last_name: "Customer",
    email: email,
  });

  const hashConfig = { logN: 15, r: 8, p: 1 };
  const passwordHash = await Scrypt.kdf(testCustomerCredentials.password, hashConfig);

  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: {
          password: passwordHash.toString("base64"),
        },
      },
    ],
    app_metadata: {
      customer_id: customer.id,
    },
  });

  // Create a publishable API key using the workflow (required for store routes)
  const { result: apiKeys } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          type: "publishable",
          title: `Test Key ${randomString}`,
          created_by: customer.id,
        },
      ],
    },
  });

  const apiKey = apiKeys[0];

  // Link the API key to the default sales channel
  // This is required for Medusa to accept the publishable key as "valid"
  const storeService = container.resolve(Modules.STORE) as any;
  const stores = await storeService.listStores({});
  const store = stores?.[0];

  if (store?.default_sales_channel_id) {
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: apiKey.id,
        add: [store.default_sales_channel_id],
      },
    });
  }

  // Store the generated credentials for later use
  testCustomerCredentials.email = email;
  testCustomerCredentials.customerId = customer.id;
  testCustomerCredentials.authIdentityId = authIdentity.id;
  testCustomerCredentials.publishableApiKey = apiKey.token;

  return { customer, authIdentity, email, apiKey };
};

export const getTestCustomerCredentials = () => testCustomerCredentials;

/**
 * Resets the test customer credentials.
 * Useful when creating multiple customers in different tests.
 */
export const resetTestCustomerCredentials = () => {
  testCustomerCredentials = {
    email: '',
    password: "customerpassword",
  };
};
