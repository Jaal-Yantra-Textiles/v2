import type { ComponentType } from "react"
import { Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import ColorPaletteEditor from "../edits/edit-color-palette"
import { AddDesignComponentForm } from "../creates/create-design-component"
import { CreateDesignTaskComponent } from "../creates/create-design-task"
import { DesignInventoryTable } from "../designs/design-inventory-table"
import { EditDesignForm } from "../edits/edit-design"
import { LinkDesignPartnerForm } from "../forms/link-design-partner/link-design-partner-form"
import { useDesign, type AdminDesign } from "../../hooks/api/designs"
import type { FormRegistry } from "./node-forms"

/**
 * Node KEY → the real form for it, per spine (#1847 step 3).
 *
 * These are the SAME components their own routes render. They became usable
 * here by taking their chrome from context instead of importing
 * `RouteFocusModal` directly, so one form serves both surfaces and there is no
 * second copy to drift.
 *
 * 🔴 A form only belongs here once it is chrome-agnostic. Added before that it
 * renders focus-modal markup inside a stacked modal and NAVIGATES on success,
 * closing the graph that opened it.
 *
 * 🔴 The registry is keyed by SPINE, then by NODE KEY.
 *
 * By spine, because `partners` on a design graph means "link a partner to this
 * design" while on a partner graph it would be the partner itself — a flat map
 * would offer the design's form on the wrong entity.
 *
 * By key rather than type, because the design spine emits TWO nodes of type
 * `design`: itself and "Revised from", which is a different record. See
 * `node-forms.ts` for what that collision would have cost.
 */

/**
 * The design id, from the workspace's own route (`/designs/:id/graph`).
 *
 * These adapters exist so the forms keep taking an explicit `designId` prop —
 * a form that reaches for `useParams()` itself works only where the URL happens
 * to be shaped right, which is precisely the coupling this step removes.
 */
const useDesignId = () => useParams().id!

const DesignPartnerCreateForm = () => {
  const designId = useDesignId()
  return <LinkDesignPartnerForm designId={designId} />
}

const DesignComponentCreateForm = () => {
  const designId = useDesignId()
  return <AddDesignComponentForm designId={designId} />
}

const DesignInventoryCreateForm = () => {
  const designId = useDesignId()
  return <DesignInventoryTable designId={designId} />
}

/**
 * Forms that edit a facet of the design need the whole record, and the graph
 * carries only a node — so it is fetched here.
 *
 * Rendering nothing while it loads would read as a dead button, and rendering
 * nothing on failure is worse: an empty panel is indistinguishable from a form
 * with no fields. Both states say what is happening.
 */
const withDesign = (
  Form: ComponentType<{ design: AdminDesign }>
): ComponentType => () => {
  const id = useDesignId()
  const { design, isLoading, isError, error } = useDesign(id)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-y-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (isError || !design) {
    return (
      <div className="flex flex-col gap-y-1 p-6">
        <Text size="small">This design could not be loaded.</Text>
        <Text size="xsmall" className="text-ui-fg-muted break-words">
          {(error as Error | undefined)?.message ?? "The request returned no design."}
        </Text>
      </div>
    )
  }

  return <Form design={design} />
}

/**
 * An edit form plus the words on the button that opens it.
 *
 * Edit forms in this admin are body-and-footer only — their own route supplies
 * the heading from the page around them (`@edit/page.tsx` does exactly that) —
 * so the modal that opens one here has to supply it too.
 *
 * 🔴 The label is registered, not derived from the node. A neighbour node's
 * label is a TYPE ("Inventory"), but the spine node's label is the RECORD's
 * name — so "Edit {label}" rendered as "Edit partner billable fixture (e2e
 * 1788009430083)" the first time it was put on screen. The button says what
 * KIND of thing it edits; the drawer above it already says which one.
 */
type EditForm = {
  Form: ComponentType
  /** The words on the button that opens it. */
  label: string
  /** The heading the modal puts above it. */
  title: string
}

/**
 * The "and another" action on a node that already has members.
 *
 * Distinct from a create FORM, which opens inside the graph, and from an
 * absent node's action, which names a step that does not exist yet. This is
 * the third case the workspace had no answer for: the neighbour is present and
 * the reader wants one more of it.
 *
 * 🔴 It exists because of one node. `runs` is the only card the design page
 * could not give up — the graph could send an UNSTARTED design to production,
 * but had nowhere to start a second run beside the ones already there, so the
 * production-runs summary stayed purely to hold that button.
 */
type AddAnother = {
  label: string
  href: (id: string) => string
}

type SpineForms = {
  create: Record<string, ComponentType>
  edit: Record<string, EditForm>
  addAnother: Record<string, AddAnother>
}

const DESIGN_FORMS: SpineForms = {
  create: {
    tasks: CreateDesignTaskComponent,
    partners: DesignPartnerCreateForm,
    inventory: DesignInventoryCreateForm,
    components: DesignComponentCreateForm,
  },
  addAnother: {
    /*
     * A run's own flow, not a form in the drawer: starting a run picks a
     * partner, a quantity and an execution mode across several screens, and
     * half of that is a decision rather than a field. The graph's job here is
     * to say the step exists and get you to it — the same judgement that keeps
     * `runs`, `product` and `specifications` out of the form registry below.
     */
    runs: {
      label: "Start another run",
      href: (id: string) => `/designs/${id}/production-run`,
    },
  },
  edit: {
    design: {
      Form: withDesign(EditDesignForm),
      label: "Edit design",
      title: "Edit design",
    },
    palette: {
      Form: withDesign(ColorPaletteEditor),
      label: "Edit colours & sizes",
      title: "Colour palette",
    },
  },
  /*
   * Deliberately NOT registered:
   *
   * - `media`. A design holds ONE folder, and `link-media-folder` repoints it.
   *   Wiring the folder form here would turn "add to media" into a silent
   *   replacement of the folder the design already has — and the media node is
   *   only ever emitted when it is PRESENT, so that is the only case it could
   *   hit. `CreateMediaFolderComponent` is chrome-agnostic and ready for the
   *   media spine; it just has no honest home on this one.
   * - `runs`, `product`, `specifications`. Their absent nodes name a step that
   *   lives in a multi-screen flow, so they keep the action card that links out
   *   to it.
   * - `revision`. It is a DIFFERENT design; opening this design's edit form
   *   over it would edit the wrong record.
   */
}

const SPINE_FORMS: Record<string, SpineForms> = {
  design: DESIGN_FORMS,
}

const EMPTY: SpineForms = { create: {}, edit: {}, addAnother: {} }

const formsFor = (spine: string): SpineForms => SPINE_FORMS[spine] ?? EMPTY

/** The type sets `nodeAffordance` asks about. */
export const registryFor = (spine: string): FormRegistry => {
  const forms = formsFor(spine)
  return {
    create: new Set(Object.keys(forms.create)),
    edit: new Set(Object.keys(forms.edit)),
  }
}

export const createFormFor = (spine: string, key: string): ComponentType | undefined =>
  formsFor(spine).create[key]

export const editFormFor = (spine: string, key: string): EditForm | undefined =>
  formsFor(spine).edit[key]

export const addAnotherFor = (
  spine: string,
  key: string
): AddAnother | undefined => formsFor(spine).addAnother[key]
