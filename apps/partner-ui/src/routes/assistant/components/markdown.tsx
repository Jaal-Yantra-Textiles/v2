/**
 * Assistant markdown renderer (#338 item 2, UI polish).
 *
 * The model replies in GitHub-flavoured markdown. Rendering it raw (as
 * `whitespace-pre-wrap`) leaks `#`, `|`, `**` and turns tabular data into an
 * unreadable pipe soup. This component parses GFM and maps every element to a
 * Medusa-UI–styled node, so prose, lists, code and — crucially — tables read
 * as native partner-portal UI. Tables become a real `@medusajs/ui` Table.
 */
import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Table, Text } from "@medusajs/ui"

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="text-ui-fg-base text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 whitespace-pre-wrap">{children}</p>
          ),
          strong: ({ children }) => (
            <span className="font-medium text-ui-fg-base">{children}</span>
          ),
          em: ({ children }) => <span className="italic">{children}</span>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover underline underline-offset-2"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="my-2 ml-4 list-disc space-y-1 marker:text-ui-fg-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-4 list-decimal space-y-1 marker:text-ui-fg-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1.5 text-base font-semibold text-ui-fg-base">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1.5 text-sm font-semibold text-ui-fg-base">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2.5 mb-1 text-sm font-medium text-ui-fg-base">
              {children}
            </h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-ui-border-strong pl-3 text-ui-fg-subtle">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-ui-border-base" />,
          code: ({ className, children }) => {
            // Fenced block → className has `language-*`; inline → none.
            const isBlock = /language-/.test(className || "")
            if (isBlock) {
              return (
                <pre className="my-2 overflow-x-auto rounded-lg bg-ui-bg-subtle p-3">
                  <code className="font-mono text-xs text-ui-fg-base">
                    {children}
                  </code>
                </pre>
              )
            }
            return (
              <code className="rounded bg-ui-bg-subtle px-1 py-0.5 font-mono text-[0.85em] text-ui-fg-base">
                {children}
              </code>
            )
          },
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-ui-border-base">
              <Table className="min-w-full">{children}</Table>
            </div>
          ),
          thead: ({ children }) => <Table.Header>{children}</Table.Header>,
          tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
          tr: ({ children }) => <Table.Row>{children}</Table.Row>,
          th: ({ children }) => (
            <Table.HeaderCell className="whitespace-nowrap">
              {children}
            </Table.HeaderCell>
          ),
          td: ({ children }) => (
            <Table.Cell>
              <Text size="small" className="whitespace-nowrap">
                {children}
              </Text>
            </Table.Cell>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
