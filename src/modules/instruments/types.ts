import type { Instrument, WindowKind } from "@/src/shared/contracts";

export type { Instrument, WindowKind };

export interface InstrumentCatalogProvider {
  search(query: string): Promise<Instrument[]>;
}

export interface InstrumentSearchDialogProps {
  readonly kind?: WindowKind;
  readonly title?: string;
  readonly catalog: InstrumentCatalogProvider;
  readonly onSelect: (instrument: Instrument) => void;
  readonly onCancel: () => void;
}
