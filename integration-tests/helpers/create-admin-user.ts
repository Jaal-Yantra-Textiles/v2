import { Modules } from "@medusajs/utils";
import Scrypt from "scrypt-kdf";
import { getContainer } from "./use_container.js";
import { ApiKeyType } from "@medusajs/utils";

const getAuthToken = async (
  api,
  email = "admin@medusa.js",
  password = "somepassword",
) => {
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

export const createAdminUser = async ( container?) => {
  const appContainer = container ?? getContainer()!;
  const userModule = appContainer.resolve(Modules.USER);
  const authModule = appContainer.resolve(Modules.AUTH);
  const apiModule = appContainer.resolve(Modules.API_KEY);

  const user = await userModule.createUsers({
    first_name: "Admin",
    last_name: "User",
    email: "admin@medusa.js",
  });

  const apiKey = await apiModule.createApiKeys({
    title: "testing",
    type: ApiKeyType.PUBLISHABLE,
    created_by: user.id,
  });

  const hashConfig = { logN: 15, r: 8, p: 1 };
  const passwordHash = await Scrypt.kdf("somepassword", hashConfig);

  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: "admin@medusa.js",
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
