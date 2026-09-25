import dns from "node:dns"
import http from "node:http"
import type { AddressInfo } from "node:net"

import {
  isBlockedAddress,
  parseScanUrl,
  safeFetch,
  UnsafeUrlError,
} from "../safe-fetch"

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // ECS/EC2 metadata
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // what `new URL` rewrites [::ffff:127.0.0.1] into
    "::ffff:a9fe:a9fe", // 169.254.169.254, hex-mapped
    "not-an-ip",
  ])("blocks %s", (addr) => {
    expect(isBlockedAddress(addr)).toBe(true)
  })

  it.each(["8.8.8.8", "172.32.0.1", "23.227.38.65", "2606:4700::1111"])(
    "allows public %s",
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false)
    }
  )
})

describe("parseScanUrl", () => {
  const OLD = process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS
  beforeEach(() => {
    delete process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS
  })
  afterAll(() => {
    process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = OLD
  })

  it("adds https:// to a bare domain, which is how operators type it", () => {
    expect(parseScanUrl("gof.asia").toString()).toBe("https://gof.asia/")
  })

  it.each([
    ["file:///etc/passwd", /Only http/],
    ["ftp://x.com", /Only http/],
    ["http://169.254.169.254/latest/meta-data", /private or reserved/],
    ["http://[::ffff:127.0.0.1]/", /private or reserved/],
    ["http://2130706433/", /private or reserved/], // decimal 127.0.0.1
    ["http://localhost:9000/", /Port|not a public host/],
    ["http://localhost/", /not a public host/],
    ["http://metadata.google.internal/", /not a public host/],
    ["https://user:pw@shop.com/", /credentials/],
    ["https://shop.com:8443/", /Port 8443/],
    ["", /required/],
  ])("refuses %s", (url, message) => {
    expect(() => parseScanUrl(url)).toThrow(UnsafeUrlError)
    expect(() => parseScanUrl(url)).toThrow(message)
  })
})

describe("safeFetch against a local server", () => {
  let server: http.Server
  let base: string
  const OLD = process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "text/plain" })
        return res.end("hello")
      }
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" })
        return res.end()
      }
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" })
        return res.end("x".repeat(5000))
      }
      if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" })
        return res.end()
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = OLD
    await new Promise((r) => server.close(r))
  })

  it("refuses a loopback server when the test escape hatch is off", async () => {
    delete process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS
    await expect(safeFetch(`${base}/ok`, { maxBytes: 1000 })).rejects.toThrow(UnsafeUrlError)
  })

  it("refuses a public-LOOKING hostname that resolves private — the check is on the dialled address", async () => {
    delete process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS
    // A rebinding host: the name passes every string check, the answer is the
    // metadata endpoint. Only the lookup can see it.
    const spy = jest
      .spyOn(dns, "lookup")
      .mockImplementation(((_h: string, _o: any, cb: any) =>
        cb(null, [{ address: "169.254.169.254", family: 4 }])) as any)
    try {
      await expect(
        safeFetch("http://partner-shop.example/", { maxBytes: 1000 })
      ).rejects.toThrow(/resolves to a private or reserved address/)
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it("refuses when ANY answer is private, even beside a public one", async () => {
    delete process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS
    const spy = jest
      .spyOn(dns, "lookup")
      .mockImplementation(((_h: string, _o: any, cb: any) =>
        cb(null, [
          { address: "23.227.38.65", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ])) as any)
    try {
      await expect(
        safeFetch("http://partner-shop.example/", { maxBytes: 1000 })
      ).rejects.toThrow(UnsafeUrlError)
    } finally {
      spy.mockRestore()
    }
  })

  describe("with the test escape hatch on", () => {
    beforeEach(() => {
      process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS = "true"
    })

    it("fetches", async () => {
      const res = await safeFetch(`${base}/ok`, { maxBytes: 1000 })
      expect(res.status).toBe(200)
      expect(res.body.toString()).toBe("hello")
    })

    it("re-vets every redirect hop: a reachable page cannot bounce us into metadata", async () => {
      // The first hop (loopback) is allowed by the hatch — proven by "fetches"
      // above — so this refusal can only come from vetting the SECOND hop.
      await expect(
        safeFetch(`${base}/to-metadata`, { maxBytes: 1000 })
      ).rejects.toThrow(UnsafeUrlError)
    })

    it("aborts past the byte cap", async () => {
      await expect(safeFetch(`${base}/big`, { maxBytes: 100 })).rejects.toThrow(/exceeded|too large/)
    })

    it("stops a redirect loop", async () => {
      await expect(safeFetch(`${base}/loop`, { maxBytes: 100 })).rejects.toThrow(/Too many redirects/)
    })
  })
})
