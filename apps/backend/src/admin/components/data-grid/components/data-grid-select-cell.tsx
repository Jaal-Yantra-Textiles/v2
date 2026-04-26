import { Input, Select, clx } from "@medusajs/ui"
import { Controller } from "react-hook-form"
import { useDataGridCell, useDataGridCellError } from "../hooks"
import { DataGridCellProps } from "../types"
import { DataGridCellContainer } from "./data-grid-cell-container"
import React, { useEffect, useMemo, useState } from "react"
import { useDataGridContext } from "../context"

interface DataGridSelectCellProps<TData, TValue = any>
  extends DataGridCellProps<TData, TValue> {
  options: { label: React.ReactNode; value: string; disabled?: boolean }[]
  // Optional loading state to render a loading item
  loading?: boolean
  searchable?: boolean
  noResultsLabel?: string
}

export const DataGridSelectCell = <TData, TValue = any>({
  context,
  options,
  loading = false,
  searchable = false,
  noResultsLabel = "No results",
}: DataGridSelectCellProps<TData, TValue>) => {
  const { field, control, renderProps } = useDataGridCell({
    context,
  })
  
  const errorProps = useDataGridCellError({ context })

  const { container, input } = renderProps

  // Check if control is null and return null if so
  if (!control) {
    return null;
  }

  const [open, setOpen] = useState(false)
  // Cache options to avoid list churn while loading (which can steal focus/close)
  const [displayOptions, setDisplayOptions] = useState(options)
  const [filterQuery, setFilterQuery] = useState("")

  useEffect(() => {
    if (!loading) {
      setDisplayOptions(options)
    }
  }, [options, loading])

  // Reset open-related state when closing
  useEffect(() => {
    if (!open) {
      setFilterQuery("")
    }
  }, [open])

  const { setTrapActive } = useDataGridContext()

  const filteredOptions = useMemo(() => {
    if (!filterQuery.trim()) {
      return displayOptions
    }

    const lower = filterQuery.toLowerCase()
    return displayOptions.filter((option) => {
      if (typeof option.label === "string") {
        return option.label.toLowerCase().includes(lower)
      }
      return false
    })
  }, [displayOptions, filterQuery])

  return (
    <Controller
      control={control}
      name={field}
      render={({ field: { onChange, ref, ...selectField } }) => {
        // Extract only the props that are compatible with Select.Trigger
        const { onChange: inputOnChange, ...inputProps } = input;
        
        return (
          <DataGridCellContainer {...container} {...errorProps}>
            <Select value={(selectField.value as string) || ""} onValueChange={(val) => {
               onChange(val)
               // Close dropdown
               setOpen(false)
             }} open={open} onOpenChange={(next) => {
               // Prevent auto-close while loading to avoid bounce
               if (!next && loading) {
                 setOpen(true)
                 return
               }
               setOpen(next)
               // Suspend grid focus trap while open so it doesn't steal focus on re-renders
               if (next) {
                 setTrapActive(false)
               } else {
                 // Defer to allow popover to fully close without immediate refocus
                 setTimeout(() => setTrapActive(true), 0)
               }
             }}>
               <Select.Trigger
                 {...inputProps}
                 ref={ref}
                 className={clx(
                   "h-full w-full rounded-none bg-transparent px-4 py-2.5 shadow-none",
                   "hover:bg-transparent focus:shadow-none data-[state=open]:!shadow-none"
                 )}
               >
                 <Select.Value />
               </Select.Trigger>
               <Select.Content>
                {searchable && (
                  <div className="border-b border-ui-border-base px-3 py-2">
                    <Input
                      size="small"
                      placeholder="Search"
                      value={filterQuery}
                      onChange={(event) => setFilterQuery(event.target.value)}
                      autoFocus
                    />
                  </div>
                )}
                {loading && (
                  <Select.Item key="__loading" value="__loading" disabled>
                    Loading...
                  </Select.Item>
                )}
                {!loading && filteredOptions.length === 0 && (
                  <Select.Item key="__no_results" value="__no_results" disabled>
                    {noResultsLabel}
                  </Select.Item>
                )}
                {filteredOptions.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </DataGridCellContainer>
        )
      }}
    />
  )
}