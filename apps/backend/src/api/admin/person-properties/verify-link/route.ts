import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { Link } from "@medusajs/modules-sdk";

import { PERSON_MODULE } from "../../../../modules/person";
import { PERSON_PROPERTY_MODULE } from "../../../../modules/personproperty";

/**
 * STEP-2 verify — query.graph across the person <-> person_property module link,
 * on a REAL boot, with the person_property DAL swappable.
 *
 * The unit tests prove the repository in isolation; the boot-verify proves the
 * loader override wins. Neither exercises Query traversing the module link into
 * a Hyperbee-backed module. This route does exactly that against the running
 * server: person (Postgres) --link--> person_property (Hyperbee when
 * PERSON_PROPERTY_HYPERBEE=true, else Postgres), both directions.
 *
 * It is backend-agnostic on purpose: same assertions pass with the flag on or
 * off, so a green run with the flag ON is the proof that Query loads records
 * from the Hyperbee DAL across a link. Self-contained + self-cleaning.
 *
 * Note: Query hydrates linked records with `{ id: [ids] }` filters and
 * `config.take = null` (no limit). The DAL must honour both shapes — this route
 * is what surfaced that (see @jytextiles/mikrohyperbee list()).
 *
 *   GET /admin/person-properties/verify-link   (admin auth)
 *   -> { ok: true, checks: [...], backend: "hyperbee" | "postgres" }
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as Link;
  const personService: any = req.scope.resolve(PERSON_MODULE);
  const propertyService: any = req.scope.resolve(PERSON_PROPERTY_MODULE);
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  // Which DAL is actually serving person_property right now.
  const internal =
    propertyService?.__container__?.personPropertyService ??
    (propertyService as any)?.personPropertyService_;
  const backend =
    internal?.constructor?.name === "HyperbeeBaseRepository" ? "hyperbee" : "postgres";

  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const assert = (name: string, ok: boolean, detail?: string) =>
    checks.push({ name, ok, ...(detail ? { detail } : {}) });

  // Unique per-run person so repeated calls never collide on the unique email.
  const email = `hyperbee-verify-${Date.now()}@jyt.local`;
  let personId: string | undefined;
  let propertyId: string | undefined;

  try {
    const person = await personService.createPeople({
      first_name: "Hyperbee",
      last_name: "Verify",
      email,
    });
    personId = person.id;

    const created = await propertyService.createPersonProperties({
      profile_type: "weaver",
      district: "AMBALA",
      region_state: "HARYANA",
      total_looms_owned: 3,
    });
    const property = Array.isArray(created) ? created[0] : created;
    propertyId = property.id;

    assert("person_property carries created_at/updated_at (task 1)",
      !!property.created_at && !!property.updated_at,
      `created_at=${property.created_at} updated_at=${property.updated_at}`);

    await remoteLink.create([
      {
        [PERSON_MODULE]: { person_id: personId },
        [PERSON_PROPERTY_MODULE]: { person_property_id: propertyId },
      },
    ]);

    // ── Forward: person -> person_property. NOTE: the query.graph alias is the
    // linked MODEL name (`person_property`), NOT the defineLink `field`
    // ("properties") — the field is misleading for Query traversal. isList is
    // unset on the link, so the relation resolves as a list.
    const { data: persons } = await query.graph({
      entity: "person",
      fields: [
        "id",
        "email",
        "person_property.id",
        "person_property.district",
        "person_property.created_at",
        "person_property.updated_at",
      ],
      filters: { id: personId },
    });
    const rawProps = persons?.[0]?.person_property;
    const props = Array.isArray(rawProps) ? rawProps[0] : rawProps;
    assert("query.graph person.person_property resolves the linked record",
      !!props && props.id === propertyId,
      `got ${JSON.stringify(props?.id)}`);
    assert("linked property data loads across the link (district)",
      props?.district === "AMBALA",
      `district=${props?.district}`);
    assert("timestamps survive query.graph traversal (task 1 x task 2)",
      !!props?.created_at && !!props?.updated_at);

    // ── Reverse: person_property -> person ──
    const { data: properties } = await query.graph({
      entity: "person_property",
      fields: ["id", "district", "person.id", "person.email"],
      filters: { id: propertyId },
    });
    const back = properties?.[0];
    assert("query.graph person_property.person resolves back to the person",
      back?.person?.id === personId,
      `got ${JSON.stringify(back?.person?.id)}`);
  } catch (e: any) {
    assert("verify ran without throwing", false, e?.message || String(e));
    logger?.error(`[person-properties/verify-link] ${e?.stack || e}`);
  } finally {
    // Best-effort cleanup: drop the link + the throwaway person. The Hyperbee
    // property record is a local KV entry; leave it (harmless, no unique email).
    try {
      if (personId && propertyId) {
        await remoteLink.dismiss([
          {
            [PERSON_MODULE]: { person_id: personId },
            [PERSON_PROPERTY_MODULE]: { person_property_id: propertyId },
          },
        ]);
      }
      if (personId) await personService.deletePeople(personId);
    } catch (e: any) {
      logger?.error(`[person-properties/verify-link] cleanup: ${e?.message || e}`);
    }
  }

  const ok = checks.every((c) => c.ok);
  res.status(ok ? 200 : 500).json({ ok, backend, checks });
};
