import { Select, clx } from "@medusajs/ui"
import { Controller } from "react-hook-form"
import { useDataGridCell, useDataGridCellError } from "../hooks"
import { DataGridCellProps } from "../types"
import { DataGridCellContainer } from "./data-grid-cell-container"

interface DataGridSelectCellProps<TData, TValue = any>
  extends DataGridCellProps<TData, TValue> {
  options: { label: string; value: string; disabled?: boolean }[]
}

export const DataGridSelectCell = <TData, TValue = any>({
  context,
  options,
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

  return (
    <Controller
      control={control}
      name={field}
      render={({ field: { onChange, ref, ...selectField } }) => {
        // Extract only the props that are compatible with Select.Trigger
        const { onChange: inputOnChange, ...inputProps } = input;
        
        return (
          <DataGridCellContainer {...container} {...errorProps}>
            <Select value={selectField.value as string || ""} onValueChange={onChange}>
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
                {options.map((option) => (
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
