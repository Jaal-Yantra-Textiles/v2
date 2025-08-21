import { Select, clx } from "@medusajs/ui"
import { Controller } from "react-hook-form"
import { useDataGridCell, useDataGridCellError } from "../hooks"
import { DataGridCellProps } from "../types"
import { DataGridCellContainer } from "./data-grid-cell-container"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { useDataGridContext } from "../context"

interface DataGridSelectCellProps<TData, TValue = any>
  extends DataGridCellProps<TData, TValue> {
  options: { label: React.ReactNode; value: string; disabled?: boolean }[]
  // Optional loading state to render a loading item
  loading?: boolean
  // If true, will reset external query after select (deferred). Defaults to false to avoid bouncing.
  resetQueryOnSelect?: boolean
}

export const DataGridSelectCell = <TData, TValue = any>({
  context,
  options,
  loading = false,
  resetQueryOnSelect = false,
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

  useEffect(() => {
    if (!loading) {
      setDisplayOptions(options)
    }
  }, [options, loading])

  // Reset open-related state when closing
  useEffect(() => {
    if (!open) {
      // no-op currently
    }
  }, [open])

  const { setTrapActive } = useDataGridContext()

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
                 {loading && (
                   <Select.Item key="__loading" value="__loading" disabled>
                     Loading...
                   </Select.Item>
                 )}
                 {displayOptions.map((option) => (
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
