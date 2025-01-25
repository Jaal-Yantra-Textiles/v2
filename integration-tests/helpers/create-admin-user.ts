import { ContainerRegistrationKeys, Modules } from "@medusajs/utils";
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

export const createAdminUser = async (container) => {
  const userModule = container.resolve("userModule");
  const apiModule = container.resolve("apiModule");
  const roleModule = container.resolve("roleModule");

  // Create admin role if it doesn't exist
  const role = await roleModule.createRole({
    name: "admin",
    permissions: ["*"],
  });

  // Create user with random timestamp to ensure uniqueness
  const timestamp = Date.now();
  const user = await userModule.createUsers({
    first_name: `Admin_${timestamp}`,
    last_name: `User_${timestamp}`,
    email: `admin_${timestamp}@medusa.js`,
  });

  const apiKey = await apiModule.createApiKeys({
    user_id: user.id,
    role_id: role.id,
  });

  return { user, apiKey };
};
