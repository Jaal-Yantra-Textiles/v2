"use client"

import React from "react"
import { Badge, IconBadge, Popover, Text } from "@medusajs/ui"
import Link from "next/link"

type Props = {
  score: number
  maxScore: number
}

export const MobileDesignScore: React.FC<Props> = ({ score, maxScore }) => {
  return (
    <div className="small:hidden">
      <Popover>
        <Popover.Trigger asChild>
          <button type="button" className="flex items-center gap-x-1 cursor-pointer">
            <Badge color="green">Score: {score}/{maxScore}</Badge>
            <IconBadge>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="feather feather-info"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
            </IconBadge>
          </button>
        </Popover.Trigger>
        <Popover.Content side="bottom" align="center" sideOffset={8} className="p-0 w-fit">
          <div className="rounded-md border border-ui-border-base p-3 bg-ui-bg-base w-56">
            <div className="flex flex-col gap-y-2 txt-compact-small items-center text-center">
              <Text className="txt-compact-small-plus font-semibold">
                What is a Design Score?
              </Text>
              <Text>
                The score indicates the completeness of the design
                information. A higher score means more details like
                tasks, partners, and raw materials are available.
              </Text>
              <Link href="/what-is-a-design-score" className="text-ui-fg-interactive hover:underline">
                Learn more
              </Link>
            </div>
          </div>
        </Popover.Content>
      </Popover>
    </div>
  )
}
