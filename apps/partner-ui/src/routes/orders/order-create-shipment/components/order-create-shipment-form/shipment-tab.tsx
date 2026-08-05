import { Button, clx, Heading, Input, Switch, Text } from "@medusajs/ui"
import { UseFieldArrayReturn, UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { z as zod } from "@medusajs/framework/zod"

import { Form } from "../../../../../components/common/form"
import { CreateShipmentSchema } from "./constants"

/**
 * Step 2 of "Mark as shipped" — confirm the shipment. This is the original
 * contents of the modal (tracking rows + notification switch); submitting it is
 * the ONLY thing that sets `shipped_at`.
 */

type ShipmentTabProps = {
  form: UseFormReturn<zod.infer<typeof CreateShipmentSchema>>
  labels: UseFieldArrayReturn<
    zod.infer<typeof CreateShipmentSchema>,
    "labels"
  >["fields"]
  append: UseFieldArrayReturn<zod.infer<typeof CreateShipmentSchema>, "labels">["append"]
}

export const ShipmentTab = ({ form, labels, append }: ShipmentTabProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex size-full flex-col items-center overflow-auto p-16">
      <div className="flex w-full max-w-[736px] flex-col justify-center px-2 pb-2">
        <div className="flex flex-col divide-y">
          <div className="flex flex-1 flex-col">
            <Heading className="mb-1">{t("orders.shipment.title")}</Heading>
            <Text size="small" className="text-ui-fg-subtle mb-4">
              Confirm the parcel has been handed over to the carrier. This is
              what marks the fulfillment shipped.
            </Text>

            <div className="flex flex-col max-md:gap-y-2 max-md:divide-y">
              {labels.map((label, index) => (
                <div
                  key={label.id}
                  className={clx("grid grid-cols-1 gap-x-4 md:grid-cols-3", {
                    "max-md:pt-4": index > 0,
                  })}
                >
                  <Form.Field
                    control={form.control}
                    name={`labels.${index}.tracking_number`}
                    render={({ field }) => {
                      return (
                        <Form.Item className="mb-2">
                          <Form.Label className={clx({ "md:hidden": index > 0 })}>
                            {t("orders.shipment.trackingNumber")}
                          </Form.Label>

                          <Form.Control>
                            <Input {...field} placeholder="123-456-789" />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                  <Form.Field
                    control={form.control}
                    name={`labels.${index}.tracking_url`}
                    render={({ field }) => {
                      return (
                        <Form.Item className="mb-2">
                          <Form.Label className={clx({ "md:hidden": index > 0 })}>
                            {t("orders.shipment.trackingUrl")}
                          </Form.Label>
                          <Form.Control>
                            <Input
                              {...field}
                              placeholder="https://example.com/tracking/123"
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                  <Form.Field
                    control={form.control}
                    name={`labels.${index}.label_url`}
                    render={({ field }) => {
                      return (
                        <Form.Item className="mb-2">
                          <Form.Label className={clx({ "md:hidden": index > 0 })}>
                            {t("orders.shipment.labelUrl")}
                          </Form.Label>
                          <Form.Control>
                            <Input
                              {...field}
                              placeholder="https://example.com/label/123"
                            />
                          </Form.Control>
                          <Form.ErrorMessage />
                        </Form.Item>
                      )
                    }}
                  />
                </div>
              ))}
            </div>

            <Button
              type="button"
              onClick={() =>
                append({
                  tracking_number: "",
                  label_url: "",
                  tracking_url: "",
                })
              }
              className="mt-2 self-end"
              variant="secondary"
            >
              {t("orders.shipment.addTracking")}
            </Button>
          </div>

          <div className="mt-8 pt-8 ">
            <Form.Field
              control={form.control}
              name="send_notification"
              render={({ field: { onChange, value, ...field } }) => {
                return (
                  <Form.Item>
                    <div className="flex items-center justify-between">
                      <Form.Label>
                        {t("orders.shipment.sendNotification")}
                      </Form.Label>
                      <Form.Control>
                        <Switch
                          dir="ltr"
                          className="rtl:rotate-180"
                          checked={!!value}
                          onCheckedChange={onChange}
                          {...field}
                        />
                      </Form.Control>
                    </div>
                    <Form.Hint className="!mt-1">
                      {t("orders.shipment.sendNotificationHint")}
                    </Form.Hint>
                    <Form.ErrorMessage />
                  </Form.Item>
                )
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
