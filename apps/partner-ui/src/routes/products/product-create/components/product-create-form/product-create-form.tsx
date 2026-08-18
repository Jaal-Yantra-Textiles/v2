import { HttpTypes } from "@medusajs/types"
import { Button, Heading, ProgressStatus, ProgressTabs, Text, toast } from "@medusajs/ui"
import { useEffect, useMemo, useState } from "react"
import { useWatch } from "react-hook-form"
import { useTranslation } from "react-i18next"
import {
  RouteFocusModal,
  useRouteModal,
} from "../../../../../components/modals"
import { KeyboundForm } from "../../../../../components/utilities/keybound-form"
import { useExtendableForm } from "../../../../../dashboard-app/forms/hooks"
import {
  useCreateProduct,
  useUpsertProductSpecFor,
  useWeaveCatalog,
  type ProductSpecPayload,
} from "../../../../../hooks/api/products"
import { ProductSpecForm } from "../../../../../components/forms/product-spec-form"
import { usePartnerUpload } from "../../../../../hooks/api/uploads"
import { extractErrorMessage } from "../../../../../lib/extract-error-message"
import { useExtension } from "../../../../../providers/extension-provider"
import {
  PRODUCT_CREATE_FORM_DEFAULTS,
  ProductCreateSchema,
} from "../../constants"
import { normalizeProductFormValues } from "../../utils"
import { ProductCreateDetailsForm } from "../product-create-details-form"
import { ProductCreateInventoryKitForm } from "../product-create-inventory-kit-form"
import { ProductCreateOrganizeForm } from "../product-create-organize-form"
import { ProductCreateVariantsForm } from "../product-create-variants-form"
import { useDocumentDirection } from "../../../../../hooks/use-document-direction"

enum Tab {
  DETAILS = "details",
  ORGANIZE = "organize",
  VARIANTS = "variants",
  INVENTORY = "inventory",
  SPEC = "spec",
}

type TabState = Record<Tab, ProgressStatus>

const SAVE_DRAFT_BUTTON = "save-draft-button"

const EMPTY_SPEC: ProductSpecPayload = {
  weave_technique: null,
  weave_label: null,
  params: null,
  finishes: [],
  notes: null,
  colors: [],
  fields: [],
}

type ProductCreateFormProps = {
  defaultChannel?: HttpTypes.AdminSalesChannel
  regions: HttpTypes.AdminRegion[]
  store: HttpTypes.AdminStore
  pricePreferences: HttpTypes.AdminPricePreference[]
}

