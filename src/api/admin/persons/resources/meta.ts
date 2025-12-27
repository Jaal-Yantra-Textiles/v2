export const PERSON_RESOURCE_META = {
  addresses: {
    listKey: "addresses",
    itemKey: "address",
    pathSegment: "addresses",
  },
  contacts: {
    listKey: "contacts",
    itemKey: "contact",
    pathSegment: "contacts",
  },
  tags: {
    listKey: "tags",
    itemKey: "tag",
    pathSegment: "tags",
  },
} as const

export type PersonResourceKey = keyof typeof PERSON_RESOURCE_META

export const isPersonResourceKey = (
  value: string,
): value is PersonResourceKey => value in PERSON_RESOURCE_META
