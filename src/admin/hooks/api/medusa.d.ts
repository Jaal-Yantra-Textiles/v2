// types/person.d.ts
import { AdminPostCustomersReq, AdminCustomersRes } from "@medusajs/medusa";
import { PaginatedResponse } from "@medusajs/types";

import { MedusaRequest, MedusaResponse } from "@medusajs/framework"

export type Person = {
  id: string
  email: string
  first_name: string
  last_name: string
  type: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreatePersonInput = {
  email: string
  first_name: string
  last_name: string
  type: string
}

export type CreatePersonRequest = MedusaRequest<CreatePersonInput>

export type CreatePersonResponse = MedusaResponse<{
  person: Person
}>

export type GetPersonsParams = {
  type?: string
  email?: string
}

export type GetPersonsRequest = MedusaRequest<GetPersonsParams>

export type GetPersonsResponse = MedusaResponse<{
  persons: Person[]
  count: number
  offset: number
  limit: number
}>

export type PersonType = {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreatePersonTypeInput = {
  name: string
  description?: string
}

export type CreatePersonTypeRequest = MedusaRequest<CreatePersonTypeInput>

export type CreatePersonTypeResponse = MedusaResponse<{
  person_type: PersonType
}>

export type GetPersonTypesParams = {
  name?: string
}

export type GetPersonTypesRequest = MedusaRequest<GetPersonTypesParams>

export type GetPersonTypesResponse = MedusaResponse<{
  person_types: PersonType[]
  count: number
  offset: number
  limit: number
}>

export type Address = {
  id: string
  address_1: string
  address_2?: string
  city: string
  country_code: string
  postal_code: string
  province?: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreateAddressInput = {
  address_1: string
  address_2?: string
  city: string
  country_code: string
  postal_code: string
  province?: string
}

export type CreateAddressRequest = MedusaRequest<CreateAddressInput>

export type CreateAddressResponse = MedusaResponse<{
  address: Address
}>

export type RawMaterial = {
  id: string
  name: string
  description: string
  composition: string
  specifications: any | null
  unit_of_measure: string
  minimum_order_quantity: number
  lead_time_days: number
  color: string
  width: string
  weight: string
  grade: string
  certification: any | null
  usage_guidelines: string | null
  storage_requirements: string | null
  status: string
  metadata: any | null
  material_type_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  material_type: {
    id: string
    name: string
    description: string | null
    category: string
    properties: any | null
    metadata: any | null
    created_at: string
    updated_at: string
    deleted_at: string | null
  }
}

export type CreateRawMaterialInput = {
  rawMaterialData: {
    name: string
  status: string
  composition?: string
  material_type?: {
    name: string
    category: string
  }
  unit_of_measure?: string
  minimum_order_quantity?: number
  lead_time_days?: number
  }
}

export type CreateRawMaterialRequest = MedusaRequest<CreateRawMaterialInput>

export type CreateRawMaterialResponse = MedusaResponse<{
  raw_material: RawMaterial
}>

export type GetInventoryRawMaterialsParams = {
  status?: string
  material_type?: string
}

export type GetInventoryRawMaterialsRequest = MedusaRequest<GetInventoryRawMaterialsParams>

export type GetInventoryRawMaterialsResponse = MedusaResponse<{
  raw_material: RawMaterial
}>

declare module "@medusajs/types" {
  export namespace HttpTypes {
    export interface AdminPerson {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      date_of_birth: string;
      created_at: string;
      state: string;
      metadata: Record<string, unknown> | null;
      avatar: string;
    }

    interface AddressDetails {
      id: string
      street: string;
      city: string;
      state: string;
      postal_code: string;
      country: string;
    }

    interface Address {
      addresses?: AddressDetails[];
    }

    export interface PersonWithAddress extends AdminPerson, Address {}

    export interface AdminCreatePerson {
      first_name: string;
      last_name: string;
      email: string;
      date_of_birth: Date | null;
      metadata: Record<string, unknown> | null;
    }

    export interface AdminUpdatePerson extends Partial<AdminCreatePerson> {
      addresses?: AddressDetails[];
    }

    export interface AdminPersonResponse {
      person: AdminPerson;
    }

    export interface AdminPersonDeleteResponse {
      id: string;
      object: "person";
      deleted: boolean;
    }

    export interface AdminPersonsListResponse extends PaginatedResponse {
      persons: AdminPerson[];
    }

    export interface AdminPersonsListParams {
      limit: number;
      offset: number;
      order?: string | undefined;
      created_at: string;
      updated_at: string;
      q?: string | undefined;
    }
    // Admin Person Type
    export interface AdminPersonType {
      id: string;
      name: string;
      description: string;
      created_at: string;
    }
    export interface AdminCreatePersonType {
      name: string;
      description: string;
    }
    export interface AdminUpdatePersonType
      extends Partial<AdminCreatePersonType> {}
  }

  export interface AdminPersonTypeResponse {
    personType: AdminPersonType;
  }

  export interface AdminPersonTypeDeleteResponse {
    id: string;
    object: "personType";
    deleted: boolean;
  }

  export interface AdminPersonTypeListResponse extends PaginatedResponse {
    personType: AdminPersonType[];
  }

  export interface AdminPersonTypeListParams {
    limit: number;
    offset: number;
    order?: string | undefined;
    created_at: string;
    updated_at: string;
    q?: string | undefined;
  }

  export namespace HttpTypes {
    export interface AdminPostInventoryItemsRawMaterialsReq extends CreateRawMaterialRequest {}
    export interface AdminPostInventoryItemsRawMaterialsRes extends CreateRawMaterialResponse {}
    export interface AdminGetInventoryItemsRawMaterialsParams extends GetInventoryRawMaterialsRequest {}
    export interface AdminGetInventoryItemsRawMaterialsRes extends GetInventoryRawMaterialsResponse {}
  }
}
