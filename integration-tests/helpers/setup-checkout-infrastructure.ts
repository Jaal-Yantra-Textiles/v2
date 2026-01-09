import { Modules } from "@medusajs/utils";
import {
  createShippingOptionsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Sets up the minimum checkout infrastructure required for completing orders:
 * - Stock location
 * - Fulfillment set with service zone
 * - Shipping option with flat rate
 * - Payment provider linked to region
 *
 * This mimics what would be configured in the Medusa Admin dashboard.
 */
export async function setupCheckoutInfrastructure(
  container: any,
  regionId: string
) {
  const fulfillmentService = container.resolve(Modules.FULFILLMENT) as any;
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any;
  const remoteLink = container.resolve("link") as any;

  // Step 1: Create or get a stock location
  let stockLocation;
  const existingLocations = await stockLocationService.listStockLocations({});
  if (existingLocations.length > 0) {
    stockLocation = existingLocations[0];
  } else {
    stockLocation = await stockLocationService.createStockLocations({
      name: "Test Warehouse",
      address: {
        address_1: "123 Test St",
        city: "Test City",
        country_code: "us",
        postal_code: "10001",
      },
    });
  }

  // Step 2: Create a shipping profile if none exists
  let shippingProfile;
  const existingProfiles = await fulfillmentService.listShippingProfiles({});
  if (existingProfiles.length > 0) {
    shippingProfile = existingProfiles[0];
  } else {
    shippingProfile = await fulfillmentService.createShippingProfiles({
      name: "Default Shipping",
      type: "default",
    });
  }

  // Step 3: Create a fulfillment set for the stock location
  let fulfillmentSet;
  const existingFulfillmentSets = await fulfillmentService.listFulfillmentSets({});
  if (existingFulfillmentSets.length > 0) {
    fulfillmentSet = existingFulfillmentSets[0];
  } else {
    // Create fulfillment set directly using the service
    fulfillmentSet = await fulfillmentService.createFulfillmentSets({
      name: "Shipping",
      type: "shipping",
    });
  }

  // Step 4: Create a service zone with geo zone for US
  let serviceZone;
  const existingServiceZones = await fulfillmentService.listServiceZones({});
  const matchingZone = existingServiceZones.find(
    (sz: any) => sz.fulfillment_set_id === fulfillmentSet.id
  );
  if (matchingZone) {
    serviceZone = matchingZone;
  } else {
    // Create service zone directly using the service
    serviceZone = await fulfillmentService.createServiceZones({
      name: "US Shipping Zone",
      fulfillment_set_id: fulfillmentSet.id,
      geo_zones: [
        {
          type: "country",
          country_code: "us",
        },
      ],
    });
  }

  // Step 5: Get the manual fulfillment provider and link to stock location
  const fulfillmentProviders = await fulfillmentService.listFulfillmentProviders({});
  const manualProvider = fulfillmentProviders.find(
    (p: any) => p.id === "manual" || p.id.includes("manual")
  ) || fulfillmentProviders[0];

  if (!manualProvider) {
    console.warn("[Setup] No fulfillment providers found");
    return { stockLocation, shippingProfile, fulfillmentSet, serviceZone };
  }

  // Link fulfillment provider to stock location (required for shipping options)
  try {
    await remoteLink.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: manualProvider.id,
      },
    });
  } catch (e) {
    // Link might already exist
  }

  // Link fulfillment set to stock location
  try {
    await remoteLink.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_set_id: fulfillmentSet.id,
      },
    });
  } catch (e) {
    // Link might already exist
  }

  // Step 6: Create a shipping option with flat rate
  let shippingOption;
  const existingShippingOptions = await fulfillmentService.listShippingOptions({
    service_zone_id: serviceZone.id,
  });
  if (existingShippingOptions.length > 0) {
    shippingOption = existingShippingOptions[0];
  } else {
    const { result: shippingOptions } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Standard Shipping",
          service_zone_id: serviceZone.id,
          shipping_profile_id: shippingProfile.id,
          provider_id: manualProvider.id,
          type: {
            label: "Standard",
            description: "Standard shipping",
            code: "standard",
          },
          price_type: "flat",
          prices: [
            {
              amount: 500, // $5.00 in cents
              currency_code: "usd",
            },
          ],
        },
      ],
    });
    shippingOption = shippingOptions[0];
  }

  // Step 7: Link payment provider to region (pp_system_default)
  try {
    await remoteLink.create({
      [Modules.REGION]: {
        region_id: regionId,
      },
      [Modules.PAYMENT]: {
        payment_provider_id: "pp_system_default",
      },
    });
  } catch (e) {
    // Link might already exist
  }

  return {
    stockLocation,
    shippingProfile,
    fulfillmentSet,
    serviceZone,
    shippingOption,
  };
}
