import { DEFAULT_INSTRUMENTS } from "../constants";

import type { Instrument, InstrumentCatalogProvider } from "../types";

export const demoInstrumentCatalog: InstrumentCatalogProvider = {
  async search(query: string): Promise<Instrument[]> {
    const normalized = query.trim().toLowerCase();

    if (normalized.length === 0) {
      return DEFAULT_INSTRUMENTS.map((item) => ({ ...item }));
    }

    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameWordRegex = new RegExp(`\\b${escaped}`, "i");

    return DEFAULT_INSTRUMENTS.filter(
      ({ symbol, name }) => symbol.toLowerCase().includes(normalized) || nameWordRegex.test(name),
    ).map((item) => ({ ...item }));
  },
};
