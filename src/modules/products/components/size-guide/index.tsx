'use client'
import { Button, FocusModal, Heading, IconBadge, Table, Text } from "@medusajs/ui"
import { ArrowsPointingOutMini } from "@medusajs/icons"

const SizeGuide = () => {
  return (
    <FocusModal>
      <FocusModal.Trigger asChild>
        <IconBadge>
          <ArrowsPointingOutMini />
        </IconBadge>
      </FocusModal.Trigger>
      <FocusModal.Content className="z-[60]">

        <FocusModal.Header />
        <FocusModal.Title></FocusModal.Title>
        <FocusModal.Body className="py-8 sm:py-16 px-4 sm:px-6">
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-4xl">
              <Heading level="h2" className="mb-2 sm:mb-4 text-center text-lg sm:text-xl">Size Reference</Heading>
              <Text className="mb-4 sm:mb-8 text-center text-ui-fg-subtle text-sm">
                Find your perfect fit. Scroll horizontally on mobile to see all measurements.
              </Text>
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <Table className="min-w-[600px] sm:min-w-0">
                  <Table.Header className="bg-ui-bg-subtle">
                    <Table.Row>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">Size</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">Chest</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">Waist</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">Hips</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">US</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">UK</Table.HeaderCell>
                      <Table.HeaderCell className="text-xs sm:text-sm whitespace-nowrap">EU</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">XS</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">34-36″ / 86-91cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">28-30″ / 71-76cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">34-36″ / 86-91cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">34</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">34</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">44</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">S</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">36-38″ / 91-97cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">30-32″ / 76-81cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">36-38″ / 91-97cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">36</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">36</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">46</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">M</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">38-40″ / 97-102cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">32-34″ / 81-86cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">38-40″ / 97-102cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">38</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">38</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">48</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">L</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">40-42″ / 102-107cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">34-36″ / 86-91cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">40-42″ / 102-107cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">40</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">40</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">50</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">XL</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">42-44″ / 107-112cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">36-38″ / 91-97cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">42-44″ / 107-112cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">42</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">42</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">52</Table.Cell>
                    </Table.Row>
                    <Table.Row>
                      <Table.Cell className="text-xs sm:text-sm font-medium">XXL</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">44-46″ / 112-117cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">38-40″ / 97-102cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">44-46″ / 112-117cm</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">44</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">44</Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm">54</Table.Cell>
                    </Table.Row>
                  </Table.Body>
                </Table>
              </div>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default SizeGuide
