import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { WEBSITE_MODULE } from "../../modules/website"
import WebsiteService from "../../modules/website/service"

/**
 * What we know about the store a website belongs to. Every field is
 * optional: a page never prints a placeholder or the platform's own
 * address — an unknown detail is simply left out.
 */
export type DefaultPageStore = {
  name?: string | null
  email?: string | null
  phone?: string | null
}

type SeedDefaultPagesInput = {
  website_id: string
  store?: DefaultPageStore | null
}

type SeedResult = {
  pages: Array<{
    id: string
    title: string
    slug: string
    blocks_created: number
  }>
  skipped: string[]
}

export type DefaultPageDefinition = {
  title: string
  slug: string
  page_type: "Custom" | "Contact"
  content: string
  meta_title: string
  meta_description: string
  hero: { title: string; subtitle: string; align: "center" }
  body: ReturnType<typeof doc>
}

// -- TipTap JSON helpers --
const text = (t: string, marks?: Array<{ type: string }>) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
})

const bold = (t: string) => text(t, [{ type: "bold" }])

const heading = (level: number, ...children: any[]) => ({
  type: "heading" as const,
  attrs: { level },
  content: children,
})

const paragraph = (...children: any[]) => ({
  type: "paragraph" as const,
  content: children,
})

const bulletList = (...items: any[]) => ({
  type: "bulletList" as const,
  content: items,
})

const listItem = (...paragraphs: any[]) => ({
  type: "listItem" as const,
  content: paragraphs,
})

const bullet = (...children: any[]) => listItem(paragraph(...children))

const doc = (...content: any[]) => ({
  type: "doc" as const,
  content,
})

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length ? t : null
}

/**
 * Build the default pages for one store. The text speaks as the store
 * itself (never as the platform that hosts it), uses the store's name when
 * we know it, and lists contact details only when they are known.
 *
 * There is deliberately no "About" page: the storefront renders /about
 * from the store's own home-page story when no About page is published, and
 * a generic seeded one would override it.
 */
