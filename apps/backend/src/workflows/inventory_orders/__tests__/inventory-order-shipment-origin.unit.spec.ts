import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const createShipment = jest.fn()
jest.mock("../../../modules/shipping-providers/resolver", () => ({
  resolveShippingProvider: jest.fn(async () => ({ createShipment })),
}))
jest.mock("../../../modules/shipping-providers/seller-tax-id", () => ({
  resolvePlatformTaxIdForCountry: jest.fn(async () => undefined),
}))

import { createInventoryOrderShipment } from "../create-inventory-order-shipment"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"

// The real HR Handloom → Dharamshala order shape (inv_order_01M4TQY1…): the
// supplier's location is the from_location, our warehouse the to_location.
const FROM = {
  id: "sloc_from",
  name: "Haresh Hemraj Manodhiya",
  metadata: { shiprocket_pickup_location: "warehouse-AATFMF00" },
  address: {
    address_1: "Vankar society Near Bhujodi Gram panchayat",
    address_2: "House no 1",
    city: "Bhuj",
    province: "Gujrat",
    postal_code: "370020",
    country_code: "in",
    phone: "9586757384",
  },
}
const TO = {
  id: "sloc_to",
  name: "Dharamshala",
  metadata: {},
  address: {
    address_1: "Ram Nagar Road, Ward 11",
    city: "Dharamshala",
    province: "Himachal Pradesh",
    postal_code: "176215",
    country_code: "in",
    phone: "7580067026",
  },
}

const STOP = new Error("stop after createShipment")

function container() {
  const graph = jest.fn(async ({ entity }: any) => {
    if (entity === "inventory_orders") return { data: [] }
    return {
      data: [
        { from_location: true, to_location: false, stock_location: FROM },
        { from_location: false, to_location: true, stock_location: TO },
      ],
    }
  })
  const services: Record<string, any> = {
    [ORDER_INVENTORY_MODULE]: {
      retrieveInventoryOrder: async () => ({
        id: "inv_order_1",
        total_price: 70000,
        metadata: {},
        shipping_address: null,
        orderlines: [{ id: "line_1", quantity: 10, price: 380 }],
      }),
    },
    [ContainerRegistrationKeys.QUERY]: { graph },
    [ContainerRegistrationKeys.LOGGER]: { warn: jest.fn(), info: jest.fn() },
  }
  return { resolve: (k: string) => services[k] } as any
}

describe("inventory order shipment ship-from address", () => {
  beforeEach(() => {
    createShipment.mockReset().mockRejectedValue(STOP)
  })

  it("sends the from_location's address as the carrier origin (DTDC refused an empty one)", async () => {
    await expect(
      createInventoryOrderShipment(container(), {
        orderId: "inv_order_1",
        carrier: "dtdc",
        weightGrams: 26000,
      } as any)
    ).rejects.toBe(STOP)

    const sent = createShipment.mock.calls[0][0]
    expect(sent.from).toEqual(
      expect.objectContaining({
        address_1: "Vankar society Near Bhujodi Gram panchayat",
        pincode: "370020",
        city: "Bhuj",
        state: "Gujrat",
        phone: "9586757384",
      })
    )
    // The pickup handle Shiprocket books against is unchanged.
    expect(sent.pickup_location_name).toBe("warehouse-AATFMF00")
  })
})
