# Module: <module-name>

> Specification: [`docs/specs/<module-name>.md`](../../docs/specs/<module-name>.md)

## Purpose & Scope
<Brief summary of domain role, responsibilities, and non-goals from Purpose & Boundaries>

## Public Contract
Import strictly via `@/src/modules/<module-name>`:
- **Types**: `<Exported types and interfaces>`
- **Schemas**: `<Exported validation schemas>`
- **Constants**: `<Exported configuration constants>`
- **Components / Entry Points**: `<Exported UI components or API entry points>`

## Allowed Dependencies
- `@/src/shared/*`
- Approved external libraries
- *Strictly Forbidden*: Direct imports from other `src/modules/*` or `src/app/*`.

## Architectural Invariants
- Black-box perimeter: internal files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private.
- Composition wiring: registered via `<composition_point>`.
- Theme & Design: styled strictly using tokens from [`DESIGN.md`](../../DESIGN.md).
