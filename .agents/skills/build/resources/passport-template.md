# Module Passport: <module-name>

> Specification: [`docs/specs/<module-name>.md`](../../../docs/specs/<module-name>.md)

## Purpose & Responsibilities
<Domain purpose, business value, and non-goals from Section 1 of the RFC>

## Public Contract
Exported via `@/src/modules/<module-name>`:
- **Types**: `<Exported types and interfaces>`
- **Schemas**: `<Exported validation schemas>`
- **Constants**: `<Exported configuration constants>`
- **Components / Entry Points**: `<Exported UI components or API entry points>`

## Allowed Dependencies
- `@/src/shared/*`
- `@/src/modules/<allowed-module>` (if required by domain role, strictly via public entry point)
- Approved external libraries

## Architectural Invariants
- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private.
- Public exports strictly through `index.ts`.
- Theme & Design: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md).
