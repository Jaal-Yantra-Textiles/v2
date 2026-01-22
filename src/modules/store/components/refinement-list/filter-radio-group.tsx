"use client"

import { Label, RadioGroup } from "@medusajs/ui"

type FilterRadioGroupProps = {
    title: string
    items: {
        id: string
        label: string
        value: string
    }[]
    value: string
    onChange: (value: string) => void
    'data-testid'?: string
}

const FilterRadioGroup = ({
    title,
    items,
    value,
    onChange,
    'data-testid': dataTestId,
}: FilterRadioGroupProps) => {
    return (
        <div className="flex flex-col gap-y-3">
            <h3 className="txt-compact-large-plus text-ui-fg-base">{title}</h3>
            <RadioGroup
                value={value}
                onValueChange={onChange}
                data-testid={dataTestId}
            >
                {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-x-2">
                        <RadioGroup.Item
                            value={item.value}
                            id={`filter-${item.id}`}
                        />
                        <Label
                            htmlFor={`filter-${item.id}`}
                            className="text-ui-fg-subtle hover:text-ui-fg-base transition-colors cursor-pointer"
                        >
                            {item.label}
                        </Label>
                    </div>
                ))}
            </RadioGroup>
        </div>
    )
}

export default FilterRadioGroup
