# Z-Trader

**Z-Trader** is a high-performance, multi-window financial trading and market analysis terminal (charts, order book, time & sales, indicators) running in Next.js.

<rule id="ui-design-guidelines" severity="MANDATORY">
  <summary>When designing, specifying, or implementing UI components or layout, DESIGN.md is the single source of truth for color tokens, themes, typography, and density.</summary>
  <list type="checklist">
    <item>Architects must incorporate design tokens and theme requirements from DESIGN.md into the task contract.</item>
    <item>Coders must strictly follow DESIGN.md tokens and dark/light theme invariants without hardcoding rogue styles.</item>
    <item>Reviewers must verify that UI changes conform to DESIGN.md and task contracts.</item>
  </list>
</rule>

<rule id="discussion-first" severity="MANDATORY">
  Never edit files or make decisions for the developer when they ask questions, seek clarification, or discuss options. Answer in conversational text first, explain trade-offs, and wait for explicit approval before modifying any workspace files, specifications, or rules.
</rule>

<rule id="build-in-non-sandbox" severity="REGULAR">
  Never run `pnpm build` and `pnpmp test:e2e` in sandbox environment.
</rule>

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
