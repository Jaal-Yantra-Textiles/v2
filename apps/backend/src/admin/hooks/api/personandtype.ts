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

/**
 * A masked (PII-redacted) census weaver record, returned by GET /admin/persons
 * when `include_weavers` is on. Shape mirrors the census reader's public
 * projection: name + coords promoted, raw survey bag and contact/id values
 * already stripped server-side.
 */
export interface AdminWeaver {
  census_id: string | number;
  name?: string | null;
  state?: string | null;
  district?: string | null;
  block?: string | null;
  village?: string | null;
  gender?: string | null;
  education?: string | null;
  rural_urban?: string | null;
  own_looms?: boolean | null;
  natural_dye_used?: boolean | null;
  mobile_masked?: string | null;
  aadhaar_card_available?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: any;
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
  include_weavers?: boolean;
  region_state?: string;
  district?: string;
  block?: string;
  village?: string;
  gender?: string;
  rural_urban?: string;
  own_looms?: string;
  natural_dye_used?: string;
  education?: string;
  ownership_type?: string;
  household_type?: string;
  dwelling_type?: string;
  electricity?: string;
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
