import { emailBodyText, htmlToText } from "../email-text"

// The shape of a real Shopify/Indian-shop confirmation: nested layout tables,
// a style block, entities, and the line items as table rows.
const SHOP_HTML = `
<html><head><style>.x{color:red}</style><title>Order</title></head><body>
<table><tr><td>
  <h1>Button Bazaar</h1>
  <p>Order&nbsp;#BB-1042 confirmed</p>
  <table>
    <tr><th>Item</th><th>Qty</th><th>Price</th></tr>
    <tr><td>Coconut shell button 15mm (pack of 100)</td><td>2</td><td>&#8377;450.00</td></tr>
    <tr><td>Metal shank button &amp; ring</td><td>1</td><td>Rs. 1,250.00</td></tr>
  </table>
  <p>Shipping: &#8377;60<br>Total: &#8377;2,210.00</p>
</td></tr></table>
<!-- tracking pixel -->
</body></html>`

describe("htmlToText (#2377 S3)", () => {
  it("keeps each table row on its own line with ' | ' between cells", () => {
    const text = htmlToText(SHOP_HTML)
    expect(text).toContain("Coconut shell button 15mm (pack of 100) | 2 | ₹450.00")
    expect(text).toContain("Metal shank button & ring | 1 | Rs. 1,250.00")
    expect(text).toContain("Item | Qty | Price")
  })

  it("drops style, title and comments, and decodes entities", () => {
    const text = htmlToText(SHOP_HTML)
    expect(text).not.toMatch(/color:red|tracking pixel|<title>/)
    expect(text).toContain("Order #BB-1042 confirmed")
    expect(text).toContain("Shipping: ₹60\nTotal: ₹2,210.00")
  })
})

describe("emailBodyText (#2377 S3)", () => {
  it("prefers the HTML when the text part is a stub", () => {
    const { text } = emailBodyText({ text_body: "View in browser", html_body: SHOP_HTML })
    expect(text).toContain("Coconut shell button")
  })

  it("uses a real text part", () => {
    const body = "Order BB-1042\nCoconut shell button x2 ₹450\nTotal ₹2,210"
    expect(emailBodyText({ text_body: body, html_body: "<p>Order BB-1042</p>" }).text).toBe(body)
  })

  it("caps a huge body and says so", () => {
    const r = emailBodyText({ html_body: `<p>${"a".repeat(50)}</p>` }, 10)
    expect(r).toEqual({ text: "aaaaaaaaaa", truncated: true })
  })
})

describe("htmlToText against nested markup (#2377 S3, CodeQL)", () => {
  it("leaves no script or comment opener behind", () => {
    const text = htmlToText("<scr<script>x</script>ipt>alert(1)</script><!<!--a-->--><p>ok</p>")
    expect(text).not.toMatch(/<script|<!--/i)
    expect(text).toContain("ok")
  })

  it("an escaped &lt; in the text still reads as <", () => {
    expect(htmlToText("<p>qty &lt; 10</p>")).toBe("qty < 10")
  })
})
