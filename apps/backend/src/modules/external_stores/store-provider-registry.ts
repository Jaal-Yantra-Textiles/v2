import { StoreProvider } from "./types"

/**
 * Registry for external store providers.
 * Similar to social-provider-registry.ts pattern.
 */
export class StoreProviderRegistry {
  private providers = new Map<string, StoreProvider>()

  register(name: string, provider: StoreProvider): void {
    this.providers.set(name.toLowerCase(), provider)
  }

  get(name: string): StoreProvider | undefined {
    return this.providers.get(name.toLowerCase())
  }

  has(name: string): boolean {
    return this.providers.has(name.toLowerCase())
  }

  list(): string[] {
    return Array.from(this.providers.keys())
  }
}
