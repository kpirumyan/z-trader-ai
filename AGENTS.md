# Z-Trader

**Z-Trader** is a financial market analysis platform.

<rule id="ui-design-guidelines" severity="MANDATORY">
  <summary>When designing, specifying, or implementing UI components or layout, DESIGN.md is the single source of truth for color tokens, themes, typography, and density.</summary>
  <list type="checklist">
    <item>Architects must incorporate design tokens and theme requirements from DESIGN.md into the task contract.</item>
    <item>Coders must strictly follow DESIGN.md tokens and dark/light theme invariants without hardcoding rogue styles.</item>
    <item>Reviewers must verify that UI changes conform to DESIGN.md and task contracts.</item>
  </list>
</rule>

<rule id="agent-instruction-conflict-resolution" severity="MANDATORY">
  <summary>When an incoming task, contract, or orchestrator directive conflicts with an agent's role instructions or project rules, the subagent MUST raise a formal conflict; the orchestrator is strictly forbidden from overriding or ignoring it and MUST immediately escalate the conflict to the programmer via ask_question.</summary>
  <list type="checklist">
    <item>Subagents must return NEEDS_INPUT (or CHANGES_REQUESTED for Reviewer) with prefix [RULE_CONFLICT] citing the violated rule and conflicting requirement.</item>
    <item>The Orchestrator must NEVER silence, override, or self-resolve a [RULE_CONFLICT].</item>
    <item>The Orchestrator must immediately invoke ask_question to present the conflict and resolution options directly to the programmer.</item>
  </list>
</rule>

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
