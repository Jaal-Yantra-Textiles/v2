import { testSendSubscriber } from "../send-test-email"
import { buildEmailData } from "../../utils/build-email-data"

const blog = { title: "Meet Luna", url: "/blog/meet-luna", slug: "meet-luna", tags: [] }

describe("testSendSubscriber", () => {
  it("a preview is addressed to Test User", () => {
    expect(testSendSubscriber("me@x.test")).toEqual({
      id: "test-user",
      email: "me@x.test",
      first_name: "Test",
      last_name: "User",
    })
  })

  it("a send by hand to a real reader greets them by name and unsubscribes THEM", () => {
    const sub = testSendSubscriber("cici@x.test", { id: "per_1", first_name: "Cici", last_name: "Rotell" })
    const data = buildEmailData(sub, blog, "<p>hi</p>", { subject: "s" }, { isTest: false })
    expect(data.first_name).toBe("Cici")
    expect(data.unsubscribe_url).toContain("id=per_1")
    expect(data.unsubscribe_url).toContain(encodeURIComponent("cici@x.test"))
    expect(data.is_test).toBe(false)
  })

  it("a reader with no first name gets an empty name, never 'Test'", () => {
    expect(testSendSubscriber("a@x.test", { id: "per_2", first_name: null }).first_name).toBe("")
  })
})
