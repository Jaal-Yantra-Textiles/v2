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
        <FocusModal.Body className="py-16">
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-4xl">
              <Heading level="h2" className="mb-4 text-center">Size Reference</Heading>
              <Text className="mb-8 text-center text-ui-fg-subtle">
                Find your perfect fit. Measurements are in inches.
              </Text>
              <Table>
                <Table.Header className="bg-ui-bg-subtle">
                  <Table.Row>
                    <Table.HeaderCell>Size</Table.HeaderCell>
                    <Table.HeaderCell>Chest (in)</Table.HeaderCell>
                    <Table.HeaderCell>Chest (cm)</Table.HeaderCell>
                    <Table.HeaderCell>Waist (in)</Table.HeaderCell>
                    <Table.HeaderCell>Waist (cm)</Table.HeaderCell>
                    <Table.HeaderCell>Hips (in)</Table.HeaderCell>
                    <Table.HeaderCell>Hips (cm)</Table.HeaderCell>
                    <Table.HeaderCell>US</Table.HeaderCell>
                    <Table.HeaderCell>UK</Table.HeaderCell>
                    <Table.HeaderCell>EU</Table.HeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>XS</Table.Cell>
                    <Table.Cell>34-36</Table.Cell>
                    <Table.Cell>86-91</Table.Cell>
                    <Table.Cell>28-30</Table.Cell>
                    <Table.Cell>71-76</Table.Cell>
                    <Table.Cell>34-36</Table.Cell>
                    <Table.Cell>86-91</Table.Cell>
                    <Table.Cell>34</Table.Cell>
                    <Table.Cell>34</Table.Cell>
                    <Table.Cell>44</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>S</Table.Cell>
                    <Table.Cell>36-38</Table.Cell>
                    <Table.Cell>91-97</Table.Cell>
                    <Table.Cell>30-32</Table.Cell>
                    <Table.Cell>76-81</Table.Cell>
                    <Table.Cell>36-38</Table.Cell>
                    <Table.Cell>91-97</Table.Cell>
                    <Table.Cell>36</Table.Cell>
                    <Table.Cell>36</Table.Cell>
                    <Table.Cell>46</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>M</Table.Cell>
                    <Table.Cell>38-40</Table.Cell>
                    <Table.Cell>97-102</Table.Cell>
                    <Table.Cell>32-34</Table.Cell>
                    <Table.Cell>81-86</Table.Cell>
                    <Table.Cell>38-40</Table.Cell>
                    <Table.Cell>97-102</Table.Cell>
                    <Table.Cell>38</Table.Cell>
                    <Table.Cell>38</Table.Cell>
                    <Table.Cell>48</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>L</Table.Cell>
                    <Table.Cell>40-42</Table.Cell>
                    <Table.Cell>102-107</Table.Cell>
                    <Table.Cell>34-36</Table.Cell>
                    <Table.Cell>86-91</Table.Cell>
                    <Table.Cell>40-42</Table.Cell>
                    <Table.Cell>102-107</Table.Cell>
                    <Table.Cell>40</Table.Cell>
                    <Table.Cell>40</Table.Cell>
                    <Table.Cell>50</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>XL</Table.Cell>
                    <Table.Cell>42-44</Table.Cell>
                    <Table.Cell>107-112</Table.Cell>
                    <Table.Cell>36-38</Table.Cell>
                    <Table.Cell>91-97</Table.Cell>
                    <Table.Cell>42-44</Table.Cell>
                    <Table.Cell>107-112</Table.Cell>
                    <Table.Cell>42</Table.Cell>
                    <Table.Cell>42</Table.Cell>
                    <Table.Cell>52</Table.Cell>
                  </Table.Row>
                  <Table.Row>
                    <Table.Cell>XXL</Table.Cell>
                    <Table.Cell>44-46</Table.Cell>
                    <Table.Cell>112-117</Table.Cell>
                    <Table.Cell>38-40</Table.Cell>
                    <Table.Cell>97-102</Table.Cell>
                    <Table.Cell>44-46</Table.Cell>
                    <Table.Cell>112-117</Table.Cell>
                    <Table.Cell>44</Table.Cell>
                    <Table.Cell>44</Table.Cell>
                    <Table.Cell>54</Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default SizeGuide
