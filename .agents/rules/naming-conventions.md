---
trigger: model_decision
description: Naming conventions and file structure standard for domain entities, categorical folders, and shared constants
---

# Naming Conventions

<rule id="naming-conventions" severity="REGULAR">
  <summary>Enforce strict singular kebab-case naming for domain entity files, exact 1-to-1 matching across types, constants, and components, restrict plural names to categorical folders and collection hooks, and require direct imports of shared constants without local aliases.</summary>
  <bad>
// app/types/terminal-windows.ts (plural file name for domain entity)
// app/components/terminal-window.tsx (mismatched name with types)
import { STORAGE_KEYS } from '@/app/constants/storage';
const LOCAL_STORAGE_KEY = STORAGE_KEYS.WORKSPACE; // Redundant local alias
  </bad>
  <good>
// app/types/terminal-window.ts (singular kebab-case)
// app/components/terminal-window.tsx (1-to-1 match with types and constants)
// app/constants/terminal-window.ts (1-to-1 match)
import { STORAGE_KEYS } from '@/app/constants/storage';
// Used directly: STORAGE_KEYS.WORKSPACE
  </good>
  <list type="checklist">
    <item>Domain entity files for types, components, and constants must be strictly singular and kebab-case (e.g., `terminal-window.ts`, `terminal-window.tsx`, `instrument.ts`, `workspace.ts`, `storage.ts`, `theme.ts`).</item>
    <item>1-to-1 naming correspondence: `app/types/<entity>.ts` must match `app/constants/<entity>.ts` and `app/components/<entity>.tsx` (never mix singular and plural forms for the same entity).</item>
    <item>Plural names are permitted only for categorical directories (`types/`, `constants/`, `components/`, `hooks/`, `tests/`) and for hooks/functions operating on collections (e.g., `use-workspace-windows.ts`).</item>
    <item>Shared constants (storage keys, limits, delays) must be imported and used directly from `@/app/constants/*`, without introducing redundant local aliases (`const FOO = FOO_BAR;`).</item>
  </list>
</rule>