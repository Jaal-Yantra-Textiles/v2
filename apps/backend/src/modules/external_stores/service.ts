import { MedusaService } from "@medusajs/framework/utils"
import { StoreProviderRegistry } from "./store-provider-registry"
import { StoreProvider } from "./types"
import EtsyService from "./etsy-service"

/**
 * External Stores Service
 * 
 * Manages external e-commerce store providers (Etsy, Shopify, Amazon, etc.)
 * Similar to SocialProviderService pattern.
 */
class ExternalStoresService extends MedusaService({
  // No models in this module - it's a service-only module like social_provider
}) {
  private registry: StoreProviderRegistry

  constructor(container: any, options?: any) {
    super(...arguments)
    
    this.registry = new StoreProviderRegistry()
    
    // Register providers
    this.registerProvider("etsy", new EtsyService())
    // Future: this.registerProvider("shopify", new ShopifyService())
    // Future: this.registerProvider("amazon", new AmazonService())
  }

  /**
   * Register a store provider.
   */
  registerProvider(name: string, provider: StoreProvider): void {
    this.registry.register(name, provider)
  }

  /**
   * Get a store provider by name.
   * 
   * @param name - Provider name (e.g., "etsy", "shopify")
   * @throws Error if provider not found
   */
  getProvider(name: string): StoreProvider {
    const provider = this.registry.get(name)
    
    if (!provider) {
      throw new Error(`Store provider "${name}" not found. Available providers: ${this.listProviders().join(", ")}`)
    }
    
    return provider
  }

  /**
   * Check if a provider exists.
   */
  hasProvider(name: string): boolean {
    return this.registry.has(name)
  }

  /**
   * List all registered providers.
   */
  listProviders(): string[] {
    return this.registry.list()
  }
}

export default ExternalStoresService
