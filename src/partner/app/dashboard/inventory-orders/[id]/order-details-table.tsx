"use client"

import { useState, Fragment } from "react"
import { Table, Text } from "@medusajs/ui"

type InventoryItem = {
  id: string
  title?: string | null
  description?: string | null
  raw_materials?: {
    id?: string
    name?: string
    material_type?: { id?: string } | null
  } | null
}

export type OrderLine = {
  id: string
  inventory_item_id: string
  quantity: number
  price?: number | null
  metadata?: Record<string, any> | null
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
  inventory_items?: InventoryItem[]
}

export default function OrderDetailsTable({ lines }: { lines: OrderLine[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const fmtUTC = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 6) : "-")

  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-md border border-ui-border-base">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell className="w-10 shrink-0" />
              <Table.HeaderCell>Line ID</Table.HeaderCell>
              <Table.HeaderCell>Inventory Item</Table.HeaderCell>
              <Table.HeaderCell>Quantity</Table.HeaderCell>
              <Table.HeaderCell>Price</Table.HeaderCell>
              <Table.HeaderCell>Created</Table.HeaderCell>
              <Table.HeaderCell>Updated</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {lines.map((line) => {
              const isOpen = !!expanded[line.id]
              return (
                <Fragment key={line.id}>
                  <Table.Row>
                    <Table.Cell className="w-10 shrink-0">
                      <button
                        type="button"
                        aria-label={isOpen ? "Collapse" : "Expand"}
                        className="text-ui-fg-subtle hover:text-ui-fg-base w-6 h-6 inline-flex items-center justify-center"
                        onClick={() => toggle(line.id)}
                      >
                        {isOpen ? "−" : "+"}
                      </button>
                    </Table.Cell>
                    <Table.Cell>{line.id}</Table.Cell>
                    <Table.Cell>{line.inventory_item_id}</Table.Cell>
                    <Table.Cell>{line.quantity}</Table.Cell>
                    <Table.Cell>{line.price ?? "-"}</Table.Cell>
                    <Table.Cell>{fmtUTC(line.created_at)}</Table.Cell>
                    <Table.Cell>{fmtUTC(line.updated_at)}</Table.Cell>
                  </Table.Row>
                  {isOpen && (
                    <tr key={`${line.id}-details`}>
                      <td colSpan={7} className="p-0">
                        <div className="bg-ui-bg-subtle rounded-md">
                          {line.metadata ? (
                            <div className="p-4 text-sm">
                              <Text weight="plus" className="mb-1 block">Metadata</Text>
                              <pre className="whitespace-pre-wrap break-words text-ui-fg-subtle text-xs bg-ui-bg-base p-3 rounded-md border border-ui-border-base">{JSON.stringify(line.metadata, null, 2)}</pre>
                            </div>
                          ) : null}

                          <div className="p-4 pt-0">
                            <Text weight="plus" className="mb-2 block">Inventory Items</Text>
                            {Array.isArray(line.inventory_items) && line.inventory_items.length > 0 ? (
                              <div className="overflow-x-auto">
                                <Table className="w-full">
                                  <Table.Header>
                                    <Table.Row>
                                      <Table.HeaderCell>Item ID</Table.HeaderCell>
                                      <Table.HeaderCell>Title</Table.HeaderCell>
                                      <Table.HeaderCell>Description</Table.HeaderCell>
                                      <Table.HeaderCell>Raw Material</Table.HeaderCell>
                                      <Table.HeaderCell>Material Type</Table.HeaderCell>
                                    </Table.Row>
                                  </Table.Header>
                                  <Table.Body>
                                    {line.inventory_items.map((ii) => (
                                      <Table.Row key={ii.id}>
                                        <Table.Cell>{ii.id}</Table.Cell>
                                        <Table.Cell>{ii.title || "-"}</Table.Cell>
                                        <Table.Cell>{ii.description || "-"}</Table.Cell>
                                        <Table.Cell>{ii.raw_materials?.name || "-"}</Table.Cell>
                                        <Table.Cell>{ii.raw_materials?.material_type?.id || "-"}</Table.Cell>
                                      </Table.Row>
                                    ))}
                                  </Table.Body>
                                </Table>
                              </div>
                            ) : (
                              <Text size="small" className="text-ui-fg-subtle">No inventory items</Text>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </Table.Body>
        </Table>
      </div>

    </div>
  )
}
