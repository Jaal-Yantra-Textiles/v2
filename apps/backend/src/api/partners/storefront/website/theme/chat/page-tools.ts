/**
 * Website-page tools for the theme editor's chat panel.
 *
 * The panel could already restyle a storefront but not add anything to it: a
 * partner who wanted an About page, a size guide or a care-instructions page
 * had to leave the assistant, open the pages editor, create the page, then
 * write every block by hand. The page and block APIs already existed — nothing
 * had connected them to the assistant that partners actually talk to.
 *
 * ── What these tools may and may not do ──────────────────────────────────────
 *
 * Pages are created as DRAFTS, always. A draft is invisible to visitors, so an
 * assistant that misunderstands "add a page about our weavers" costs the
 * partner a click to delete, never a wrong page on a live storefront. Nothing
 * here publishes, unpublishes or deletes — publishing is the moment content
 * becomes public and that stays a human decision, made in the pages editor
 * where the partner can read the whole page first.
 *
 * Editing a page that is ALREADY published is different: those edits are
 * immediately public. `add_page_blocks` therefore refuses a published page
 * unless the caller passes `confirm_live_edit`, which the model is instructed
 * to obtain from the user in words first.
 *
 * ── Block vocabulary ─────────────────────────────────────────────────────────
 *
 * The storefront renders two block types (see the `[slug]` page renderer):
 *   - `Hero` — { title, subtitle?, align? }
 *   - `Main` — { title?, body } where body is plain text (TipTap JSON also
 *     renders, but prose is what a language model should be producing)
 * Anything else falls through to a debug dump of the block's JSON, which is
 * why the schema below is a closed enum rather than a free string: an invented
 * block type renders as a wall of JSON on the partner's page.
 */
import { tool } from "ai"
import { z } from "@medusajs/framework/zod"

import { createPageWorkflow } from "../../../../../../workflows/website/website-page/create-page"
import { listPageWorkflow } from "../../../../../../workflows/website/website-page/list-page"
import { createBatchBlocksWorkflow } from "../../../../../../workflows/website/page-blocks/create-batch-blocks"
import { listBlocksWorkflow } from "../../../../../../workflows/website/page-blocks/list-blocks"
import { PAGE_TYPES } from "../../../../../admin/websites/[id]/pages/validators"

/** Prose the model needs in its system prompt to use these tools well. */
export const PAGE_TOOL_DESCRIPTION = `## Website Pages

You can also create and fill website pages (About, Size Guide, Care, Shipping, FAQ, …).

- \`list_pages\` — see what pages already exist before creating anything. Never create a page whose slug already exists; offer to add blocks to it instead.
- \`create_page\` — creates a page as a DRAFT with its blocks in one call. Write the actual copy; do not leave placeholders like "Lorem ipsum" or "[insert text]". Base the wording on what the partner sells and the words they use.
- \`add_page_blocks\` — append blocks to an existing page.

Block types:
- \`Hero\` — a heading band. content: { title, subtitle?, align? }
- \`Main\` — a prose section. content: { title?, body } where body is plain text; blank lines separate paragraphs.

Rules:
- Every page you create is a DRAFT. Tell the partner it is a draft and that they publish it from the Pages editor when they are happy with it. Never claim a page is live.
- If \`add_page_blocks\` reports the page is published, STOP and ask the partner whether to edit a live page before retrying with confirm_live_edit.
- Slugs are lowercase words joined by hyphens, no leading slash.`

type Ctx = {
  scope: any
  websiteId: string
}

const blockSchema = z.object({
  type: z
    .enum(["Hero", "Main"])
    .describe("Hero for a heading band, Main for a prose section"),
  name: z
    .string()
    .optional()
    .describe("Short internal label shown in the block list, e.g. 'Intro'"),
  content: z
    .object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
      align: z.enum(["left", "center"]).optional(),
      body: z
        .string()
        .optional()
        .describe("Plain-text prose for a Main block. Blank lines split paragraphs."),
    })
    .describe("Block content. Hero uses title/subtitle/align; Main uses title/body."),
})

// One list, owned by the validator that enforces it — this file used to keep
// its own copy, which is how the MCP row ended up advertising a third.

/** Slug hygiene — the model writes prose, not URL segments. */
const normalizeSlug = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

