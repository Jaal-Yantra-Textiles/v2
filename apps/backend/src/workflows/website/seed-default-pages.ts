import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { WEBSITE_MODULE } from "../../modules/website"
import WebsiteService from "../../modules/website/service"

type SeedDefaultPagesInput = {
  website_id: string
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

// -- TipTap JSON helpers --
const text = (t: string, marks?: Array<{ type: string }>) => ({
  type: "text" as const,
  text: t,
  ...(marks ? { marks } : {}),
})

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

const doc = (...content: any[]) => ({
  type: "doc" as const,
  content,
})

// -- Page definitions --
const DEFAULT_PAGES = [
  {
    title: "Terms & Conditions",
    slug: "terms-and-conditions",
    page_type: "Custom" as const,
    content: "Terms and conditions for using our platform.",
    meta_title: "Terms & Conditions",
    meta_description:
      "Read the terms and conditions governing your use of our e-commerce platform, including ordering, shipping, returns, and intellectual property policies.",
    hero: {
      title: "Terms & Conditions",
      subtitle: "Please read these terms carefully before using our platform.",
      align: "center" as const,
    },
    body: doc(
      heading(2, text("1. Acceptance of Terms")),
      paragraph(
        text(
          "By accessing and using this website, you accept and agree to be bound by these Terms & Conditions. If you do not agree to these terms, please do not use our services."
        )
      ),

      heading(2, text("2. Use of the Platform")),
      paragraph(
        text(
          "You may use our platform solely for lawful purposes. You agree not to use the platform in any way that violates any applicable local, national, or international law or regulation."
        )
      ),
      bulletList(
        listItem(
          paragraph(
            text("You must be at least 18 years old to create an account.")
          )
        ),
        listItem(
          paragraph(
            text(
              "You are responsible for maintaining the confidentiality of your account credentials."
            )
          )
        ),
        listItem(
          paragraph(
            text(
              "You agree to provide accurate and complete information when creating an account."
            )
          )
        )
      ),

      heading(2, text("3. Orders & Payments")),
      paragraph(
        text(
          "All orders placed through our platform are subject to acceptance and availability. Prices are displayed in the currency selected and include applicable taxes unless stated otherwise."
        )
      ),
      bulletList(
        listItem(
          paragraph(
            text(
              "We reserve the right to refuse or cancel any order at our discretion."
            )
          )
        ),
        listItem(
          paragraph(
            text(
              "Payment must be received in full before order processing begins."
            )
          )
        ),
        listItem(
          paragraph(
            text(
              "Custom and made-to-order products may have different cancellation policies."
            )
          )
        )
      ),

      heading(2, text("4. Shipping & Delivery")),
      paragraph(
        text(
          "Shipping times and costs vary depending on the destination and selected shipping method. Estimated delivery dates are provided for guidance and are not guaranteed."
        )
      ),
      paragraph(
        text(
          "Risk of loss and title for items purchased pass to you upon delivery to the carrier. We are not responsible for delays caused by customs, weather, or other circumstances beyond our control."
        )
      ),

      heading(2, text("5. Returns & Refunds")),
      paragraph(
        text(
          "We accept returns within 30 days of delivery for most products in their original condition. Custom-made or personalised items may not be eligible for return unless defective."
        )
      ),
      bulletList(
        listItem(
          paragraph(
            text(
              "Items must be unused, in original packaging, and accompanied by a receipt."
            )
          )
        ),
        listItem(
          paragraph(
            text(
              "Refunds are processed within 7-10 business days after we receive the returned item."
            )
          )
        ),
        listItem(
          paragraph(
            text("Shipping costs for returns are borne by the customer unless the item is defective.")
          )
        )
      ),

      heading(2, text("6. Intellectual Property")),
      paragraph(
        text(
          "All content on this platform, including text, graphics, logos, images, and software, is the property of JYT Commerce or its content suppliers and is protected by international copyright laws. You may not reproduce, distribute, or create derivative works without our express written consent."
        )
      ),

      heading(2, text("7. Limitation of Liability")),
      paragraph(
        text(
          "To the fullest extent permitted by law, JYT Commerce shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or related to your use of the platform."
        )
      ),

      heading(2, text("8. Changes to These Terms")),
      paragraph(
        text(
          "We reserve the right to update these Terms & Conditions at any time. Changes take effect immediately upon posting. Your continued use of the platform after changes are posted constitutes acceptance of the revised terms."
        )
      ),

      heading(2, text("9. Contact")),
      paragraph(
        text("If you have any questions about these Terms & Conditions, please "),
        text("contact us", [{ type: "bold" }]),
        text(" through our contact page or email us directly.")
      )
    ),
  },

  {
    title: "Privacy Policy",
    slug: "privacy-policy",
    page_type: "Custom" as const,
    content: "Our privacy policy explaining how we collect and use your data.",
    meta_title: "Privacy Policy",
    meta_description:
      "Learn how we collect, use, and protect your personal information. Our privacy policy covers data collection, cookies, third-party sharing, and your rights.",
    hero: {
      title: "Privacy Policy",
      subtitle:
        "We are committed to protecting your privacy and handling your data with transparency.",
      align: "center" as const,
    },
    body: doc(
      heading(2, text("1. Information We Collect")),
      paragraph(
        text(
          "We collect information you provide directly to us, as well as information collected automatically when you use our services."
        )
      ),
      heading(3, text("Personal Information")),
      bulletList(
        listItem(
          paragraph(text("Name, email address, phone number, and shipping address"))
        ),
        listItem(
          paragraph(text("Payment information (processed securely through our payment providers)"))
        ),
        listItem(
          paragraph(text("Account preferences and order history"))
        ),
        listItem(
          paragraph(text("Communications you send to us"))
        )
      ),
      heading(3, text("Automatically Collected Information")),
      bulletList(
        listItem(
          paragraph(text("Device information (browser type, operating system, device type)"))
        ),
        listItem(
          paragraph(text("IP address and approximate location"))
        ),
        listItem(
          paragraph(text("Pages visited, time spent, and navigation patterns"))
        ),
        listItem(
          paragraph(text("Cookies and similar tracking technologies"))
        )
      ),

      heading(2, text("2. How We Use Your Information")),
      paragraph(text("We use the information we collect to:")),
      bulletList(
        listItem(
          paragraph(text("Process and fulfil your orders"))
        ),
        listItem(
          paragraph(text("Communicate with you about your orders, account, and our services"))
        ),
        listItem(
          paragraph(text("Personalise your shopping experience and recommend products"))
        ),
        listItem(
          paragraph(text("Improve our platform, products, and services"))
        ),
        listItem(
          paragraph(text("Detect and prevent fraud and abuse"))
        ),
        listItem(
          paragraph(text("Comply with legal obligations"))
        )
      ),

      heading(2, text("3. Information Sharing")),
      paragraph(
        text(
          "We do not sell your personal information. We may share your information with:"
        )
      ),
      bulletList(
        listItem(
          paragraph(
            text("Service providers", [{ type: "bold" }]),
            text(" who assist with order fulfilment, payment processing, and delivery")
          )
        ),
        listItem(
          paragraph(
            text("Partner brands", [{ type: "bold" }]),
            text(" when you purchase their products (limited to order fulfilment data)")
          )
        ),
        listItem(
          paragraph(
            text("Legal authorities", [{ type: "bold" }]),
            text(" when required by law or to protect our rights")
          )
        )
      ),

      heading(2, text("4. Cookies & Tracking")),
      paragraph(
        text(
          "We use cookies and similar technologies to enhance your browsing experience, analyse site traffic, and personalise content. You can control cookie preferences through your browser settings."
        )
      ),
      bulletList(
        listItem(
          paragraph(
            text("Essential cookies", [{ type: "bold" }]),
            text(": Required for the platform to function (cart, authentication)")
          )
        ),
        listItem(
          paragraph(
            text("Analytics cookies", [{ type: "bold" }]),
            text(": Help us understand how visitors interact with our platform")
          )
        ),
        listItem(
          paragraph(
            text("Marketing cookies", [{ type: "bold" }]),
            text(": Used to deliver relevant advertisements")
          )
        )
      ),

      heading(2, text("5. Data Security")),
      paragraph(
        text(
          "We implement industry-standard security measures to protect your personal information, including encryption, secure servers, and regular security audits. However, no method of transmission over the Internet is 100% secure."
        )
      ),

      heading(2, text("6. Your Rights")),
      paragraph(text("Depending on your location, you may have the right to:")),
      bulletList(
        listItem(paragraph(text("Access the personal information we hold about you"))),
        listItem(paragraph(text("Request correction of inaccurate information"))),
        listItem(paragraph(text("Request deletion of your personal information"))),
        listItem(paragraph(text("Opt out of marketing communications"))),
        listItem(paragraph(text("Request a copy of your data in a portable format")))
      ),
      paragraph(
        text("To exercise any of these rights, please contact us through our "),
        text("contact page", [{ type: "bold" }]),
        text(".")
      ),

      heading(2, text("7. Data Retention")),
      paragraph(
        text(
          "We retain your personal information for as long as necessary to provide our services, comply with legal obligations, resolve disputes, and enforce our agreements. When data is no longer needed, we securely delete or anonymise it."
        )
      ),

      heading(2, text("8. Changes to This Policy")),
      paragraph(
        text(
          "We may update this Privacy Policy from time to time. We will notify you of significant changes by posting a notice on our platform or sending you a direct communication. The date at the top of this page indicates when the policy was last revised."
        )
      ),

      heading(2, text("9. Contact Us")),
      paragraph(
        text(
          "If you have questions or concerns about this Privacy Policy or our data practices, please reach out through our contact page."
        )
      )
    ),
  },

  {
    title: "Contact Us",
    slug: "contact-us",
    page_type: "Contact" as const,
    content: "Get in touch with us.",
    meta_title: "Contact Us",
    meta_description:
      "Have a question or need assistance? Get in touch with our team. We are here to help with orders, partnerships, and general enquiries.",
    hero: {
      title: "Contact Us",
      subtitle:
        "Have a question or need assistance? We would love to hear from you.",
      align: "center" as const,
    },
    body: doc(
      heading(2, text("Get in Touch")),
      paragraph(
        text(
          "Whether you have a question about your order, want to explore a partnership, or just want to say hello, our team is here to help. Fill out the form below and we will get back to you within 24 hours."
        )
      ),

      heading(3, text("Other Ways to Reach Us")),
      bulletList(
        listItem(
          paragraph(
            text("Email", [{ type: "bold" }]),
            text(": support@jytcommerce.com")
          )
        ),
        listItem(
          paragraph(
            text("Business hours", [{ type: "bold" }]),
            text(": Monday to Friday, 9:00 AM - 6:00 PM (IST)")
          )
        )
      ),

      heading(3, text("For Partners")),
      paragraph(
        text(
          "Interested in selling on our platform? Visit our partner portal or reach out to our partnerships team for more information about becoming a JYT Commerce partner."
        )
      )
    ),
  },
]

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

    for (const pageDef of DEFAULT_PAGES) {
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
