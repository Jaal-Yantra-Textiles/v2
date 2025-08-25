"use client"

import { Container, Heading, Text, Badge } from "@medusajs/ui"

interface SizeMap {
  [size: string]: { [measure: string]: number }
}

interface Color {
  code: string
  name?: string
}

export default function SpecsSection({
  sizes,
  colors,
  tags,
  inspiration,
  estimatedCost,
}: {
  sizes?: SizeMap | null
  colors?: Color[] | null
  tags?: string[] | null
  inspiration?: string[] | null
  estimatedCost?: number | string | null
}) {
  const sizeEntries = sizes ? Object.entries(sizes) : []
  const colorList = Array.isArray(colors) ? colors : []
  const tagList = Array.isArray(tags) ? tags : []
  const inspList = Array.isArray(inspiration) ? inspiration : []

  return (
    <Container className="p-0 divide-y">
      <div className="px-6 py-4 flex items-center justify-between">
        <Heading level="h3">Specifications</Heading>
      </div>
      <div className="px-6 py-4 space-y-6">
        {/* Estimated cost */}
        <div>
          <Text weight="plus" className="mb-1 block">Estimated Cost</Text>
          <Text>{estimatedCost ? `$${estimatedCost}` : "-"}</Text>
        </div>

        {/* Inspiration sources */}
        <div>
          <Text weight="plus" className="mb-2 block">Inspiration</Text>
          {inspList.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1">
              {inspList.map((u, i) => (
                <li key={i} className="truncate">
                  <a href={u} target="_blank" className="text-ui-fg-interactive hover:underline" title={u}>{u}</a>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No links</Text>
          )}
        </div>

        {/* Tags */}
        <div>
          <Text weight="plus" className="mb-2 block">Tags</Text>
          {tagList.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tagList.map((t, i) => (
                <Badge key={i} size="small" className="capitalize">{t}</Badge>
              ))}
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No tags</Text>
          )}
        </div>

        {/* Color palette */}
        <div>
          <Text weight="plus" className="mb-2 block">Color Palette</Text>
          {colorList.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {colorList.map((c, i) => (
                <div key={`${c.code}-${i}`} className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded border" style={{ backgroundColor: c.code }} title={c.name || c.code} />
                  <Text size="small">{c.name || c.code}</Text>
                </div>
              ))}
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No colors</Text>
          )}
        </div>

        {/* Sizes */}
        <div>
          <Text weight="plus" className="mb-2 block">Sizes</Text>
          {sizeEntries.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sizeEntries.map(([size, measures]) => (
                <div key={size} className="rounded-md border p-3 bg-ui-bg-base">
                  <Text weight="plus" className="mb-1 block">{size}</Text>
                  <ul className="text-sm space-y-0.5">
                    {Object.entries(measures).map(([k, v]) => (
                      <li key={k} className="flex justify-between">
                        <span className="text-ui-fg-muted">{k}</span>
                        <span>{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">No size specs</Text>
          )}
        </div>
      </div>
    </Container>
  )
}
