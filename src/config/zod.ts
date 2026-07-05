import { z } from 'zod'
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'

// Extend Zod with `.openapi()` ONCE, before any schema is created, then
// re-export. Every module must import `z` from here (not from 'zod') so all
// schemas share this single, extended instance — otherwise schemas created
// before the extension runs won't carry OpenAPI metadata.
extendZodWithOpenApi(z)

export { z }