export const buildPageTools = ({ scope, websiteId }: Ctx) => ({
  list_pages: tool({
    description:
      "List the website's existing pages (title, slug, status). Call this BEFORE creating a page so you never duplicate a slug that already exists.",
    inputSchema: z.object({
      limit: z.number().min(1).max(50).default(25),
    }),
    execute: async (input) => {
      const { result } = await listPageWorkflow(scope).run({
        input: {
          website_id: websiteId,
          filters: {},
          config: { skip: 0, take: input.limit },
        },
      })
      const [pages, count] = result as [any[], number]
      return {
        count,
        pages: (pages || []).map((p: any) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
          status: p.status,
          page_type: p.page_type,
        })),
      }
    },
  }),

  create_page: tool({
    description:
      "Create a new website page as a DRAFT, with its content blocks. The page is NOT visible to visitors until the partner publishes it from the Pages editor. Write real copy, never placeholders.",
    inputSchema: z.object({
      title: z.string().min(1).describe("Page title, e.g. 'Care Instructions'"),
      slug: z
        .string()
        .min(1)
        .describe("URL segment, lowercase-with-hyphens, no leading slash"),
      page_type: z.enum(PAGE_TYPES).default("Custom"),
      meta_description: z
        .string()
        .optional()
        .describe("One-sentence search snippet for this page"),
      blocks: z
        .array(blockSchema)
        .min(1)
        .max(12)
        .describe("The page's content, in the order it should appear"),
    }),
    execute: async (input) => {
      const slug = normalizeSlug(input.slug)
      if (!slug) {
        return { created: false, error: "The slug was empty after cleaning up." }
      }

      // Refuse duplicates rather than creating a second page on the same URL.
      const { result: existingResult } = await listPageWorkflow(scope).run({
        input: {
          website_id: websiteId,
          filters: {},
          config: { skip: 0, take: 100 },
        },
      })
      const [existingPages] = existingResult as [any[], number]
      const clash = (existingPages || []).find((p: any) => p.slug === slug)
      if (clash) {
        return {
          created: false,
          error: `A page with slug "${slug}" already exists ("${clash.title}", ${clash.status}). Use add_page_blocks with page_id "${clash.id}" to extend it, or choose a different slug.`,
          existing_page_id: clash.id,
        }
      }

      const { result: page } = await createPageWorkflow(scope).run({
        input: {
          website_id: websiteId,
          title: input.title,
          slug,
          // The page model carries a `content` string alongside its blocks;
          // blocks are what the storefront renders, so this stays empty.
          content: "",
          page_type: input.page_type,
          // Draft, always — see the module header.
          status: "Draft",
          meta_description: input.meta_description,
          genMetaDataLLM: false,
        },
      })

      const pageId = (page as any)?.id
      const blockResult = await createBatchBlocksWorkflow(scope).run({
        input: {
          blocks: input.blocks.map((b, i) => ({
            page_id: pageId,
            name: b.name || b.type,
            type: b.type,
            content: b.content,
            order: i,
            status: "Active",
          })),
        },
      })

      const created = (blockResult.result as any)?.created || []
      const errors = (blockResult.result as any)?.errors || []

      return {
        created: true,
        page_id: pageId,
        slug,
        status: "Draft",
        blocks_created: created.length,
        blocks_failed: errors.length,
        // Said explicitly so the model does not tell the partner it is live.
        note: `Page created as a DRAFT at /${slug}. It is not visible to visitors until published from the Pages editor.`,
        ...(errors.length ? { block_errors: errors } : {}),
      }
    },
  }),

  add_page_blocks: tool({
    description:
      "Append content blocks to an existing page. If the page is already published these edits are immediately public — ask the partner first, then pass confirm_live_edit.",
    inputSchema: z.object({
      page_id: z.string().min(1).describe("Page id from list_pages"),
      blocks: z.array(blockSchema).min(1).max(12),
      confirm_live_edit: z
        .boolean()
        .default(false)
        .describe(
          "Set true ONLY after the partner has agreed in conversation to edit a page that is already published."
        ),
    }),
    execute: async (input) => {
      const { result: pagesResult } = await listPageWorkflow(scope).run({
        input: {
          website_id: websiteId,
          filters: {},
          config: { skip: 0, take: 100 },
        },
      })
      const [pages] = pagesResult as [any[], number]
      const page = (pages || []).find((p: any) => p.id === input.page_id)

      // Ownership: the list is scoped to this partner's website, so a page id
      // that is not in it belongs to someone else's site or does not exist.
      // Both answer the same way — never confirm another tenant's page id.
      if (!page) {
        return {
          added: false,
          error: `No page with id "${input.page_id}" on this website. Call list_pages for the ids.`,
        }
      }

      if (page.status === "Published" && !input.confirm_live_edit) {
        return {
          added: false,
          requires_confirmation: true,
          error: `"${page.title}" is published — appending blocks changes the live site immediately. Ask the partner whether to proceed, then call again with confirm_live_edit: true.`,
        }
      }

      const { result: existingBlocks } = await listBlocksWorkflow(scope).run({
        input: { page_id: input.page_id },
      })
      const startOrder = ((existingBlocks as any)?.blocks || []).length

      const blockResult = await createBatchBlocksWorkflow(scope).run({
        input: {
          blocks: input.blocks.map((b, i) => ({
            page_id: input.page_id,
            name: b.name || b.type,
            type: b.type,
            content: b.content,
            order: startOrder + i,
            status: "Active",
          })),
        },
      })

      const created = (blockResult.result as any)?.created || []
      const errors = (blockResult.result as any)?.errors || []

      return {
        added: created.length > 0,
        page_id: input.page_id,
        page_status: page.status,
        blocks_added: created.length,
        blocks_failed: errors.length,
        note:
          page.status === "Published"
            ? "These blocks are live on the storefront now."
            : "The page is still a draft — publish it from the Pages editor when ready.",
        ...(errors.length ? { block_errors: errors } : {}),
      }
    },
  }),
})
