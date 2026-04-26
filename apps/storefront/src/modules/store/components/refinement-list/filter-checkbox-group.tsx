"use client"

import { Checkbox, Label } from "@medusajs/ui"

type FilterCheckboxGroupProps = {
    title: string
    items: {
        id: string
        label: string
        value: string
    }[]
    selected: string[]
    onChange: (value: string) => void
    'data-testid'?: string
}

const FilterCheckboxGroup = ({
    title,
    items,
    selected,
    onChange,
    'data-testid': dataTestId,
}: FilterCheckboxGroupProps) => {
    return (
        <div className="flex flex-col gap-y-3">
            <h3 className="txt-compact-large-plus text-ui-fg-base">{title}</h3>
            <div className="flex flex-col gap-y-2">
                {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-x-2">
                        <Checkbox
                            id={`filter-${item.id}`}
                            checked={selected.includes(item.value)}
                            onCheckedChange={() => onChange(item.value)}
                            data-testid={dataTestId}
                        />
                        <Label
                            htmlFor={`filter-${item.id}`}
                            className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors cursor-pointer"
                        >
                            {item.label}
                        </Label>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default FilterCheckboxGroup
