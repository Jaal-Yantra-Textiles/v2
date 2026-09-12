/**
 * Walk every `model.define()` in the repo and read its real field list.
 *
 * Deliberately filesystem-driven rather than a hand-maintained import list: a
 * new module whose models nobody registered is exactly the case a hand-list
 * misses, and it is the case that matters.
 */
import fs from "fs"
import path from "path"

import { modelFields, modelName, type DmlModelLike } from "./index"

/** `apps/backend/src` — resolved from this file, so cwd cannot change it. */
const SRC_ROOT = path.resolve(__dirname, "..", "..")

/** Every `src/modules/<mod>/models/**\/*.ts` path, sorted for stable output. */
export const modelFilePaths = (): string[] => {
  const modulesDir = path.join(SRC_ROOT, "modules")
  const out: string[] = []

  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (
        e.isFile() &&
        e.name.endsWith(".ts") &&
        !e.name.endsWith(".d.ts") &&
        !full.includes("__tests__")
      ) {
        out.push(full)
      }
    }
  }

  for (const mod of fs.existsSync(modulesDir)
    ? fs.readdirSync(modulesDir, { withFileTypes: true })
    : []) {
    if (!mod.isDirectory()) continue
    walk(path.join(modulesDir, mod.name, "models"))
  }
  return out.sort()
}

export type ModelContract = {
  /** The table name the model declares. */
  model: string
  /** Repo-relative path, so a failure says where to look. */
  file: string
  fields: string[]
}

/**
 * Load every model and read its schema.
 *
 * A file that exports no DML model is skipped, not failed — `models/` holds the
 * odd shared type or index file. A file that THROWS on import is reported, and
 * the guard treats that as a failure: a model nobody can import is a model
 * nothing can check.
 */
export const collectModelContracts = (): {
  contracts: ModelContract[]
  unreadable: Array<{ file: string; error: string }>
} => {
  const contracts: ModelContract[] = []
  const unreadable: Array<{ file: string; error: string }> = []

  for (const file of modelFilePaths()) {
    const rel = path.relative(SRC_ROOT, file)
    let mod: Record<string, unknown>
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(file) as Record<string, unknown>
    } catch (e: any) {
      unreadable.push({ file: rel, error: e?.message ?? String(e) })
      continue
    }

    // A models file may default-export the model, or export several by name.
    for (const candidate of [mod.default, ...Object.values(mod)]) {
      const m = candidate as DmlModelLike | undefined
      const name = modelName(m)
      if (!name || !m?.schema) continue
      if (contracts.some((c) => c.model === name && c.file === rel)) continue
      contracts.push({ model: name, file: rel, fields: modelFields(m) })
    }
  }

  contracts.sort((a, b) => a.model.localeCompare(b.model) || a.file.localeCompare(b.file))
  return { contracts, unreadable }
}