export function buildDefaultPages(
  store: DefaultPageStore = {}
): DefaultPageDefinition[] {
  const name = clean(store?.name)
  const email = clean(store?.email)
  const phone = clean(store?.phone)

  // "Acme Textiles" / "this store" — used mid-sentence.
  const storeRef = name ?? "this store"
  // "Acme Textiles" / "We" — used as a sentence subject.
  const storeSubject = name ?? "We"
  const atStore = name ? ` at ${name}` : ""

  const contactPointer = paragraph(
    text("If you have any questions, please "),
    bold("contact us"),
    text(
      email
        ? ` through our contact page or by email at ${email}.`
        : " through our contact page."
    )
  )

  const terms: DefaultPageDefinition = {
    title: "Terms & Conditions",
    slug: "terms-and-conditions",
    page_type: "Custom",
    content: `Terms and conditions for shopping with ${storeRef}.`,
    meta_title: "Terms & Conditions",
    meta_description: `The terms and conditions that apply when you browse and shop with ${storeRef}, including orders, payments, delivery, returns and intellectual property.`,
    hero: {
      title: "Terms & Conditions",
      subtitle: "Please read these terms carefully before placing an order.",
      align: "center",
    },
    body: doc(
      heading(2, text("1. Acceptance of Terms")),
      paragraph(
        text(
          `By accessing this website and placing an order with ${storeRef}, you accept and agree to be bound by these Terms & Conditions. If you do not agree to these terms, please do not use this website.`
        )
      ),

      heading(2, text("2. Use of This Website")),
      paragraph(
        text(
          "You may use this website only for lawful purposes. You agree not to use it in any way that violates any applicable local, national, or international law or regulation."
        )
      ),
      bulletList(
        bullet(text("You must be at least 18 years old to create an account.")),
        bullet(
          text(
            "You are responsible for maintaining the confidentiality of your account credentials."
          )
        ),
        bullet(
          text(
            "You agree to provide accurate and complete information when creating an account or placing an order."
          )
        )
      ),

      heading(2, text("3. Orders & Payments")),
      paragraph(
        text(
          "All orders are subject to acceptance and availability. Prices are shown in the currency displayed at checkout, and any applicable taxes and shipping charges are shown before you pay."
        )
      ),
      bulletList(
        bullet(
          text("We reserve the right to refuse or cancel any order at our discretion.")
        ),
        bullet(
          text("Payment must be received in full before order processing begins.")
        ),
        bullet(
          text(
            "Custom and made-to-order products may have different cancellation terms, which are shared with you before you order."
          )
        )
      ),

      heading(2, text("4. Shipping & Delivery")),
      paragraph(
        text(
          "Shipping times and costs depend on the destination and the shipping method chosen at checkout. Any delivery estimate is for guidance only and is not guaranteed. We are not responsible for delays caused by customs, weather, or other circumstances beyond our control."
        )
      ),

      heading(2, text("5. Returns & Refunds")),
      paragraph(
        text(
          "Whether an item can be returned, and how a refund is handled, depends on the product. Custom-made or personalised items may not be eligible for return unless they are defective. Please see our "
        ),
        bold("Shipping & Returns"),
        text(
          " page and your order confirmation, or contact us before sending anything back."
        )
      ),

      heading(2, text("6. Intellectual Property")),
      paragraph(
        text(
          `The content on this website, including text, graphics, logos and images, belongs to ${storeRef} or its content suppliers and is protected by copyright law. You may not reproduce, distribute, or create derivative works from it without prior written consent.`
        )
      ),

      heading(2, text("7. Limitation of Liability")),
      paragraph(
        text(
          `To the fullest extent permitted by law, ${storeRef} shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of this website.`
        )
      ),

      heading(2, text("8. Changes to These Terms")),
      paragraph(
        text(
          "We may update these Terms & Conditions from time to time. Changes take effect when they are posted on this page. Continuing to use this website after changes are posted means you accept the revised terms."
        )
      ),

      heading(2, text("9. Contact")),
      contactPointer
    ),
  }

  const privacy: DefaultPageDefinition = {
    title: "Privacy Policy",
    slug: "privacy-policy",
    page_type: "Custom",
    content: `How ${storeRef} collects and uses your personal information.`,
    meta_title: "Privacy Policy",
    meta_description: `How ${storeRef} collects, uses and protects your personal information, including cookies, sharing with service providers, and your rights.`,
    hero: {
      title: "Privacy Policy",
      subtitle: "How we collect, use and protect your personal information.",
      align: "center",
    },
    body: doc(
      heading(2, text("1. Information We Collect")),
      paragraph(
        text(
          "We collect information you provide to us directly, as well as some information collected automatically when you use this website."
        )
      ),
      heading(3, text("Information you provide")),
      bulletList(
        bullet(text("Name, email address, phone number, and shipping address")),
        bullet(
          text(
            "Payment information (processed securely by our payment providers; we do not store full card details)"
          )
        ),
        bullet(text("Account preferences and order history")),
        bullet(text("Messages you send to us"))
      ),
      heading(3, text("Information collected automatically")),
      bulletList(
        bullet(text("Device information (browser type, operating system, device type)")),
        bullet(text("IP address and approximate location")),
        bullet(text("Pages visited and how you navigate the website")),
        bullet(text("Cookies and similar technologies"))
      ),

      heading(2, text("2. How We Use Your Information")),
      paragraph(text("We use the information we collect to:")),
      bulletList(
        bullet(text("Process and deliver your orders")),
        bullet(text("Contact you about your orders and your account")),
        bullet(text("Improve this website and our products")),
        bullet(text("Detect and prevent fraud and abuse")),
        bullet(text("Comply with legal obligations"))
      ),

      heading(2, text("3. Information Sharing")),
      paragraph(
        text(
          "We do not sell your personal information. We share it only as needed to run this store, with:"
        )
      ),
      bulletList(
        bullet(
          bold("Service providers"),
          text(
            " who host this website and help us process payments, fulfil orders and deliver them, acting on our behalf"
          )
        ),
        bullet(
          bold("Legal authorities"),
          text(" when required by law or to protect our rights")
        )
      ),

      heading(2, text("4. Cookies")),
      paragraph(
        text(
          "We use cookies and similar technologies to keep the website working, understand how it is used, and improve it. You can control cookies through your browser settings."
        )
      ),
      bulletList(
        bullet(
          bold("Essential cookies"),
          text(": required for the website to work (for example, your cart and sign-in)")
        ),
        bullet(
          bold("Analytics cookies"),
          text(": help us understand how visitors use the website")
        )
      ),

      heading(2, text("5. Data Security")),
      paragraph(
        text(
          "We take reasonable measures to protect your personal information. However, no method of transmission over the Internet or electronic storage is completely secure."
        )
      ),

      heading(2, text("6. Your Rights")),
      paragraph(text("Depending on where you live, you may have the right to:")),
      bulletList(
        bullet(text("Access the personal information we hold about you")),
        bullet(text("Ask us to correct inaccurate information")),
        bullet(text("Ask us to delete your personal information")),
        bullet(text("Opt out of marketing messages"))
      ),
      paragraph(
        text("To exercise any of these rights, please contact us through our "),
        bold("contact page"),
        text(".")
      ),

      heading(2, text("7. Data Retention")),
      paragraph(
        text(
          "We keep your personal information only for as long as needed to fulfil your orders, meet legal obligations, and resolve disputes."
        )
      ),

      heading(2, text("8. Changes to This Policy")),
      paragraph(
        text(
          "We may update this Privacy Policy from time to time. Any changes will be posted on this page."
        )
      ),

      heading(2, text("9. Contact Us")),
      contactPointer
    ),
  }

  const reachUs: any[] = []
  if (email) reachUs.push(bullet(bold("Email"), text(`: ${email}`)))
  if (phone) reachUs.push(bullet(bold("Phone"), text(`: ${phone}`)))

  const contact: DefaultPageDefinition = {
    title: "Contact Us",
    slug: "contact-us",
    page_type: "Contact",
    content: name ? `Get in touch with ${name}.` : "Get in touch with us.",
    meta_title: "Contact Us",
    meta_description: name
      ? `Have a question about an order or a product? Get in touch with ${name}.`
      : "Have a question about an order or a product? Get in touch with us.",
    hero: {
      title: "Contact Us",
      subtitle: "Have a question or need help? We would love to hear from you.",
      align: "center",
    },
    body: doc(
      heading(2, text("Get in Touch")),
      paragraph(
        text(
          `Whether you have a question about an order, a product, or anything else${atStore}, use the form below and we will get back to you as soon as we can.`
        )
      ),
      ...(reachUs.length
        ? [heading(3, text("Other Ways to Reach Us")), bulletList(...reachUs)]
        : []),
      paragraph(
        text(
          "If your message is about an existing order, please include your order number so we can help you faster."
        )
      )
    ),
  }

  const shipping: DefaultPageDefinition = {
    title: "Shipping & Returns",
    slug: "shipping-and-returns",
    page_type: "Custom",
    content: `How shipping, returns and refunds work at ${storeRef}.`,
    meta_title: "Shipping & Returns",
    meta_description: `How shipping, delivery, returns and refunds work when you order from ${storeRef}.`,
    hero: {
      title: "Shipping & Returns",
      subtitle: "How your order gets to you, and what to do if something isn't right.",
      align: "center",
    },
    body: doc(
      heading(2, text("Shipping")),
      paragraph(
        text(
          "Available shipping methods and their costs are shown at checkout, based on your delivery address. Once your order has been dispatched, we will share tracking details where the carrier provides them."
        )
      ),
      paragraph(
        text(
          "Delivery times depend on the product, your location and the carrier. Made-to-order and custom items take longer to prepare than ready stock. Any estimate shown at checkout or in your order confirmation is for guidance and is not guaranteed."
        )
      ),

      heading(2, text("Returns")),
      paragraph(
        text(
          "Whether an item can be returned depends on the product. Custom-made, personalised and made-to-order items may not be returnable unless they arrive damaged or defective."
        )
      ),
      paragraph(
        text(
          "To start a return, please contact us before sending anything back, with your order number and the reason for the return. We will confirm whether the item is eligible and how to send it."
        )
      ),

      heading(2, text("Refunds")),
      paragraph(
        text(
          "Once a returned item has been received and checked, we will let you know whether your refund has been approved. Approved refunds are made to your original payment method; how long it takes to reach you depends on your bank or payment provider."
        )
      ),

      heading(2, text("Damaged or Incorrect Items")),
      paragraph(
        text(
          "If your order arrives damaged, or you received the wrong item, please contact us as soon as possible with your order number and photos of the item and packaging so we can put it right."
        )
      ),

      heading(2, text("Questions")),
      contactPointer
    ),
  }

  const faq: DefaultPageDefinition = {
    title: "FAQ",
    slug: "faq",
    page_type: "Custom",
    content: `Frequently asked questions about shopping with ${storeRef}.`,
    meta_title: "Frequently Asked Questions",
    meta_description: `Answers to common questions about ordering, payment, delivery and returns at ${storeRef}.`,
    hero: {
      title: "Frequently Asked Questions",
      subtitle: "Quick answers to the questions we hear most often.",
      align: "center",
    },
    body: doc(
      heading(3, text("How do I place an order?")),
      paragraph(
        text(
          "Choose a product, select any options such as size or colour, add it to your cart and follow the steps at checkout."
        )
      ),

      heading(3, text("Which payment methods do you accept?")),
      paragraph(
        text("The payment methods available for your order are shown at checkout.")
      ),

      heading(3, text("How long will delivery take?")),
      paragraph(
        text(
          "It depends on the product, your location and the shipping method. Any estimate is shown at checkout and in your order confirmation. Made-to-order items take longer to prepare than ready stock."
        )
      ),

      heading(3, text("How can I track my order?")),
      paragraph(
        text(
          "Once your order has been dispatched, we will share tracking details where the carrier provides them. If you haven't received them, please contact us with your order number."
        )
      ),

      heading(3, text("Can I change or cancel my order?")),
      paragraph(
        text(
          "Please contact us as soon as possible. We will do our best to help if the order has not yet been prepared or dispatched. Custom and made-to-order items may not be changeable once production has started."
        )
      ),

      heading(3, text("Can I return an item?")),
      paragraph(
        text("Please see our "),
        bold("Shipping & Returns"),
        text(" page, or contact us with your order number before sending anything back.")
      ),

      heading(3, text("I have another question.")),
      paragraph(
        text(`${storeSubject} would be happy to help — please `),
        bold("contact us"),
        text(" through our contact page.")
      )
    ),
  }

  return [terms, privacy, contact, shipping, faq]
}

