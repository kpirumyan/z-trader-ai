---
name: skill-creator
description: Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill performance with variance analysis, or optimize a skill's description for better triggering accuracy.
---

# Skill Creator

A skill for creating new skills and iteratively improving them across **Antigravity (AGY)** and **Claude Code** on both **Linux and Windows**.

At a high level, the process of creating a skill goes like this:

- Decide what you want the skill to do and roughly how it should do it
- Write a draft of the skill
- Create a few test prompts and run the agent-with-access-to-the-skill on them
- Help the user evaluate the results both qualitatively and quantitatively
  - While the runs happen in the background, draft some quantitative evals if there aren't any (if there are some, you can either use as is or modify if you feel something needs to change about them). Then explain them to the user (or if they already existed, explain the ones that already exist)
  - Use the `eval-viewer/generate_review.py` script to show the user the results for them to look at, and also let them look at the quantitative metrics
- Rewrite the skill based on feedback from the user's evaluation of the results (and also if there are any glaring flaws that become apparent from the quantitative benchmarks)
- Repeat until you're satisfied
- Expand the test set and try again at larger scale

Your job when using this skill is to figure out where the user is in this process and then jump in and help them progress through these stages. So for instance, maybe they're like "I want to make a skill for X". You can help narrow down what they mean, write a draft, write the test cases, figure out how they want to evaluate, run all the prompts, and repeat.

On the other hand, maybe they already have a draft of the skill. In this case you can go straight to the eval/iterate part of the loop.

Of course, you should always be flexible and if the user is like "I don't need to run a bunch of evaluations, just vibe with me", you can do that instead.

Then after the skill is done (but again, the order is flexible), you can also run the skill description improver to optimize the triggering of the skill.

Cool? Cool.

## Communicating with the user

The skill creator is liable to be used by people across a wide range of familiarity with coding jargon. Pay attention to context cues to understand how to phrase your communication! In the default case:

- "evaluation" and "benchmark" are borderline, but OK
- for "JSON" and "assertion" you want to see serious cues from the user that they know what those things are before using them without explaining them

It's OK to briefly explain terms if you're in doubt, and feel free to clarify terms with a short definition if you're unsure if the user will get it.

---

## Creating a skill

### Capture Intent

Start by understanding the user's intent. The current conversation might already contain a workflow the user wants to capture (e.g., they say "turn this into a skill"). If so, extract answers from the conversation history first — the tools used, the sequence of steps, corrections the user made, input/output formats observed. The user may need to fill the gaps, and should confirm before proceeding to the next step.

1. What should this skill enable the agent to do?
2. When should this skill trigger? (what user phrases/contexts)
3. What's the expected output format?
4. Should we set up test cases to verify the skill works? Skills with objectively verifiable outputs (file transforms, data extraction, code generation, fixed workflow steps) benefit from test cases. Skills with subjective outputs (writing style, art) often don't need them. Suggest the appropriate default based on the skill type, but let the user decide.

### Where to Place Skills

- **Workspace / Project-scoped**: `.agents/skills/<skill-name>/SKILL.md` (or `.claude/skills/<skill-name>/SKILL.md` in Claude Code)
- **Global (Machine-local in Antigravity)**: `~/.gemini/config/skills/<skill-name>/SKILL.md`

### Interview and Research

Proactively ask questions about edge cases, input/output formats, example files, success criteria, and dependencies. Wait to write test prompts until you've got this part ironed out.

Check available MCPs - if useful for research (searching docs, finding similar skills, looking up best practices), research in parallel via subagents if available, otherwise inline. Come prepared with context to reduce burden on the user.

### Write the SKILL.md

Based on the user interview, fill in these components:

