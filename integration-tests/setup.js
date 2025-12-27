const { MetadataStorage } = require("@mikro-orm/core")

jest.mock(
  "@sindresorhus/slugify",
  () => {
    return {
      __esModule: true,
      default: (str) => (str || "").toLowerCase().replace(/\s+/g, "-"),
    }
  },
  { virtual: true },
  
)

jest.mock("p-map", () => {
    return {
        __esModule: true,
        default: async (iterable, mapper) => Promise.all(iterable.map(mapper)),
    }
}, { virtual: true })

MetadataStorage.clear()