export const ProductCreateForm = ({
  defaultChannel,
  regions,
  store,
  pricePreferences,
}: ProductCreateFormProps) => {
  const [tab, setTab] = useState<Tab>(Tab.DETAILS)
  const [tabState, setTabState] = useState<TabState>({
    [Tab.DETAILS]: "in-progress",
    [Tab.ORGANIZE]: "not-started",
    [Tab.VARIANTS]: "not-started",
    [Tab.INVENTORY]: "not-started",
    [Tab.SPEC]: "not-started",
  })

  const { t } = useTranslation()
  const { handleSuccess } = useRouteModal()
  const { getFormConfigs } = useExtension()
  const configs = getFormConfigs("product", "create")
  const direction = useDocumentDirection()
  const form = useExtendableForm({
    defaultValues: {
      ...PRODUCT_CREATE_FORM_DEFAULTS,
      sales_channels: defaultChannel
        ? [{ id: defaultChannel.id, name: defaultChannel.name }]
        : [],
    },
    schema: ProductCreateSchema,
    configs,
  })

  const { mutateAsync, isPending } = useCreateProduct()
  const { mutateAsync: uploadFiles } = usePartnerUpload()

  // #1342: the production spec is authored here but SAVED AFTER the product
  // exists — it lives on a linked module keyed by product id, which the wizard
  // does not have until the create call returns. Held outside the form schema
  // because it is not part of the product payload at all.
  const { mutateAsync: saveSpec } = useUpsertProductSpecFor()
  const { families, techniques } = useWeaveCatalog()
  const [spec, setSpec] = useState<ProductSpecPayload>(EMPTY_SPEC)
  const specHasContent =
    !!spec.weave_technique ||
    !!spec.weave_label?.trim() ||
    !!spec.notes?.trim() ||
    !!spec.finishes?.length ||
    !!spec.colors?.some((c) => c.name.trim()) ||
    !!spec.fields?.some((f) => (f.label ?? f.key).trim())

  const regionsCurrencyMap = useMemo(() => {
    if (!regions?.length) {
      return {}
    }

    return regions.reduce(
      (acc, reg) => {
        acc[reg.id] = reg.currency_code
        return acc
      },
      {} as Record<string, string>
    )
  }, [regions])

  /**
   * TODO: Important to revisit this - use variants watch so high in the tree can cause needless rerenders of the entire page
   * which is suboptimal when rerenders are caused by bulk editor changes
   */

  const watchedVariants = useWatch({
    control: form.control,
    name: "variants",
  })

  const showInventoryTab = useMemo(
    () => watchedVariants.some((v) => v.manage_inventory && v.inventory_kit),
    [watchedVariants]
  )

  const handleSubmit = form.handleSubmit(async (values, e) => {
    let isDraftSubmission = false
    if (e?.nativeEvent instanceof SubmitEvent) {
      const submitter = e?.nativeEvent?.submitter as HTMLButtonElement
      isDraftSubmission = submitter.dataset.name === SAVE_DRAFT_BUTTON
    }

    const media = values.media || []
    const payload = { ...values, media: undefined }

    let uploadedMedia: (HttpTypes.AdminFile & { isThumbnail: boolean })[] = []
    if (media.length) {
      try {
        const thumbnailReq = media.find((m) => m.isThumbnail)
        const otherMediaReq = media.filter((m) => !m.isThumbnail)

        const fileReqs = []
        if (thumbnailReq) {
          fileReqs.push(
            uploadFiles([thumbnailReq.file]).then((r) =>
              r.files.map((f) => ({ ...f, isThumbnail: true }))
            )
          )
        }
        if (otherMediaReq?.length) {
          fileReqs.push(
            uploadFiles(otherMediaReq.map((m) => m.file)).then((r) =>
              r.files.map((f) => ({ ...f, isThumbnail: false }))
            )
          )
        }

        uploadedMedia = (await Promise.all(fileReqs)).flat()
      } catch (error) {
        toast.error(extractErrorMessage(error, t("products.media.failedToUpload")))
        return // Stop — don't create the product without images
      }
    }

    await mutateAsync(
      normalizeProductFormValues({
        ...payload,
        media: uploadedMedia,
        status: (isDraftSubmission ? "draft" : "published") as any,
        regionsCurrencyMap,
      }),
      {
        onSuccess: async (data) => {
          toast.success(
            t("products.create.successToast", {
              title: data.product.title,
            })
          )

          // The product is already created at this point, so a failing spec
          // save must not read as a failed create. Report it and continue to
          // the product, where the spec panel can be filled in again — losing
          // the typed spec is bad, but stranding the partner on a wizard whose
          // product HAS been created would be worse.
          if (specHasContent) {
            try {
              await saveSpec({
                product_id: data.product.id,
                payload: {
                  ...spec,
                  colors: (spec.colors ?? []).filter((c) => c.name.trim()),
                  fields: (spec.fields ?? []).filter((f) =>
                    (f.label ?? f.key).trim()
                  ),
                },
              })
            } catch (error) {
              toast.error(
                extractErrorMessage(
                  error,
                  "The product was created, but its spec could not be saved. Add it from the product page."
                )
              )
            }
          }

          handleSuccess(`../${data.product.id}`)
        },
        onError: (error) => {
          toast.error(extractErrorMessage(error))
        },
      }
    )
  })

  const onNext = async (currentTab: Tab) => {
    const valid = await form.trigger()

    if (!valid) {
      return
    }

    if (currentTab === Tab.DETAILS) {
      setTab(Tab.ORGANIZE)
    }

    if (currentTab === Tab.ORGANIZE) {
      setTab(Tab.VARIANTS)
    }

    if (currentTab === Tab.VARIANTS) {
      setTab(showInventoryTab ? Tab.INVENTORY : Tab.SPEC)
    }

    if (currentTab === Tab.INVENTORY) {
      setTab(Tab.SPEC)
    }
  }

  useEffect(() => {
    const currentState = { ...tabState }
    if (tab === Tab.DETAILS) {
      currentState[Tab.DETAILS] = "in-progress"
    }
    if (tab === Tab.ORGANIZE) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "in-progress"
    }
    if (tab === Tab.VARIANTS) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "completed"
      currentState[Tab.VARIANTS] = "in-progress"
    }
    if (tab === Tab.INVENTORY) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "completed"
      currentState[Tab.VARIANTS] = "completed"
      currentState[Tab.INVENTORY] = "in-progress"
    }
    if (tab === Tab.SPEC) {
      currentState[Tab.DETAILS] = "completed"
      currentState[Tab.ORGANIZE] = "completed"
      currentState[Tab.VARIANTS] = "completed"
      if (showInventoryTab) {
        currentState[Tab.INVENTORY] = "completed"
      }
      currentState[Tab.SPEC] = "in-progress"
    }

    setTabState({ ...currentState })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- we only want this effect to run when the tab changes
  }, [tab])

  return (
    <RouteFocusModal.Form form={form}>
      <KeyboundForm
        onKeyDown={(e) => {
          // We want to continue to the next tab on enter instead of saving as draft immediately
          if (e.key === "Enter") {
            if (
              e.target instanceof HTMLTextAreaElement &&
              !(e.metaKey || e.ctrlKey)
            ) {
              return
            }

            e.preventDefault()

            if (e.metaKey || e.ctrlKey) {
              // ⌘/Ctrl+Enter advances until the LAST tab, where it submits.
              // Spec is now that tab (#1342) — keyed off VARIANTS it would have
              // published from the middle of the wizard.
              if (tab !== Tab.SPEC) {
                e.preventDefault()
                e.stopPropagation()
                onNext(tab)

                return
              }

              handleSubmit()
            }
          }
        }}
        onSubmit={handleSubmit}
        className="flex h-full flex-col"
      >
        <ProgressTabs
          dir={direction}
          value={tab}
          onValueChange={async (tab) => {
            const valid = await form.trigger()

            if (!valid) {
              return
            }

            setTab(tab as Tab)
          }}
          className="flex h-full flex-col overflow-hidden"
        >
          <RouteFocusModal.Header>
            <div className="-my-2 w-full border-l">
              <ProgressTabs.List className="justify-start-start flex w-full items-center">
                <ProgressTabs.Trigger
                  status={tabState[Tab.DETAILS]}
                  value={Tab.DETAILS}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.details")}
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.ORGANIZE]}
                  value={Tab.ORGANIZE}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.organize")}
                </ProgressTabs.Trigger>
                <ProgressTabs.Trigger
                  status={tabState[Tab.VARIANTS]}
                  value={Tab.VARIANTS}
                  className="max-w-[200px] truncate"
                >
                  {t("products.create.tabs.variants")}
                </ProgressTabs.Trigger>
                {showInventoryTab && (
                  <ProgressTabs.Trigger
                    status={tabState[Tab.INVENTORY]}
                    value={Tab.INVENTORY}
                    className="max-w-[200px] truncate"
                  >
                    {t("products.create.tabs.inventory")}
                  </ProgressTabs.Trigger>
                )}
                <ProgressTabs.Trigger
                  status={tabState[Tab.SPEC]}
                  value={Tab.SPEC}
                  className="max-w-[200px] truncate"
                >
                  Spec
                </ProgressTabs.Trigger>
              </ProgressTabs.List>
            </div>
          </RouteFocusModal.Header>
          <RouteFocusModal.Body className="size-full overflow-hidden">
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.DETAILS}
            >
              <ProductCreateDetailsForm form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.ORGANIZE}
            >
              <ProductCreateOrganizeForm form={form} />
            </ProgressTabs.Content>
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.VARIANTS}
            >
              <ProductCreateVariantsForm
                form={form}
                store={store}
                regions={regions}
                pricePreferences={pricePreferences}
              />
            </ProgressTabs.Content>
            {showInventoryTab && (
              <ProgressTabs.Content
                className="size-full overflow-y-auto"
                value={Tab.INVENTORY}
              >
                <ProductCreateInventoryKitForm form={form} />
              </ProgressTabs.Content>
            )}
            <ProgressTabs.Content
              className="size-full overflow-y-auto"
              value={Tab.SPEC}
            >
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-y-6 px-6 py-8">
                <div>
                  <Heading level="h1">Production spec</Heading>
                  <Text size="small" className="text-ui-fg-subtle">
                    Optional. The weave, colours and specs you'd make this to —
                    worth writing down before you take a custom order. You can
                    add or change all of it later.
                  </Text>
                </div>
                <ProductSpecForm
                  value={spec}
                  onChange={setSpec}
                  techniques={techniques}
                  families={families}
                  /* A product that does not exist yet cannot be accepting
                     orders — that switch belongs on the product page. */
                  showCustomOrderSection={false}
                />
              </div>
            </ProgressTabs.Content>
          </RouteFocusModal.Body>
        </ProgressTabs>
        <RouteFocusModal.Footer>
          <div className="flex items-center justify-end gap-x-2">
            <RouteFocusModal.Close asChild>
              <Button variant="secondary" size="small">
                {t("actions.cancel")}
              </Button>
            </RouteFocusModal.Close>
            <Button
              data-name={SAVE_DRAFT_BUTTON}
              size="small"
              type="submit"
              isLoading={isPending}
              className="whitespace-nowrap"
            >
              {t("actions.saveAsDraft")}
            </Button>
            <PrimaryButton tab={tab} next={onNext} isLoading={isPending} />
          </div>
        </RouteFocusModal.Footer>
      </KeyboundForm>
    </RouteFocusModal.Form>
  )
}

type PrimaryButtonProps = {
  tab: Tab
  next: (tab: Tab) => void
  isLoading?: boolean
}

const PrimaryButton = ({ tab, next, isLoading }: PrimaryButtonProps) => {
  const { t } = useTranslation()

  if (tab === Tab.SPEC) {
    return (
      <Button
        data-name="publish-button"
        key="submit-button"
        type="submit"
        variant="primary"
        size="small"
        isLoading={isLoading}
      >
        {t("actions.publish")}
      </Button>
    )
  }

  return (
    <Button
      key="next-button"
      type="button"
      variant="primary"
      size="small"
      onClick={() => next(tab)}
    >
      {t("actions.continue")}
    </Button>
  )
}
