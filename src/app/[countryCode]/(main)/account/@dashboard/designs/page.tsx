import { Metadata } from "next"
import { notFound } from "next/navigation"
import { listDesigns, Design } from "@lib/data/designs"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

export const metadata: Metadata = {
  title: "My Designs",
  description: "View all your custom designs and their production status.",
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  Conceptual: "bg-gray-100 text-gray-700",
  In_Development: "bg-blue-100 text-blue-700",
  Technical_Review: "bg-yellow-100 text-yellow-700",
  Sample_Production: "bg-orange-100 text-orange-700",
  Revision: "bg-red-100 text-red-700",
  Approved: "bg-green-100 text-green-700",
  Commerce_Ready: "bg-emerald-100 text-emerald-700",
  On_Hold: "bg-gray-200 text-gray-500",
  Rejected: "bg-red-200 text-red-700",
}

const DESIGN_TASKS: Record<string, { label: string; done: boolean }[]> = {
  Conceptual: [
    { label: "Design submitted", done: true },
    { label: "Material selection in progress", done: false },
    { label: "Technical review pending", done: false },
    { label: "Sample production pending", done: false },
  ],
  In_Development: [
    { label: "Design submitted", done: true },
    { label: "Materials confirmed", done: true },
    { label: "Technical review in progress", done: false },
    { label: "Sample production pending", done: false },
  ],
  Technical_Review: [
    { label: "Design submitted", done: true },
    { label: "Materials confirmed", done: true },
    { label: "Technical review underway", done: false },
    { label: "Sample production pending", done: false },
  ],
  Sample_Production: [
    { label: "Design approved for sampling", done: true },
    { label: "Sample production in progress", done: false },
    { label: "Awaiting sample review", done: false },
  ],
  Revision: [
    { label: "Sample reviewed", done: true },
    { label: "Revision needed — please update design", done: false },
  ],
  Approved: [
    { label: "Design approved", done: true },
    { label: "Awaiting full production order", done: false },
  ],
  Commerce_Ready: [
    { label: "Design approved", done: true },
    { label: "Production complete", done: true },
    { label: "Available for ordering", done: true },
  ],
  On_Hold: [
    { label: "Design on hold", done: false },
  ],
  Rejected: [
    { label: "Design rejected — review feedback", done: false },
  ],
}

export default async function DesignsPage() {
  const { designs } = await listDesigns({ limit: 50 }).catch(() => ({ designs: [] as Design[] }))

  if (designs === null) {
    notFound()
  }

  return (
    <div className="w-full" data-testid="designs-page-wrapper">
      <div className="mb-8 flex flex-col gap-y-4">
        <h1 className="text-2xl-semi">My Designs</h1>
        <p className="text-base-regular">
          Track your custom designs and their production progress.
        </p>
      </div>

      {designs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-4">No designs yet.</p>
          <LocalizedClientLink
            href="/store"
            className="underline text-gray-600 hover:text-gray-900"
          >
            Browse products to start designing
          </LocalizedClientLink>
        </div>
      ) : (
        <ul className="flex flex-col gap-y-6">
          {designs.map((design) => {
            const tasks = DESIGN_TASKS[design.status || "Conceptual"] || []
            const statusColor = STATUS_BADGE_COLORS[design.status || "Conceptual"] || "bg-gray-100 text-gray-700"
            const doneTasks = tasks.filter((t) => t.done).length
            const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0

            return (
              <li key={design.id} className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-5 bg-white">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-x-4 mb-4">
                    <div className="flex items-center gap-x-3">
                      {design.thumbnail_url && (
                        <img
                          src={design.thumbnail_url}
                          alt={design.name}
                          className="w-16 h-16 object-cover rounded-lg border border-gray-200 flex-shrink-0"
                        />
                      )}
                      <div>
                        <h3 className="font-semibold text-gray-900">{design.name}</h3>
                        {design.description && (
                          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
                            {design.description}
                          </p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          {design.created_at
                            ? new Date(design.created_at).toLocaleDateString("en-US", {
                                year: "numeric",
                                month: "long",
                                day: "numeric",
                              })
                            : "—"}
                        </p>
                      </div>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${statusColor}`}>
                      {design.status?.replace(/_/g, " ") || "Conceptual"}
                    </span>
                  </div>

                  {/* Edit in Designer link */}
                  {(design.metadata as any)?.base_product_handle && (
                    <div className="mb-4">
                      <LocalizedClientLink
                        href={`/products/${(design.metadata as any).base_product_handle}/design?designId=${design.id}`}
                        className="inline-flex items-center gap-x-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
                      >
                        Edit in Designer
                      </LocalizedClientLink>
                    </div>
                  )}

                  {/* Materials & Partners */}
                  {((design.inventory_items?.length ?? 0) > 0 || (design.partners?.length ?? 0) > 0) && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      {design.inventory_items?.map((item) => (
                        <span key={item.id} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                          {item.title || item.id}
                        </span>
                      ))}
                      {design.partners?.map((partner) => (
                        <span key={partner.id} className="text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full">
                          {partner.name || partner.id}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Progress bar */}
                  {tasks.length > 0 && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progress</span>
                        <span>{doneTasks}/{tasks.length} steps</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-400 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Task checklist */}
                  {tasks.length > 0 && (
                    <ul className="flex flex-col gap-y-1.5">
                      {tasks.map((task, i) => (
                        <li key={i} className="flex items-center gap-x-2 text-sm">
                          <span
                            className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                              task.done
                                ? "bg-green-100 text-green-600"
                                : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {task.done ? "✓" : "○"}
                          </span>
                          <span className={task.done ? "text-gray-400 line-through" : "text-gray-700"}>
                            {task.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