- **name**: Skill identifier (kebab-case: lowercase letters, digits, hyphens, max 64 chars)
- **description**: When to trigger, what it does (max 1024 chars, no `<` or `>` angle brackets). This is the primary triggering mechanism - include both what the skill does AND specific contexts for when to use it. All "when to use" info goes here, not in the body. Note: models have a tendency to "undertrigger" skills -- to not use them when they'd be useful. To combat this, please make the skill descriptions a little bit "pushy". So for instance, instead of "How to build a simple fast dashboard to display internal data.", you might write "How to build a simple fast dashboard to display internal data. Make sure to use this skill whenever the user mentions dashboards, data visualization, internal metrics, or wants to display any kind of company data, even if they don't explicitly ask for a 'dashboard.'"
- **compatibility**: Required tools, dependencies (optional, rarely needed)
- **the rest of the skill :)**

### Skill Writing Guide

#### Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter (name, description required)
│   └── Markdown instructions
└── Bundled Resources (optional)
    ├── scripts/    - Executable code for deterministic/repetitive tasks
    ├── references/ - Docs loaded into context as needed
    └── assets/     - Files used in output (templates, icons, fonts)
```

#### Progressive Disclosure

Skills use a three-level loading system:
1. **Metadata** (name + description) - Always in context (~100 words)
2. **SKILL.md body** - In context whenever skill triggers (<500 lines ideal)
3. **Bundled resources** - As needed (unlimited, scripts can execute without loading)

These word counts are approximate and you can feel free to go longer if needed.

**Key patterns:**
- Keep SKILL.md under 500 lines; if you're approaching this limit, add an additional layer of hierarchy along with clear pointers about where the model using the skill should go next to follow up.
- Reference files clearly from SKILL.md with guidance on when to read them
- For large reference files (>300 lines), include a table of contents

**Domain organization**: When a skill supports multiple domains/frameworks, organize by variant:
```
cloud-deploy/
├── SKILL.md (workflow + selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```
The agent reads only the relevant reference file.

#### Principle of Lack of Surprise

Skills must not contain malware, exploit code, or any content that could compromise system security. A skill's contents should not surprise the user in their intent if described. Don't go along with requests to create misleading skills or skills designed to facilitate unauthorized access, data exfiltration, or other malicious activities.

#### Writing Patterns

Prefer using the imperative form in instructions.

**Defining output formats** - You can do it like this:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples pattern** - It's useful to include examples:
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

### Writing Style

Try to explain to the model why things are important in lieu of heavy-handed MUSTs. Use theory of mind and try to make the skill general and not super-narrow to specific examples. Start by writing a draft and then look at it with fresh eyes and improve it.

### Test Cases

After writing the skill draft, come up with 2-3 realistic test prompts — the kind of thing a real user would actually say. Share them with the user: "Here are a few test cases I'd like to try. Do these look right, or do you want to add more?" Then run them.

Save test cases to `evals/evals.json` (or inside your eval workspace if keeping the skill directory clean until finalized). Don't write assertions yet — just the prompts. You'll draft assertions in the next step while the runs are in progress.

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "User's task prompt",
      "expected_output": "Description of expected result",
      "files": []
    }
  ]
}
```

See `references/schemas.md` for the full schema.

---

## Running and evaluating test cases

This section is one continuous sequence — don't stop partway through.

**Where to store `<workspace>` (`<skill-name>-workspace/`):**
- **In Antigravity**: Place `<skill-name>-workspace/` inside the conversation's scratch directory (`<appDataDir>/brain/<conversation-id>/scratch/<skill-name>-workspace/`) to respect workspace hygiene rules on both Linux and Windows.
- **In Claude Code**: Place `<skill-name>-workspace/` as a sibling to the skill directory or in `/tmp/`.

Within the workspace, organize results by iteration (`iteration-1/`, `iteration-2/`, etc.) and within that, each test case gets a directory (`eval-0/`, `eval-1/`, etc.).

### Step 1: Spawn all runs (with-skill AND baseline) in the same turn

For each test case, spawn two subagents in the same turn — one with the skill, one without (in Antigravity, call `invoke_subagent` with `TypeName: "self"` and `Model: "inherit"`). Launch everything at once so it all finishes around the same time.

**With-skill run:**

```
Execute this task:
- Skill path: <path-to-skill> (read SKILL.md first and follow its workflow)
- Task: <eval prompt>
- Input files: <eval files if any, or "none">
- Save outputs to: <workspace>/iteration-<N>/eval-<ID>/with_skill/outputs/
- Outputs to save: <what the user cares about — e.g., "the .docx file", "the final CSV">
```

**Baseline run** (same prompt, but the baseline depends on context):
- **Creating a new skill**: no skill at all. Instruct the subagent NOT to read `<path-to-skill>`, complete the prompt with general knowledge, and save to `without_skill/outputs/`.
- **Improving an existing skill**: the old version. Before editing, snapshot the skill (`<workspace>/skill-snapshot/`), then point the baseline subagent at the snapshot. Save to `old_skill/outputs/`.

Write an `eval_metadata.json` for each test case (assertions can be empty for now):

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": []
}
```

### Step 2: While runs are in progress, draft assertions

While subagents are running in the background, draft quantitative assertions for each test case and explain them to the user. If assertions already exist in `evals/evals.json`, review them and explain what they check.

Good assertions are objectively verifiable and have descriptive names. Update the `eval_metadata.json` files and `evals/evals.json` with the assertions once drafted.

### Step 3: As runs complete, capture timing and transcript data

- **In Antigravity**: Each `invoke_subagent` call returns a `conversationId`. Once a subagent finishes, run `extract_subagent_metrics.py` from the `skill-creator` directory to automatically generate `timing.json`, `outputs/metrics.json`, and `transcript.md` from the subagent's JSONL log (works on both Linux and Windows):
  ```bash
  python -m scripts.extract_subagent_metrics --conversation-id <subagent-conversation-id> --run-dir <workspace>/iteration-<N>/eval-<ID>/with_skill
  ```
- **In Claude Code**: When each subagent task completes, you receive a notification containing `total_tokens` and `duration_ms`. Save this data immediately to `timing.json` in the run directory:
  ```json
  {
    "total_tokens": 84852,
    "duration_ms": 23332,
    "total_duration_seconds": 23.3
  }
  ```

### Step 4: Grade, aggregate, and launch the viewer

Once all runs are done:

1. **Grade each run** — spawn a grader subagent (or grade inline) that reads `agents/grader.md` and evaluates each assertion against the outputs and `transcript.md`. Save results to `grading.json` in each run directory (`with_skill/grading.json` and `without_skill/grading.json`). The `grading.json` expectations array must use the fields `text`, `passed`, and `evidence`. For assertions that can be checked programmatically, write and run a script rather than eyeballing it.

2. **Aggregate into benchmark** — run the aggregation script from the `skill-creator` directory (works on Linux & Windows):
   ```bash
   python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```
   This produces `benchmark.json` and `benchmark.md` with `pass_rate`, `time_seconds`, and `tokens` for each configuration, with mean ± stddev and the delta.

3. **Do an analyst pass** — read the benchmark data and surface patterns the aggregate stats might hide. See `agents/analyzer.md` (the "Analyzing Benchmark Results" section) for what to look for — things like assertions that always pass regardless of skill (non-discriminating), high-variance evals (possibly flaky), and time/token tradeoffs. Add these to `"notes"` in `benchmark.json`.

4. **Launch the viewer** with both qualitative outputs and quantitative data:
   - **Interactive HTTP server mode** (works on Linux & Windows; in Antigravity, start with `IsDaemon: true` and `BypassSandbox: true` if the user wants to open `http://localhost:3117` in their browser):
     ```bash
     python <skill-creator-path>/eval-viewer/generate_review.py <workspace>/iteration-N --skill-name "my-skill" --benchmark <workspace>/iteration-N/benchmark.json
     ```
   - **Static HTML mode** (works inside the sandbox without port binding or `BypassSandbox`, on both Linux & Windows):
     ```bash
     python <skill-creator-path>/eval-viewer/generate_review.py <workspace>/iteration-N --skill-name "my-skill" --benchmark <workspace>/iteration-N/benchmark.json --static <workspace>/iteration-N/review.html
     ```
   For iteration 2+, also pass `--previous-workspace <workspace>/iteration-<N-1>`.

