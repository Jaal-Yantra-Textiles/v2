import { Modules } from "@medusajs/utils";
import Scrypt from "scrypt-kdf";
import { getContainer } from "./use_container.js";
import { ApiKeyType } from "@medusajs/utils";
import { randomBytes} from "crypto";

// Store the generated credentials for the current test run
let testUserCredentials = {
  email: '',
  password: "somepassword",  // Keep a fixed password for simplicity
};

function generateRandomString(length) {
  return randomBytes(Math.ceil(length / 2)) // Generate random bytes
    .toString('hex') // Convert to hexadecimal
    .slice(0, length); // Trim to desired length
}

const getAuthToken = async (
  api,
  email = testUserCredentials.email || "admin@medusa.js",
  password = testUserCredentials.password,
) => {
  if (!email) {
    console.warn("No test user has been created yet. Using default credentials.");
  }
  
  const response = await api.post("/auth/user/emailpass", {
    email,
    password,
  });
  return response.data.token;
};

export const getAuthHeaders = async (api) => {
  const token = await getAuthToken(api);
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
};

export const createAdminUser = async (container?) => {
  const appContainer = container ?? getContainer()!;
  const userModule = appContainer.resolve(Modules.USER);
  const authModule = appContainer.resolve(Modules.AUTH);
  const apiModule = appContainer.resolve(Modules.API_KEY);
  
  // Generate a random email for this test run
  const randomString = generateRandomString(8);
  const email = `admin-${randomString}@jyt.test`;
  
  // Store the generated email for later use
  testUserCredentials.email = email;
  
  const user = await userModule.createUsers({
    first_name: "Admin",
    last_name: "User",
    email: email,
  });

  const apiKey = await apiModule.createApiKeys({
    title: "testing",
    type: ApiKeyType.PUBLISHABLE,
    created_by: user.id,
  });

  const hashConfig = { logN: 15, r: 8, p: 1 };
  const passwordHash = await Scrypt.kdf(testUserCredentials.password, hashConfig);

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
      user_id: user.id,
    },
  });

  return { user, authIdentity, apiKey };
};