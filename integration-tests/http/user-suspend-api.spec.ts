import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { AdminUser } from "@medusajs/types";

jest.setTimeout(50000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let adminHeaders;
    let newAdminUser: AdminUser;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    describe("POST /admin/users/:id/suspend", () => {
      const userEmail = "new-admin@medusa-test.com";
      const userPassword = "supersecret";

      beforeEach(async () => {
        try {
          console.log("Step 1: Creating invite...");
          const inviteResponse = await api.post(
            "/admin/invites",
            { email: userEmail },
            adminHeaders
          );
          expect(inviteResponse.status).toBe(200);
          const inviteToken = inviteResponse.data.invite.token;
          console.log("Step 1: Invite created successfully.");

          console.log("Step 2: Registering user...");
          const registrationResponse = await api.post("/auth/user/emailpass/register", {
            email: userEmail,
            password: userPassword,
          });
          console.log("Step 2: User registered successfully.");
          const registrationToken = registrationResponse.data.token;
          const newUserAuthHeaders = {
            headers: {
              Authorization: `Bearer ${registrationToken}`,
            },
          };

          console.log("Step 3: Accepting invite...");
          const acceptInviteResponse = await api.post(
            `/admin/invites/accept?token=${inviteToken}`,
            {
              email: userEmail,
              first_name: "New",
              last_name: "Admin",
            },
            newUserAuthHeaders
          );
          expect(acceptInviteResponse.status).toBe(200);
          newAdminUser = acceptInviteResponse.data.user;
          console.log("Step 3: Invite accepted successfully.");

          console.log("Step 4: Logging in to confirm activation...");
          const loginResponse = await api.post("/auth/user/emailpass", {
            email: userEmail,
            password: userPassword,
          });
          expect(loginResponse.status).toBe(200);
          expect(loginResponse.data.token).toBeDefined();
          console.log("Step 4: Login confirmation successful.");

        } catch (error) {
          console.error("Error during setup:", {
            status: error.response?.status,
            data: error.response?.data,
            config: {
              method: error.config?.method,
              url: error.config?.url,
              data: error.config?.data,
            }
          });
          // Re-throw the error to make the test fail
          throw error;
        }
      });

      it("should suspend a user and prevent login", async () => {
        try {
          // 3. Suspend the user
          const suspendResponse = await api.post(
            `/admin/users/${newAdminUser.id}/suspend`,
            {},
            adminHeaders
          );
          expect(suspendResponse.status).toBe(200);
          expect(suspendResponse.data.suspended).toBe(true);

          // 4. Attempt to login with suspended user - should fail
          await expect(
            api.post("/auth/user/emailpass", {
              email: userEmail,
              password: userPassword,
            })
          ).rejects.toMatchObject({
            response: {
              status: 401,
              data: {
                message: "Invalid email or password",
              },
            },
          });
        } catch (error) {
          console.error("Error during test execution:", {
            status: error.response?.status,
            data: error.response?.data,
            config: {
              method: error.config?.method,
              url: error.config?.url,
              data: error.config?.data,
            },
          });
          throw error;
        }
      });
    });
  },
});
