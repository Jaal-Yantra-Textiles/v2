import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { INTERNAL_PAYMENTS_MODULE } from "../../src/modules/internal_payments"

jest.setTimeout(40000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)
    headers = await getAuthHeaders(api)
  })

  it("persists payment attachments to the link table on /admin/payments/link", async () => {
    const stamp = Date.now()
    const linkRes = await api.post(
      `/admin/payments/link`,
      {
        payment: {
          amount: 2500,
          payment_type: "Bank",
          payment_date: new Date().toISOString(),
          metadata: { memo: "with attachments" },
        },
        attachments: [
          {
            file_id: `file_${stamp}_a`,
            url: `https://cdn.example.com/${stamp}/receipt.pdf`,
            filename: "receipt.pdf",
            mime_type: "application/pdf",
            size: 4096,
          },
          {
            file_id: `file_${stamp}_b`,
            url: `https://cdn.example.com/${stamp}/invoice.png`,
            filename: "invoice.png",
            mime_type: "image/png",
          },
          // duplicate of the first file_id — should be deduped away
          {
            file_id: `file_${stamp}_a`,
            url: `https://cdn.example.com/${stamp}/receipt-dup.pdf`,
          },
        ],
      },
      headers
    )

    expect(linkRes.status).toBe(201)
    const paymentId = linkRes.data?.payment?.id
    expect(paymentId).toBeTruthy()

    // Workflow returns the created attachment rows
    const returned = linkRes.data?.attachments || []
    expect(Array.isArray(returned)).toBe(true)
    expect(returned).toHaveLength(2)

    // And they are persisted + queryable from the module service
    const service: any = getContainer().resolve(INTERNAL_PAYMENTS_MODULE)
    const rows = await service.listPaymentAttachments({ payment_id: paymentId })
    expect(rows).toHaveLength(2)
    const fileIds = rows.map((r: any) => r.file_id).sort()
    expect(fileIds).toEqual([`file_${stamp}_a`, `file_${stamp}_b`].sort())
    const pdf = rows.find((r: any) => r.file_id === `file_${stamp}_a`)
    expect(pdf.filename).toBe("receipt.pdf")
    expect(pdf.url).toBe(`https://cdn.example.com/${stamp}/receipt.pdf`)
    expect(Number(pdf.size)).toBe(4096)
  })

  it("creates a payment with no attachments when none are provided", async () => {
    const linkRes = await api.post(
      `/admin/payments/link`,
      {
        payment: {
          amount: 999,
          payment_type: "Cash",
          payment_date: new Date().toISOString(),
        },
      },
      headers
    )
    expect(linkRes.status).toBe(201)
    const paymentId = linkRes.data?.payment?.id
    expect(paymentId).toBeTruthy()

    const service: any = getContainer().resolve(INTERNAL_PAYMENTS_MODULE)
    const rows = await service.listPaymentAttachments({ payment_id: paymentId })
    expect(rows).toHaveLength(0)
  })
})
