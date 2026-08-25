import { readdirSync, existsSync } from "fs"
import { join } from "path"

/**
 * Medusa keeps EVERY module's migrations in a single `mikro_orm_migrations`
 * table, and the row is keyed on the class name alone — the owning module is
 * not part of the key. So two modules that both ship, say,
 * `Migration20260825090000` are indistinguishable to the migrator: whichever
 * runs first inserts the name, and the second module then sees its own
 * migration listed as already-executed and skips it.
 *
 * Nothing about that failure is loud. The migrate step logs "Database is
 * up-to-date for module" and exits 0; the column simply never appears, on CI,
 * on every developer's database, and on production alike. It surfaces much
 * later as a route 400ing on a column that does not exist.
 *
 * It happened once (#1529's `depends_on_inventory_order_ids` vs #1526's
 * `partner_quote.adjusted_at`, both dated 20260825090000) and cost a red main
 * for a day. The timestamps are hand-written, so collisions are likely, not
 * exotic — this is a filename check because that is all it takes to prevent it.
 */
describe("module migrations", () => {
  it("gives every migration a name unique across ALL modules", () => {
    const modulesDir = join(__dirname, "..")

    const byName = new Map<string, string[]>()
    for (const moduleName of readdirSync(modulesDir)) {
      const migrationsDir = join(modulesDir, moduleName, "migrations")
      if (!existsSync(migrationsDir)) {
        continue
      }
      for (const file of readdirSync(migrationsDir)) {
        if (!/^Migration\d+\.ts$/.test(file)) {
          continue
        }
        const name = file.replace(/\.ts$/, "")
        byName.set(name, [...(byName.get(name) ?? []), moduleName])
      }
    }

    const collisions = [...byName.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([name, owners]) => `${name} is shared by ${owners.join(", ")}`)

    expect(collisions).toEqual([])
  })
})
