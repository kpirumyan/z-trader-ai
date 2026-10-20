export type Instrument = { symbol: string; name: string };
export type InstrumentCatalogProvider = { search(query: string): Promise<Instrument[]> };
