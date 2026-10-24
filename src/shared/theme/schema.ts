import { z } from "zod";

export const themeSchema = z.enum(["dark", "light"]);
