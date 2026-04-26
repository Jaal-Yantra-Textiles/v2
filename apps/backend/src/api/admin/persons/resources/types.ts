import { MedusaContainer } from "@medusajs/framework/types"
import { z } from "@medusajs/framework/zod"
import { PersonResourceKey } from "./meta"

export interface PersonResourceListResult<T = any> {
  items: T[]
  count?: number
}

export interface PersonResourceHandlers {
  list?: (args: {
    scope: MedusaContainer
    personId: string
    query?: Record<string, unknown>
  }) => Promise<PersonResourceListResult>
  create?: (args: {
    scope: MedusaContainer
    personId: string
    payload: Record<string, unknown>
  }) => Promise<any>
  retrieve?: (args: {
    scope: MedusaContainer
    personId: string
    resourceId: string
  }) => Promise<any>
  update?: (args: {
    scope: MedusaContainer
    personId: string
    resourceId: string
    payload: Record<string, unknown>
  }) => Promise<any>
  delete?: (args: {
    scope: MedusaContainer
    personId: string
    resourceId: string
  }) => Promise<void>
}

export interface PersonResourceDefinition {
  key: PersonResourceKey
  listKey: string
  itemKey: string
  pathSegment: string
  validators?: {
    create?: z.ZodTypeAny
    update?: z.ZodTypeAny
  }
  handlers: PersonResourceHandlers
}

export type PersonResourceRegistry = Record<PersonResourceKey, PersonResourceDefinition>
