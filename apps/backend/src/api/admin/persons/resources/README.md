# Person Resource Module

This directory houses the new catch-all resource infrastructure for person sub-entities (addresses, contacts, tags, etc.).

Structure:
- `registry.ts` – centralized metadata for each sub-resource.
- `api/` – shared route handlers built dynamically from the registry.
- `hooks/` – React hooks that consume the registry to generate typed data-access helpers.
- `types.ts` – common TypeScript helpers shared across registry, hooks, and routes.
- `meta.ts` – shared list/listKey/itemKey/path metadata used across routes + hooks.

## Admin Hook Usage

The admin dashboard can opt into the new catch-all API without touching legacy routes by
importing the generated hooks from `src/admin/hooks/api/person-resource-hooks.ts`.

```ts
import { personResourceHooks } from "../../hooks/api/person-resource-hooks"

const {
  useResourceList: usePersonAddresses,
  useCreateResource: useCreatePersonAddress,
  useUpdateResource: useUpdatePersonAddress,
  useDeleteResource: useDeletePersonAddress,
} = personResourceHooks.addresses

const { items: addresses } = usePersonAddresses(personId)
const { mutateAsync: createAddress } = useCreatePersonAddress(personId)
```

Each resource block exposes:

- `useResourceList(personId, query?, options?)`
- `useResource(personId, resourceId, options?)`
- `useCreateResource(personId, options?)`
- `useUpdateResource(personId, resourceId, options?)`
- `useDeleteResource(personId, resourceId, options?)`

The hooks automatically invalidate list/detail caches scoped per person and infer the
correct response key (e.g., `address`, `contact`, `tag`) from the registry metadata.

> Legacy hooks (`person-addresses`, `person-contacts`, `person-tags`) remain available for
> the transition window. Migrate UI modules incrementally by swapping in the new hooks.

The legacy per-resource routes/hooks remain untouched until the new system is fully rolled out.
