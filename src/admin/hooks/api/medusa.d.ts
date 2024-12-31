// types/person.d.ts
import { AdminPostCustomersReq, AdminCustomersRes } from "@medusajs/medusa";
import { PaginatedResponse } from "@medusajs/types";

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
}
