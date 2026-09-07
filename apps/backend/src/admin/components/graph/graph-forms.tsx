import type { ComponentType } from "react"
import { Skeleton, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

import ColorPaletteEditor from "../edits/edit-color-palette"
import { AddPartnerAdminForm } from "../creates/create-partner-admin"
import { AddPartnerPaymentMethodForm } from "../creates/create-partner-payment-method"
import { LinkPartnerPeopleForm } from "../forms/link-partner-people/link-partner-people-form"
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

/**
 * A create form plus the words that name the thing it creates.
 *
 * 🔴 The label is REGISTERED, not derived from a node — because the node may
 * not exist. A neighbour with no rows yet is drawn nowhere on the canvas, so
 * the only way to offer "add one" is to know its name without one. That is the
 * whole reason this stopped being a bare `ComponentType`.
 */
type CreateForm = {
  Form: ComponentType
  /** Singular, lower case: "task", "partner", "inventory item". */
  label: string
}

type SpineForms = {
  create: Record<string, CreateForm>
  edit: Record<string, EditForm>
  addAnother: Record<string, AddAnother>
}

const DESIGN_FORMS: SpineForms = {
  create: {
    tasks: { Form: CreateDesignTaskComponent, label: "task" },
    partners: { Form: DesignPartnerCreateForm, label: "partner" },
    inventory: { Form: DesignInventoryCreateForm, label: "inventory item" },
    components: { Form: DesignComponentCreateForm, label: "bundled design" },
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

/**
 * The partner id, from the workspace's own route (`/partners/:id/graph`).
 *
 * The same adapter shape as the design's, and for the same reason: the forms
 * keep taking an explicit `partnerId`, so the section on the partner page can
 * go on rendering them without a URL shaped like the graph's.
 */
const usePartnerId = () => useParams().id!

const PartnerAdminCreateForm = () => {
  const partnerId = usePartnerId()
  return <AddPartnerAdminForm partnerId={partnerId} />
}

const PartnerPaymentMethodCreateForm = () => {
  const partnerId = usePartnerId()
  return <AddPartnerPaymentMethodForm partnerId={partnerId} />
}

const PartnerPeopleCreateForm = () => {
  const partnerId = usePartnerId()
  return <LinkPartnerPeopleForm partnerId={partnerId} />
}

/**
 * The PARTNER spine's forms (#1856).
 *
 * 🔴 The first two exist because this spine's two absence rules were unfixable
 * from the graph that stated them. "No admin — nobody can sign in" and
 * "delivered work, no account to pay it into" are the only two absences on the
 * platform that no list can show, and until now the absent node's sole
 * affordance was an action card pointing at `/partners/:id` — the page the
 * graph is embedded in. From the full-page workspace that button tears the
 * graph down to arrive where you already were.
 *
 * That is also why ZERO partner cards came off in #1856's first pass: the
 * three questions ask what a card DOES that the graph cannot, and until this
 * registry entry existed the answer for every one of them was "create".
 */
const PARTNER_FORMS: SpineForms = {
  create: {
    admins: { Form: PartnerAdminCreateForm, label: "admin" },
    payment_methods: {
      Form: PartnerPaymentMethodCreateForm,
      label: "payment method",
    },
    people: { Form: PartnerPeopleCreateForm, label: "person" },
  },
  addAnother: {},
  edit: {},
  /*
   * Deliberately NOT registered:
   *
   * - `partner` itself. The edit form is a multi-tab page (`partners/[id]`
   *   general section) rather than a body-and-footer form, so it is not
   *   chrome-agnostic and would render its own shell inside the stacked one.
   * - `runs`, `designs`, `orders`, `products`, `inventory_orders`,
   *   `submissions`. None of these is created FROM a partner: a run belongs to
   *   the design that ordered it, an order to a customer, a submission to the
   *   work it bills. Registering a form here would put the partner at the
   *   start of a flow it is only ever the object of.
   * - `stores`, `subscriptions`. Both are provisioning flows with steps of
   *   their own; the absent `stores` node keeps its action card.
   * - `whatsapp`, `domain`. Both are `derived` — the value is already on the
   *   record and unverified. What is missing is a verification, not a
   *   neighbour, and `nodeAffordance` correctly offers neither create nor the
   *   action card on a derived node.
   */
}

const SPINE_FORMS: Record<string, SpineForms> = {
  design: DESIGN_FORMS,
  partner: PARTNER_FORMS,
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

export const createFormFor = (
  spine: string,
  key: string
): ComponentType | undefined => formsFor(spine).create[key]?.Form

/**
 * Everything this spine can create, whether or not a node for it is drawn.
 *
 * 🔴 This exists because the canvas can only act on nodes it DRAWS, and a
 * neighbour with nothing in it is drawn nowhere: no components on a design
 * means no `components` node, which would leave no route at all to adding the
 * first one once the summary card comes off. That is exactly how step 3
 * stranded `/designs/:id/tasks` — a card removed while the only remaining
 * route to it was removed alongside.
 */
/**
 * "a task", "an inventory item".
 *
 * Trivial, and it earns its place: the labels are registered per spine and
 * some of them begin with a vowel, so a hardcoded "a" reads as a typo on
 * exactly the entries nobody remembers to check.
 */
export const withArticle = (label: string): string =>
  `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`

export const creatableFor = (
  spine: string
): { key: string; label: string }[] =>
  Object.entries(formsFor(spine).create).map(([key, { label }]) => ({
    key,
    label,
  }))

/**
 * The registered, SINGULAR name of what a node's create form makes.
 *
 * 🔴 Not `node.label`. A node's label is the aggregate's ("Payment methods",
 * "Tasks"), so the absent node's button rendered "Create the missing payment
 * methodS" over a form that creates exactly one. Only rendering says so — the
 * string is assembled from a label that is correct everywhere else on the
 * card, and no test was ever going to spell it out.
 */
export const createLabelFor = (
  spine: string,
  key: string
): string | undefined => formsFor(spine).create[key]?.label

export const editFormFor = (spine: string, key: string): EditForm | undefined =>
  formsFor(spine).edit[key]

export const addAnotherFor = (
  spine: string,
  key: string
): AddAnother | undefined => formsFor(spine).addAnother[key]
