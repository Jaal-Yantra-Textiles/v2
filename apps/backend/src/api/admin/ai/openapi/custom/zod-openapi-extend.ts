import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi"
import { z } from "zod"

// Extend Zod with OpenAPI once, before schemas are defined
extendZodWithOpenApi(z)
