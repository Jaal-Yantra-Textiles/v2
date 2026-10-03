import { decideAdminPhoneAction } from "../backfill-partner-admin-phone-login-job"

describe("decideAdminPhoneAction", () => {
  const base = {
    phone: "+919876543210",
    sharedWithOtherAdmin: false,
    authIdentityId: "authid_1",
    ownerAuthIdentityId: null,
  }

  it("links a readable, unshared number on an admin with a login", () => {
    expect(decideAdminPhoneAction(base)).toBe("link")
  })

  it("skips an unreadable number", () => {
    expect(decideAdminPhoneAction({ ...base, phone: null })).toBe("unreadable")
  })

  it("skips a number two admins share, even if one already owns it", () => {
    expect(
      decideAdminPhoneAction({ ...base, sharedWithOtherAdmin: true, ownerAuthIdentityId: "authid_1" })
    ).toBe("shared_number")
  })

  it("skips an admin with no login", () => {
    expect(decideAdminPhoneAction({ ...base, authIdentityId: null })).toBe("no_login")
  })

  it("recognises a number already on this login", () => {
    expect(decideAdminPhoneAction({ ...base, ownerAuthIdentityId: "authid_1" })).toBe("already_linked")
  })

  it("refuses a number another login owns", () => {
    expect(decideAdminPhoneAction({ ...base, ownerAuthIdentityId: "authid_2" })).toBe("taken")
  })
})
