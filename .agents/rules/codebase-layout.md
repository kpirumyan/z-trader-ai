---
trigger: model_decision
description: Codebase layout standard enforcing separation between types, constants, hooks, components, domain features, and tests
---

# Codebase Layout

<rule id="codebase-layout" severity="MANDATORY">
  <summary>Enforce strict separation between types, constants, hooks, components, domain features, and tests according to the codebase layout standard.</summary>
  <bad>
// app/features/trade/trade-service.ts
export interface TradeOrder { id: string; price: number; } // Domain types must not be declared in feature files
import { MockOrder } from '@/tests/unit/mocks'; // Production code must not import from tests/
  </bad>
  <good>
// app/types/trade-order.ts
export interface TradeOrder { id: string; price: number; }

// app/features/trade/trade-service.ts
import type { TradeOrder } from '@/app/types/trade-order';
  </good>
  <list type="checklist">
    <item>`app/types/`: strictly for TypeScript types and interfaces (`type`, `interface`). No runtime code, constants, or functions. All domain types are declared here, never inside feature files.</item>
    <item>`app/constants/`: immutable constants, mappings, and static dictionaries.</item>
    <item>`app/hooks/`: custom React hooks (`use*`).</item>
    <item>`app/components/`: reusable presentation React components.</item>
    <item>`app/<feature>/`: business logic implementation and providers (importing types from `app/types/`).</item>
    <item>`tests/unit/` and `tests/e2e/`: unit and end-to-end tests. Production code must never import anything from `tests/`.</item>
    <item>Never mix types with runtime code: do not declare public domain types in implementation files and do not import types from implementation/data files.</item>
  </list>
</rule>