5. **Tell the user**: "I've generated the results viewer. There are two tabs — 'Outputs' lets you click through each test case and leave feedback, 'Benchmark' shows the quantitative comparison. When you're done, come back here and let me know."

### Step 5: Read the feedback

When the user tells you they're done, read `feedback.json` (in server mode it is saved directly to `<workspace>/iteration-N/feedback.json`; in `--static` mode the "Submit All Reviews" button downloads `feedback.json` to `~/Downloads/feedback.json`):

```json
{
  "reviews": [
    {"run_id": "eval-0-with_skill", "feedback": "the chart is missing axis labels", "timestamp": "..."},
    {"run_id": "eval-1-with_skill", "feedback": "", "timestamp": "..."},
    {"run_id": "eval-2-with_skill", "feedback": "perfect, love this", "timestamp": "..."}
  ],
  "status": "complete"
}
```

Empty feedback means the user thought it was fine. Focus your improvements on the test cases where the user had specific complaints.

---

## Improving the skill

### How to think about improvements

1. **Generalize from the feedback.** Avoid narrow overfitting or rigid `MUST` rules for specific test examples.
2. **Keep the prompt lean.** Remove instructions that aren't pulling their weight. Read `transcript.md` to spot unproductive steps.
3. **Explain the why.** Explain the reasoning behind instructions so the model can generalize intelligently.
4. **Look for repeated work across test cases.** If all test runs independently wrote a similar helper script, bundle that script in `scripts/` and reference it from `SKILL.md`.

