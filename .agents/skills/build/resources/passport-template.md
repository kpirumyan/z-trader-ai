# Module Passport: `<module-name>`

## Purpose & Responsibilities
`<Domain purpose, business value, and non-goals>`

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

## Behavioral & Architectural Invariants
- Black-box perimeter: internal implementation files (`model/`, `ui/`, `schema.ts`, `constants.ts`, `types.ts`) are private.
- Public exports strictly through `index.ts`.
- **Key Guarantees**: `<Critical runtime guarantees, e.g. stream unsubscriptions on unmount, state isolation>`
- Theme & Design: styled strictly using tokens from [`DESIGN.md`](../../../DESIGN.md).

## Verification
- Behavior verified via black-box test suite in [`tests/`](./tests/).
