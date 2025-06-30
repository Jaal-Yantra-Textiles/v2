import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Text, Checkbox, Label, Select, Avatar } from "@medusajs/ui"
import { DetailWidgetProps } from "@medusajs/framework/types"
import { Spinner } from "../components/ui/ios-spinner"
import { useState } from "react"

const ProductPeopleWidget = ({ data }: DetailWidgetProps<string>) => {
  const [selectedPeople, setSelectedPeople] = useState<string[]>([])

  // Dummy data for the multi-select
  const dummyOptions = [
    { value: "person_1", label: "John Doe", avatar: "https://avatars.githubusercontent.com/u/10656202?v=4" },
    { value: "person_2", label: "Jane Smith", avatar: "https://avatars.githubusercontent.com/u/2029379?v=4" },
    { value: "person_3", label: "Peter Jones", avatar: "https://avatars.githubusercontent.com/u/12592949?v=4" },
    { value: "person_4", label: "Alice Williams", avatar: "https://avatars.githubusercontent.com/u/810438?v=4" },
  ]

  const handleSelect = (value: string) => {
    setSelectedPeople((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    )
  }

  if (!data) {
    return <Spinner />
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Text size="large" weight="plus" className="mb-1">
          People
        </Text>
        <Text className="text-ui-fg-subtle">
          Assign people to this product.
        </Text>
      </div>
      <div className="px-6 py-4">
        <Select>
          <Select.Trigger>
            <Select.Value placeholder={`Select People (${selectedPeople.length} selected)`} />
          </Select.Trigger>
          <Select.Content onCloseAutoFocus={(e) => e.preventDefault()}>
            {dummyOptions.map((item) => (
              <div key={item.value} className="flex items-center gap-x-2 px-3 py-2">
                <Checkbox 
                  id={item.value} 
                  checked={selectedPeople.includes(item.value)}
                  onCheckedChange={() => handleSelect(item.value)}
                />
                <Label htmlFor={item.value}>{item.label}</Label>
              </div>
            ))}
          </Select.Content>
        </Select>

        <div className="mt-4 flex flex-col gap-y-3">
          {selectedPeople.map((personId) => {
            const person = dummyOptions.find((p) => p.value === personId);
            if (!person) return null;

            return (
              <div key={person.value} className="flex items-center gap-x-3">
                <Avatar src={person.avatar} fallback={person.label[0]} />
                <Text>{person.label}</Text>
              </div>
            );
          })}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductPeopleWidget
