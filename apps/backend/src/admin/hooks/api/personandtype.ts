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

export interface ContactDetail {
  id: string;
  phone_number: string;
  type: "mobile" | "home" | "work";
  created_at?: string;
  updated_at?: string;
}

export interface ContactInput {
  phone_number: string;
  type: "mobile" | "home" | "work";
}

export type ContactUpdateInput = Partial<ContactInput>;

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
  person_types?: AdminPersonType[];
  avatar: string;
  contact_details: ContactDetail[];
  tags: Tag[];
  addresses?: AddressDetails[];
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
  latitude?: number;
  longitude?: number
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
