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
      viewBox="0 0 200 360"
      className="w-full h-auto max-h-[420px]"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ui-bg-subtle)" />
          <stop offset="100%" stopColor="var(--ui-bg-base)" />
        </linearGradient>
      </defs>

      <ellipse cx="100" cy="42" rx="32" ry="40" stroke="var(--ui-border-base)" strokeWidth="2.5" fill="url(#bodyGrad)" />

      <path
        d="M 72 78 L 52 96 L 44 150 L 38 210 L 52 212 L 58 160 L 64 120 L 72 100 Z"
        stroke="var(--ui-border-base)"
        strokeWidth="2.5"
        fill="url(#bodyGrad)"
        strokeLinejoin="round"
      />
      <path
        d="M 128 78 L 148 96 L 156 150 L 162 210 L 148 212 L 142 160 L 136 120 L 128 100 Z"
        stroke="var(--ui-border-base)"
        strokeWidth="2.5"
        fill="url(#bodyGrad)"
        strokeLinejoin="round"
      />

      <path
        d="M 64 95 Q 100 88 136 95 L 136 108 L 142 130 L 148 168 L 140 172 L 136 140 L 136 132 Q 100 140 64 132 L 64 140 L 60 172 L 52 168 L 58 130 L 64 108 Z"
        stroke="var(--ui-border-base)"
        strokeWidth="2.5"
        fill="url(#bodyGrad)"
        strokeLinejoin="round"
      />

      <path
        d="M 72 168 Q 60 210 64 275 Q 72 330 78 350 L 92 350 L 96 310 L 100 250 L 104 310 L 108 350 L 122 350 Q 128 330 136 275 Q 140 210 128 168 Z"
        stroke="var(--ui-border-base)"
        strokeWidth="2.5"
        fill="url(#bodyGrad)"
        strokeLinejoin="round"
      />

      <g>
        <line
          x1="28" y1="130" x2="172" y2="130"
          stroke="var(--ui-fg-subtle)"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <line x1="22" y1="126" x2="28" y2="130" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="22" y1="134" x2="28" y2="130" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="130" x2="178" y2="126" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="130" x2="178" y2="134" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <rect x="4" y="118" width="44" height="22" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="26" y="133" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Chest
        </text>
      </g>

      <g>
        <line
          x1="28" y1="168" x2="172" y2="168"
          stroke="var(--ui-fg-subtle)"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <line x1="22" y1="164" x2="28" y2="168" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="22" y1="172" x2="28" y2="168" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="168" x2="178" y2="164" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="168" x2="178" y2="172" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <rect x="4" y="156" width="44" height="22" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="26" y="171" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Waist
        </text>
      </g>

      <g>
        <line
          x1="28" y1="210" x2="172" y2="210"
          stroke="var(--ui-fg-subtle)"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />
        <line x1="22" y1="206" x2="28" y2="210" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="22" y1="214" x2="28" y2="210" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="210" x2="178" y2="206" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <line x1="172" y1="210" x2="178" y2="214" stroke="var(--ui-fg-subtle)" strokeWidth="1.5" />
        <rect x="2" y="198" width="48" height="22" rx="3" fill="var(--ui-bg-base)" stroke="var(--ui-border-base)" strokeWidth="1" />
        <text x="26" y="213" textAnchor="middle" fontSize="11" fill="var(--ui-fg-base)" className="font-medium">
          Hips
        </text>
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
                <div className="w-full max-w-[260px] mx-auto lg:mx-0 lg:w-[240px] lg:flex-shrink-0">
                  <MeasurementDiagram />
                  <Text className="mt-3 text-center text-ui-fg-subtle text-xs leading-relaxed">
                    Wrap a measuring tape around the widest part of each area,
                    keeping it parallel to the floor.
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
