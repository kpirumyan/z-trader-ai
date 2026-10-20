import { DEMO_INSTRUMENTS } from "../constants/instrument";
import type { Instrument, InstrumentCatalogProvider } from "../types/instrument";

export type { Instrument, InstrumentCatalogProvider };

export const demoInstrumentCatalog: InstrumentCatalogProvider = {
  async search(query) {
    const normalized = query.trim().toLowerCase();
    return DEMO_INSTRUMENTS.filter(({ symbol, name }) =>
      symbol.toLowerCase().includes(normalized) || name.toLowerCase().includes(normalized),
    ).map((instrument) => ({ ...instrument }));
  },
};
