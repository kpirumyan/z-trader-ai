import { z } from "zod";

import { instrumentSchema } from "@/src/shared/contracts";

export { instrumentSchema };

export const instrumentCatalogSchema = z.array(instrumentSchema);
