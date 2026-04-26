import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { AdminUser } from "@medusajs/types";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(50000);

setupSharedTestSuite(() => {
    let adminHeaders;
    let newAdminUser: AdminUser;
    const { api , getContainer } = getSharedTestEnv() 
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    describe("POST /admin/users/:id/unsuspend", () => {
      const userEmail = "suspended-admin@medusa-test.com";
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
              first_name: "Suspended",
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

          console.log("Step 5: Suspending user...");
          const suspendResponse = await api.post(
            `/admin/users/${newAdminUser.id}/suspend`,
            {},
            adminHeaders
          );
          expect(suspendResponse.status).toBe(200);
          expect(suspendResponse.data.suspended).toBe(true);
          console.log("Step 5: User suspended successfully.");

          console.log("Step 6: Confirming user cannot login while suspended...");
          await expect(
            api.post("/auth/user/emailpass", {
              email: userEmail,
              password: userPassword,
            })
          ).rejects.toMatchObject({
            response: {
              status: 400,
              data: {
                message: "Invalid email or password",
              },
            },
          });
          console.log("Step 6: Suspension confirmed - login blocked.");

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

      it("should unsuspend a user and restore login capability", async () => {
        try {
          console.log("Test: Unsuspending user...");
          // 1. Unsuspend the user
          const unsuspendResponse = await api.post(
            `/admin/users/${newAdminUser.id}/unsuspend`,
            {},
            adminHeaders
          );
          expect(unsuspendResponse.status).toBe(200);
          console.log('Unsuspension Response :', unsuspendResponse.data)
          expect(unsuspendResponse.data.suspended).toBe(false);
          console.log("Test: User unsuspended successfully.");

          console.log("Test: Attempting login after unsuspension...");
          // 2. Attempt to login with unsuspended user - should succeed
          const loginResponse = await api.post("/auth/user/emailpass", {
            email: userEmail,
            password: userPassword,
          });
          expect(loginResponse.status).toBe(200);
          expect(loginResponse.data.token).toBeDefined();
          console.log("Test: Login successful after unsuspension.");

          console.log("Test: Verifying token works for authenticated requests...");
          // 3. Verify the token works for authenticated requests
          const profileResponse = await api.get("/admin/users/me", {
            headers: {
              Authorization: `Bearer ${loginResponse.data.token}`,
            },
          });
          expect(profileResponse.status).toBe(200);
          expect(profileResponse.data.user.email).toBe(userEmail);
          console.log("Test: Authenticated request successful.");

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
          // Re-throw the error to make the test fail
          throw error;
        }
      });

      it("should handle unsuspending an already active user gracefully", async () => {
        try {
          console.log("Test: First unsuspend (should succeed)...");
          // 1. First unsuspend - should succeed
          const firstUnsuspendResponse = await api.post(
            `/admin/users/${newAdminUser.id}/unsuspend`,
            {},
            adminHeaders
          );
          expect(firstUnsuspendResponse.status).toBe(200);
          expect(firstUnsuspendResponse.data.suspended).toBe(false);

          console.log("Test: Second unsuspend (should handle gracefully)...");
          // 2. Second unsuspend - should handle gracefully (user already active)
          const secondUnsuspendResponse = await api.post(
            `/admin/users/${newAdminUser.id}/unsuspend`,
            {},
            adminHeaders
          );
          
          // This could either succeed (idempotent) or return an appropriate error
          // The exact behavior depends on implementation - both are valid
          if (secondUnsuspendResponse.status === 200) {
            expect(secondUnsuspendResponse.data.suspended).toBe(false);
            console.log("Test: Second unsuspend handled idempotently.");
          } else {
            expect(secondUnsuspendResponse.status).toBe(400);
            expect(secondUnsuspendResponse.data.message).toContain("not suspended");
            console.log("Test: Second unsuspend returned appropriate error.");
          }

        } catch (error) {
          // If it's a 400 error about user not being suspended, that's acceptable
          if (error.response?.status === 400 && 
              error.response?.data?.message?.includes("not suspended")) {
            console.log("Test: Second unsuspend correctly rejected - user not suspended.");
            return; // Test passes
          }
          
          console.error("Error during test execution:", {
            status: error.response?.status,
            data: error.response?.data,
            config: {
              method: error.config?.method,
              url: error.config?.url,
              data: error.config?.data,
            },
          });
          // Re-throw unexpected errors
          throw error;
        }
      });

      it("should return 404 for non-existent user", async () => {
        try {
          console.log("Test: Attempting to unsuspend non-existent user...");
          await expect(
            api.post(
              `/admin/users/user_nonexistent/unsuspend`,
              {},
              adminHeaders
            )
          ).rejects.toMatchObject({
            response: {
              status: 404,
            },
          });
          console.log("Test: Non-existent user correctly returned 404.");

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
          // Re-throw the error to make the test fail
          throw error;
        }
      });
    });
});