### The iteration loop

After improving the skill:
1. Apply your improvements to the skill
2. Rerun all test cases into a new `iteration-<N+1>/` directory, including baseline runs
3. Launch the reviewer with `--previous-workspace` pointing at the previous iteration
4. Wait for the user to review and tell you they're done
5. Read the new feedback, improve again, repeat

---

## Advanced: Blind comparison

For situations where you want a rigorous comparison between two versions of a skill, read `agents/comparator.md` and `agents/analyzer.md`. Spawn an independent subagent (`invoke_subagent`) with the two outputs labeled A and B without telling it which is which, and let it judge quality.

---

## Description Optimization

The `description` field in `SKILL.md` frontmatter is the primary mechanism that determines whether the agent invokes a skill. After creating or improving a skill, offer to optimize the description for better triggering accuracy.

This workflow works **by subscription** in both **Antigravity** (via native subagents, requiring zero API keys) and **Claude Code** (via `claude -p`), as well as with optional API keys if run standalone in a terminal.

### Step 1: Generate trigger eval queries

Create 20 eval queries — a mix of `should_trigger: true` (8-10) and `should_trigger: false` (8-10). Save as JSON in `<workspace>/trigger_eval.json`:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

The queries must be realistic, concrete, and specific (file paths, job context, column names, casual phrasing, typos).
- **should-trigger** queries: different phrasings of the same intent, including cases where the user doesn't explicitly name the skill.
- **should-not-trigger** queries: near-misses that share keywords or concepts with the skill but actually need something different. Avoid obviously irrelevant queries.

### Step 2: Review with user

Present the eval set to the user for review using the HTML template:

