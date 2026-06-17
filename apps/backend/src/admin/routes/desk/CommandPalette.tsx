import { clx, Input, Text } from "@medusajs/ui"
import { ArrowUpRightOnBox } from "@medusajs/icons"
import {
  ComponentType,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  CORE_ENTITIES,
  ENTITY_REGISTRY,
  type EntityKey,
} from "./EntityPicker"

type IconType = ComponentType<{ className?: string }>

type PaletteItem = {
  id: string
  label: string
  hint: string
  icon: IconType
  external?: boolean
  run: () => void
}

/**
 * Desk command palette. Medusa's core admin owns Cmd-K (global search) and
 * doesn't expose a way to register into it, so we bind our OWN palette to
 * ⌘/Ctrl + Shift + K. It lists Desk entities (open as a tab) and Medusa
 * core entities (open in the full admin). Mounted on the Desk shell —
 * outside the per-tab MemoryRouters — so its hooks resolve normally and the
 * shortcut is only live while the Desk is open.
 */
export const DeskCommandPalette = ({
  onOpenEntity,
  onOpenCore,
}: {
  onOpenEntity: (key: EntityKey) => void
  onOpenCore: (path: string) => void
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === "k" || e.key === "K")
      ) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(0)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const tabs = (
      Object.entries(ENTITY_REGISTRY) as [EntityKey, (typeof ENTITY_REGISTRY)[EntityKey]][]
    ).map(([key, entity]) => ({
      id: `tab:${key}`,
      label: entity.label,
      hint: "Open tab",
      icon: entity.icon,
      run: () => onOpenEntity(key),
    }))
    const core = CORE_ENTITIES.map((c) => ({
      id: `core:${c.path}`,
      label: c.label,
      hint: "Open in admin",
      icon: c.icon,
      external: true,
      run: () => onOpenCore(c.path),
    }))
    return [...tabs, ...core]
  }, [onOpenEntity, onOpenCore])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items
  }, [items, query])

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) {
    return null
  }

  const select = (item: PaletteItem | undefined) => {
    if (!item) return
    item.run()
    setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-ui-bg-overlay pt-[12vh] px-4"
      onMouseDown={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-base shadow-elevation-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ui-border-base p-2">
          <Input
            ref={inputRef}
            placeholder="Search Desk entities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, filtered.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                select(filtered[active])
              }
            }}
          />
        </div>
        <div className="max-h-[320px] overflow-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Text size="small" className="text-ui-fg-muted">
                No matches
              </Text>
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => select(item)}
                  className={clx(
                    "flex w-full items-center gap-x-3 rounded-lg px-3 py-2 text-left outline-none",
                    idx === active && "bg-ui-bg-base-hover"
                  )}
                >
                  <Icon className="text-ui-fg-subtle" />
                  <Text size="small" className="flex-1 text-ui-fg-base">
                    {item.label}
                  </Text>
                  {item.external && (
                    <ArrowUpRightOnBox className="text-ui-fg-muted" />
                  )}
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {item.hint}
                  </Text>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
