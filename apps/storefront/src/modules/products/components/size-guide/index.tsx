"use client"

import { FocusModal, Heading, IconBadge, Table, Text } from "@medusajs/ui"
import { ArrowsPointingOutMini } from "@medusajs/icons"

type SizeRow = {
  size: string
  chest: string
  waist: string
  hips: string
  us: string
  uk: string
  eu: string
}

const SIZE_DATA: SizeRow[] = [
  { size: "XS", chest: "34-36\" / 86-91cm", waist: "28-30\" / 71-76cm", hips: "34-36\" / 86-91cm", us: "34", uk: "34", eu: "44" },
  { size: "S", chest: "36-38\" / 91-97cm", waist: "30-32\" / 76-81cm", hips: "36-38\" / 91-97cm", us: "36", uk: "36", eu: "46" },
  { size: "M", chest: "38-40\" / 97-102cm", waist: "32-34\" / 81-86cm", hips: "38-40\" / 97-102cm", us: "38", uk: "38", eu: "48" },
  { size: "L", chest: "40-42\" / 102-107cm", waist: "34-36\" / 86-91cm", hips: "40-42\" / 102-107cm", us: "40", uk: "40", eu: "50" },
  { size: "XL", chest: "42-44\" / 107-112cm", waist: "36-38\" / 91-97cm", hips: "42-44\" / 107-112cm", us: "42", uk: "42", eu: "52" },
  { size: "XXL", chest: "44-46\" / 112-117cm", waist: "38-40\" / 97-102cm", hips: "44-46\" / 112-117cm", us: "44", uk: "44", eu: "54" },
]

function MeasurementDiagram() {
  return (
    <svg
      viewBox="0 0 280 340"
      className="w-full h-auto"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Garment measurement guide"
    >
      <defs>
        <linearGradient id="garmentFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ui-bg-subtle)" />
          <stop offset="100%" stopColor="var(--ui-bg-base)" />
        </linearGradient>
      </defs>

      <path
        d="M 100 24 L 80 38 L 58 52 L 62 66 L 70 62 L 70 70 L 50 78 L 40 110 L 34 152 L 34 280 L 34 300 L 246 300 L 246 280 L 246 152 L 240 110 L 230 78 L 210 70 L 210 62 L 218 66 L 222 52 L 200 38 L 180 24 L 160 28 Q 140 36 120 28 Z"
        stroke="var(--ui-border-base)"
        strokeWidth="2"
        fill="url(#garmentFill)"
        strokeLinejoin="round"
      />

      <path
        d="M 120 28 Q 140 42 160 28"
        stroke="var(--ui-border-base)"
        strokeWidth="1.5"
        fill="none"
      />

      <line x1="140" y1="30" x2="140" y2="300" stroke="var(--ui-border-base)" strokeWidth="1" strokeDasharray="3 4" opacity="0.4" />

      <line x1="62" y1="66" x2="218" y2="66" stroke="var(--ui-border-base)" strokeWidth="1" strokeDasharray="2 3" opacity="0.3" />
      <line x1="70" y1="70" x2="210" y2="70" stroke="var(--ui-border-base)" strokeWidth="1" opacity="0.3" />

      <g>
        <line x1="14" y1="92" x2="266" y2="92" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="14" y1="86" x2="14" y2="98" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="266" y1="86" x2="266" y2="98" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="34" y1="92" x2="40" y2="86" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="40" y1="92" x2="34" y2="98" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="246" y1="92" x2="240" y2="86" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="240" y1="92" x2="246" y2="98" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <rect x="2" y="76" width="56" height="20" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="30" y="90" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Chest
        </text>
      </g>

      <g>
        <line x1="14" y1="140" x2="266" y2="140" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="14" y1="134" x2="14" y2="146" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="266" y1="134" x2="266" y2="146" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="34" y1="140" x2="40" y2="134" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="40" y1="140" x2="34" y2="146" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="246" y1="140" x2="240" y2="134" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="240" y1="140" x2="246" y2="146" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <rect x="2" y="124" width="56" height="20" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="30" y="138" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Waist
        </text>
      </g>

      <g>
        <line x1="14" y1="196" x2="266" y2="196" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="14" y1="190" x2="14" y2="202" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="266" y1="190" x2="266" y2="202" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="34" y1="196" x2="40" y2="190" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="40" y1="196" x2="34" y2="202" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="246" y1="196" x2="240" y2="190" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="240" y1="196" x2="246" y2="202" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <rect x="0" y="180" width="60" height="20" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="30" y="194" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Hips
        </text>
      </g>

      <g>
        <line x1="270" y1="24" x2="270" y2="300" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="264" y1="24" x2="276" y2="24" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="264" y1="300" x2="276" y2="300" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="270" y1="28" x2="264" y2="34" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <line x1="270" y1="28" x2="276" y2="34" stroke="var(--ui-fg-subtle)" strokeWidth="1" />
        <rect x="248" y="152" width="48" height="20" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="272" y="166" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Length
        </text>
      </g>

      <path d="M 100 24 Q 104 20 106 24 M 108 24 Q 112 20 114 24 M 116 24 Q 120 20 122 24 M 124 24 Q 128 20 130 24" stroke="var(--ui-border-base)" strokeWidth="1.5" fill="none" opacity="0.5" />
      <path d="M 150 24 Q 154 20 156 24 M 158 24 Q 162 20 164 24 M 166 24 Q 170 20 172 24 M 174 24 Q 178 20 180 24" stroke="var(--ui-border-base)" strokeWidth="1.5" fill="none" opacity="0.5" />

      <g opacity="0.3">
        <path d="M 70 62 L 62 66 L 58 52 L 70 62 Z M 210 62 L 218 66 L 222 52 L 210 62 Z" stroke="var(--ui-border-base)" strokeWidth="1" fill="none" />
      </g>
    </svg>
  )
}

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
        <FocusModal.Title />
        <FocusModal.Body className="py-8 sm:py-16 px-4 sm:px-6">
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-5xl">
              <Heading level="h2" className="mb-2 sm:mb-4 text-center text-lg sm:text-xl">
                Size Reference
              </Heading>
              <Text className="mb-4 sm:mb-8 text-center text-ui-fg-subtle text-sm">
                Find your perfect fit. Use the diagram to locate where to measure,
                then match your measurements to the table below.
              </Text>

              <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
                <div className="w-full max-w-[300px] mx-auto lg:mx-0 lg:w-[280px] lg:flex-shrink-0">
                  <MeasurementDiagram />
                  <Text className="mt-3 text-center text-ui-fg-subtle text-xs leading-relaxed">
                    Lay the garment flat and measure across at each point shown.
                    Compare with the table to find your size.
                  </Text>
                </div>

                <div className="flex-1 w-full overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
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
                      {SIZE_DATA.map((row) => (
                        <Table.Row key={row.size}>
                          <Table.Cell className="text-xs sm:text-sm font-medium">{row.size}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">{row.chest}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">{row.waist}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm whitespace-nowrap">{row.hips}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm">{row.us}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm">{row.uk}</Table.Cell>
                          <Table.Cell className="text-xs sm:text-sm">{row.eu}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>
              </div>
            </div>
          </div>
        </FocusModal.Body>
      </FocusModal.Content>
    </FocusModal>
  )
}

export default SizeGuide
