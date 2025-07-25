import { MedusaRequest, MedusaResponse } from "@medusajs/framework";

export interface AddressDetails {
  id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude: number;
  longitude: number;
}

interface ContactDetail {
  id: string;
  phone_number: string;
  type: "mobile" | "home" | "work";
}

export interface Tag {
  id: string;
  name: any; // JSON type from the model
}

export interface AdminPerson {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: string;
  created_at: string;
  state: string;
  metadata: Record<string, unknown> | null;
  person_type?: AdminPersonType[];
  avatar: string;
  contact_details: ContactDetail[];
  tags: Tag[];
  deleted_at: string | null;
}

export interface AdminCreatePerson {
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: Date | string | null;
}

export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude: number;
  longitude: number
}

export interface Address {
  addresses?: AddressDetails[];
}

export interface PersonWithAddress extends AdminPerson, Address {}

export interface AdminUpdatePerson extends AdminCreatePerson {
  addresses?: AddressDetails[];
  metadata?: Record<string, any> | null | undefined;
  avatar?: string;
}

export interface AdminPersonResponse {
  person: AdminPerson;
}

export interface AdminPersonDeleteResponse {
  id: string;
  object: "person";
  deleted: boolean;
}

export interface AdminPersonsListResponse {
  persons: AdminPerson[];
}

export interface AdminPersonsListParams {
  limit: number;
  offset: number;
  order?: string | undefined;
  email?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: Date;
  state?: string;
  created_at?: string;
  updated_at?: string;
  q?: string;
  withDeleted?: boolean;
}

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

export interface AdminUpdatePersonType {}

export interface AdminPersonTypeResponse {
  personType: AdminPersonType;
}

export interface AdminPersonTypeDeleteResponse {
  id: string;
  object: "personType";
  deleted: boolean;
}

export interface AdminPersonTypeListResponse {
  personType: AdminPersonType[];
}

export interface AdminPersonTypeListParams {
  limit: number;
  offset: number;
  order?: string;
  created_at: string;
  updated_at: string;
  q?: string;
}

// Original types from the top of the file
export type Person = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  type: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CreatePersonInput = {
  email: string;
  first_name: string;
  last_name: string;
  type: string;
};

export type CreatePersonRequest = MedusaRequest<CreatePersonInput>;

export type CreatePersonResponse = MedusaResponse<{
  person: Person;
}>;

export type GetPersonsParams = {
  type?: string;
  email?: string;
};

export type GetPersonsRequest = MedusaRequest<GetPersonsParams>;

export type GetPersonsResponse = MedusaResponse<{
  persons: Person[];
  count: number;
  offset: number;
  limit: number;
}>;

export type PersonType = {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type CreatePersonTypeInput = {
  name: string;
  description?: string;
};

export type CreatePersonTypeRequest = MedusaRequest<CreatePersonTypeInput>;

export type CreatePersonTypeResponse = MedusaResponse<{
  person_type: PersonType;
}>;

export type GetPersonTypesParams = {
  name?: string;
};

export type GetPersonTypesRequest = MedusaRequest<GetPersonTypesParams>;

export type GetPersonTypesResponse = MedusaResponse<{
  person_types: PersonType[];
  count: number;
  offset: number;
  limit: number;
}>;