/**
 * Pull the store details for the default pages out of a partner record
 * (loaded with `admins`). Pure and defensive: anything missing is null.
 *
 * - name:  partner.name, else metadata.business_name
 * - email: the owner admin's email, else the first active admin's
 * - phone: metadata.contact_phone, else that admin's phone
 */
export function storeFromPartner(partner: any): DefaultPageStore {
  if (!partner || typeof partner !== "object") return {}
  const metadata =
    partner.metadata && typeof partner.metadata === "object" ? partner.metadata : {}

  const admins: any[] = Array.isArray(partner.admins)
    ? partner.admins.filter((a: any) => a && a.is_active !== false)
    : []
  const admin = admins.find((a) => a.role === "owner") ?? admins[0] ?? null

  return {
    name: clean(partner.name) ?? clean(metadata.business_name),
    email: clean(admin?.email),
    phone: clean(metadata.contact_phone) ?? clean(admin?.phone),
  }
}

export const seedDefaultPagesStep = createStep(
  "seed-default-pages-step",
  async (input: SeedDefaultPagesInput, { container }) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

    // Verify website exists
    await websiteService.retrieveWebsite(input.website_id)

    // Check which pages already exist
    const [existingPages] = await websiteService.listAndCountPages(
      { website_id: input.website_id },
      { take: 100 }
    )
    const existingSlugs = new Set(existingPages.map((p: any) => p.slug))

    const result: SeedResult = { pages: [], skipped: [] }
    const createdIds: string[] = []

    for (const pageDef of buildDefaultPages(input.store ?? {})) {
      if (existingSlugs.has(pageDef.slug)) {
        result.skipped.push(pageDef.slug)
        continue
      }

      // Create the page
      const page = await websiteService.createPages({
        website_id: input.website_id,
        title: pageDef.title,
        slug: pageDef.slug,
        content: pageDef.content,
        page_type: pageDef.page_type,
        status: "Published",
        meta_title: pageDef.meta_title,
        meta_description: pageDef.meta_description,
        last_modified: new Date(),
        published_at: new Date(),
      })

      createdIds.push(page.id)

      // Create Hero block
      await websiteService.createBlocks({
        page_id: page.id,
        name: "Hero",
        type: "Hero",
        content: pageDef.hero,
        order: 0,
        status: "Active",
      })

      // Create MainContent block
      await websiteService.createBlocks({
        page_id: page.id,
        name: "Main Content",
        type: "MainContent",
        content: { body: pageDef.body },
        order: 1,
        status: "Active",
      })

      result.pages.push({
        id: page.id,
        title: pageDef.title,
        slug: pageDef.slug,
        blocks_created: 2,
      })
    }

    return new StepResponse(result, createdIds)
  },
  async (createdIds: string[] | undefined, { container }) => {
    if (createdIds === undefined) {
      return
    }
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    for (const id of createdIds) {
      await websiteService.softDeletePages(id)
    }
  }
)

export type SeedDefaultPagesWorkflowInput = SeedDefaultPagesInput

export const seedDefaultPagesWorkflow = createWorkflow(
  "seed-default-pages",
  (input: SeedDefaultPagesWorkflowInput) => {
    const result = seedDefaultPagesStep(input)
    return new WorkflowResponse(result)
  }
)