1. Read the template from `assets/eval_review.html`
2. Replace the placeholders:
   - `__EVAL_DATA_PLACEHOLDER__` → the JSON array of eval items (no quotes around it — it's a JS variable assignment)
   - `__SKILL_NAME_PLACEHOLDER__` → the skill's name
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → the skill's current description
3. Write to a temp/scratch HTML file (e.g. `<workspace>/eval_review_<skill-name>.html`) and open it (via `webbrowser` / `Start-Process` on Windows / `open` on macOS / `xdg-open` on Linux, or provide a clickable file link).
4. The user can edit queries, toggle should-trigger, add/remove entries, then click "Export Eval Set" (which saves `eval_set.json` to `~/Downloads/`).

### Step 3: Run the optimization loop (Subscription & CLI Modes)

#### Mode A: Antigravity Subscription Mode (Native Subagents — No API Key Required)

When running in Antigravity on a subscription (without `claude` CLI or API keys), drive the exact same 60%/40% stratified train/test loop using `scripts/run_loop.py` step flags and `invoke_subagent`:

1. **Initialize the stratified train/test split and live HTML report** (run from `skill-creator` directory):
   ```bash
   python -m scripts.run_loop --init-split --eval-set <workspace>/trigger_eval.json --skill-path <path-to-skill> --state-file <workspace>/loop_state.json --report <workspace>/description_report.html
   ```
2. **For each iteration (up to 5)**:
   - **Evaluate trigger rates via `invoke_subagent`**:
     Spawn 2–4 parallel `research` (read-only) subagents (`invoke_subagent` with `TypeName: "research"`, `Model: "inherit"`). Give each subagent a batch of queries from `queries_to_evaluate` (3 independent passes per query) and the list of available skills in the workspace with the candidate `current_description` for `<skill-name>`. For each query, the subagent decides whether a freshly initialized agent would immediately read `<skill-name>/SKILL.md` (`true`) or handle the request without reading that skill (`false`).
   - Save the aggregated counts to `<workspace>/iter_triggers.json`:
     ```json
     [
       {"query": "...", "triggers": 3, "runs": 3},
       {"query": "...", "triggers": 0, "runs": 3}
     ]
     ```
   - **Score the iteration and update the HTML report**:
     ```bash
     python -m scripts.run_loop --record-iteration --state-file <workspace>/loop_state.json --triggers-file <workspace>/iter_triggers.json
     ```
   - If the output JSON has `"status": "continue"`, it includes `"improve_prompt"` (which contains only the train results and hides the held-out test set to prevent overfitting). Follow `"improve_prompt"` (inline or via a subagent) to produce a new candidate description (<1024 chars, no `<` or `>`), then register it for the next iteration:
     ```bash
     python -m scripts.run_loop --set-next-description "<new-description>" --state-file <workspace>/loop_state.json
     ```
   - Repeat until `--record-iteration` returns `"exit_reason"` (`all_passed` or `max_iterations`) and `"best_description"` (automatically selected by held-out test score).

#### Mode B: Standalone CLI Mode (`claude` CLI Subscription or Optional API Key)

If `claude` CLI is installed in `PATH` (Claude Code subscription) or an optional API key (`GEMINI_API_KEY` / `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY`) is configured in the environment, `run_loop.py` can run the entire loop in a single command on both Linux and Windows:

```bash
python -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --max-iterations 5 \
  --verbose
```

### Step 4: Apply the result

Take `best_description` from the JSON output and update the skill's `SKILL.md` frontmatter. Show the user before/after, link to the generated HTML report, and report the train/test scores.

---

### Package and Validate

Validate and package the skill into a distributable `.skill` archive (works on both Linux and Windows with zero external dependencies):

```bash
python -m scripts.quick_validate <path/to/skill-folder>
python -m scripts.package_skill <path/to/skill-folder> <output-dir>
```

---

## Reference files

The `agents/` directory contains instructions for specialized subagents. Read them when you need to spawn the relevant subagent:

- `agents/grader.md` — How to evaluate assertions against outputs
- `agents/comparator.md` — How to do blind A/B comparison between two outputs
- `agents/analyzer.md` — How to analyze why one version beat another

The `references/` directory has additional documentation:
- `references/schemas.md` — JSON structures for `evals.json`, `grading.json`, `benchmark.json`, etc.
