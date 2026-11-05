#!/usr/bin/env python3
"""Run the eval + improve loop until all pass or max iterations reached.

Works on both Linux and Windows, and supports both subscription and API modes:
1. Antigravity Subscription Step Mode (`--init-split` and `--record-iteration`):
   Manages the stratified 60%/40% train/test split, blinded history, and live HTML
   report while the Antigravity agent runs trigger tests and description improvements
   via native `invoke_subagent` (zero API keys required).
2. Standalone Loop Mode (default):
   Combines `run_eval.py` and `improve_description.py` in a loop using `claude -p`
   (Claude Code subscription) or optional API keys (`GEMINI_API_KEY` / `ANTHROPIC_API_KEY`).
"""

import argparse
import json
import random
import sys
import tempfile
import time
import webbrowser
from pathlib import Path

from scripts.generate_report import generate_html
from scripts.improve_description import build_improvement_prompt, improve_description
from scripts.run_eval import find_project_root, run_eval, score_trigger_counts
from scripts.utils import ensure_utf8_stdio, parse_skill_md


def split_eval_set(eval_set: list[dict], holdout: float, seed: int = 42) -> tuple[list[dict], list[dict]]:
    """Split eval set into train and test sets, stratified by should_trigger."""
    random.seed(seed)

    trigger = [e for e in eval_set if e["should_trigger"]]
    no_trigger = [e for e in eval_set if not e["should_trigger"]]

    random.shuffle(trigger)
    random.shuffle(no_trigger)

    n_trigger_test = max(1, int(len(trigger) * holdout)) if trigger else 0
    n_no_trigger_test = max(1, int(len(no_trigger) * holdout)) if no_trigger else 0

    test_set = trigger[:n_trigger_test] + no_trigger[:n_no_trigger_test]
    train_set = trigger[n_trigger_test:] + no_trigger[n_no_trigger_test:]

    return train_set, test_set


def _compute_best_summary(
    history: list[dict],
    original_description: str,
    current_description: str,
    exit_reason: str,
    holdout: float,
    train_size: int,
    test_size: int,
) -> dict:
    """Select the best iteration by held-out test score (or train score if no test set)."""
    if test_size > 0:
        best = max(history, key=lambda h: (h.get("test_passed") or 0, h.get("train_passed") or 0))
        best_score = f"{best['test_passed']}/{best['test_total']}"
    else:
        best = max(history, key=lambda h: h.get("train_passed", 0))
        best_score = f"{best['train_passed']}/{best['train_total']}"

    return {
        "exit_reason": exit_reason,
        "original_description": original_description,
        "best_description": best["description"],
        "best_score": best_score,
        "best_train_score": f"{best['train_passed']}/{best['train_total']}",
        "best_test_score": f"{best['test_passed']}/{best['test_total']}" if test_size > 0 else None,
        "final_description": current_description,
        "iterations_run": len(history),
        "holdout": holdout,
        "train_size": train_size,
        "test_size": test_size,
        "history": history,
    }


def init_split_state(
    eval_set: list[dict],
    skill_path: Path,
    state_file: Path,
    description_override: str | None,
    holdout: float,
    max_iterations: int,
    runs_per_query: int,
    trigger_threshold: float,
    report_arg: str,
) -> dict:
    """Initialize stateful train/test split for Antigravity native subagent subscription mode."""
    name, original_description, _ = parse_skill_md(skill_path)
    current_description = description_override or original_description

    if holdout > 0 and len(eval_set) >= 4:
        train_set, test_set = split_eval_set(eval_set, holdout)
    else:
        train_set = eval_set
        test_set = []

    live_report_path: str | None = None
    if report_arg != "none":
        if report_arg == "auto":
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            rp = state_file.parent / f"skill_description_report_{skill_path.name}_{timestamp}.html"
        else:
            rp = Path(report_arg).resolve()
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(
            "<html><head><meta charset='utf-8'><meta http-equiv='refresh' content='5'></head>"
            "<body><h1>Starting optimization loop...</h1></body></html>",
            encoding="utf-8",
        )
        live_report_path = str(rp)

    state = {
        "skill_name": name,
        "skill_path": str(skill_path.resolve()),
        "original_description": original_description,
        "current_description": current_description,
        "holdout": holdout,
        "max_iterations": max_iterations,
        "runs_per_query": runs_per_query,
        "trigger_threshold": trigger_threshold,
        "train_set": train_set,
        "test_set": test_set,
        "all_queries": train_set + test_set,
        "history": [],
        "live_report_path": live_report_path,
        "status": "in_progress",
    }
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return {
        "status": "initialized",
        "skill_name": name,
        "current_description": current_description,
        "train_size": len(train_set),
        "test_size": len(test_set),
        "runs_per_query": runs_per_query,
        "live_report_path": live_report_path,
        "queries_to_evaluate": [q["query"] for q in state["all_queries"]],
    }


def record_iteration_state(
    state_file: Path,
    triggers_file: Path,
    next_description: str | None = None,
) -> dict:
    """Record one iteration's trigger counts in Antigravity subscription mode and update HTML report."""
    state = json.loads(state_file.read_text(encoding="utf-8-sig"))
    skill_path = Path(state["skill_path"])
    name, _, content = parse_skill_md(skill_path)

    raw_triggers = json.loads(triggers_file.read_text(encoding="utf-8-sig"))
    # Accept either [{"query": "...", "triggers": 2, "runs": 3}] or {"query": [true, false, true]}
    query_triggers: dict[str, list[bool]] = {}
    if isinstance(raw_triggers, list):
        for item in raw_triggers:
            q = item["query"]
            if "boolean_runs" in item:
                query_triggers[q] = [bool(x) for x in item["boolean_runs"]]
            else:
                t = int(item.get("triggers", 0))
                r = int(item.get("runs", state.get("runs_per_query", 3)))
                query_triggers[q] = ([True] * t) + ([False] * max(0, r - t))
    elif isinstance(raw_triggers, dict):
        for q, val in raw_triggers.items():
            if isinstance(val, list):
                query_triggers[q] = [bool(x) for x in val]
            elif isinstance(val, dict):
                t = int(val.get("triggers", 0))
                r = int(val.get("runs", state.get("runs_per_query", 3)))
                query_triggers[q] = ([True] * t) + ([False] * max(0, r - t))

    current_description = state["current_description"]
    train_set = state["train_set"]
    test_set = state["test_set"]
    all_queries = train_set + test_set
    trigger_threshold = state.get("trigger_threshold", 0.5)

    all_results = score_trigger_counts(
        eval_set=all_queries,
        query_triggers=query_triggers,
        skill_name=name,
        description=current_description,
        trigger_threshold=trigger_threshold,
    )

    train_queries_set = {q["query"] for q in train_set}
    train_result_list = [r for r in all_results["results"] if r["query"] in train_queries_set]
    test_result_list = [r for r in all_results["results"] if r["query"] not in train_queries_set]

    train_passed = sum(1 for r in train_result_list if r["pass"])
    train_total = len(train_result_list)
    train_summary = {"passed": train_passed, "failed": train_total - train_passed, "total": train_total}
    train_results = {"results": train_result_list, "summary": train_summary}

    if test_set:
        test_passed = sum(1 for r in test_result_list if r["pass"])
        test_total = len(test_result_list)
        test_summary = {"passed": test_passed, "failed": test_total - test_passed, "total": test_total}
    else:
        test_summary = None

    iteration = len(state["history"]) + 1
    state["history"].append({
        "iteration": iteration,
        "description": current_description,
        "train_passed": train_summary["passed"],
        "train_failed": train_summary["failed"],
        "train_total": train_summary["total"],
        "train_results": train_result_list,
        "test_passed": test_summary["passed"] if test_summary else None,
        "test_failed": test_summary["failed"] if test_summary else None,
        "test_total": test_summary["total"] if test_summary else None,
        "test_results": test_result_list if test_summary else None,
        "passed": train_summary["passed"],
        "failed": train_summary["failed"],
        "total": train_summary["total"],
        "results": train_result_list,
    })

    max_iterations = state.get("max_iterations", 5)
    is_done = (train_summary["failed"] == 0) or (iteration >= max_iterations)
    exit_reason = (
        f"all_passed (iteration {iteration})"
        if train_summary["failed"] == 0
        else (f"max_iterations ({max_iterations})" if iteration >= max_iterations else "in_progress")
    )

    summary_output = _compute_best_summary(
        history=state["history"],
        original_description=state["original_description"],
        current_description=current_description,
        exit_reason=exit_reason,
        holdout=state["holdout"],
        train_size=len(train_set),
        test_size=len(test_set),
    )

    live_report_path = state.get("live_report_path")
    if live_report_path:
        Path(live_report_path).write_text(
            generate_html(summary_output, auto_refresh=not is_done, skill_name=name),
            encoding="utf-8",
        )

    if is_done:
        state["status"] = "completed"
        state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
        return summary_output

    blinded_history = [
        {k: v for k, v in h.items() if not k.startswith("test_")}
        for h in state["history"]
    ]
    improve_prompt = build_improvement_prompt(
        skill_name=name,
        skill_content=content,
        current_description=current_description,
        eval_results=train_results,
        history=blinded_history,
    )

    if next_description:
        state["current_description"] = next_description.replace("<", "").replace(">", "").strip()

    state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")

    return {
        "status": "continue",
        "iteration_recorded": iteration,
        "train_score": f"{train_summary['passed']}/{train_summary['total']}",
        "test_score": f"{test_summary['passed']}/{test_summary['total']}" if test_summary else None,
        "live_report_path": live_report_path,
        "improve_prompt": None if next_description else improve_prompt,
        "current_description": state["current_description"],
    }


def run_loop(
    eval_set: list[dict],
    skill_path: Path,
    description_override: str | None,
    num_workers: int,
    timeout: int,
    max_iterations: int,
    runs_per_query: int,
    trigger_threshold: float,
    holdout: float,
    model: str | None,
    verbose: bool,
    live_report_path: Path | None = None,
    log_dir: Path | None = None,
    backend: str = "auto",
) -> dict:
    """Run the standalone eval + improvement loop."""
    project_root = find_project_root()
    name, original_description, content = parse_skill_md(skill_path)
    current_description = description_override or original_description

    if holdout > 0 and len(eval_set) >= 4:
        train_set, test_set = split_eval_set(eval_set, holdout)
        if verbose:
            print(f"Split: {len(train_set)} train, {len(test_set)} test (holdout={holdout})", file=sys.stderr)
    else:
        train_set = eval_set
        test_set = []

    history = []
    exit_reason = "unknown"

    for iteration in range(1, max_iterations + 1):
        if verbose:
            print(f"\n{'='*60}", file=sys.stderr)
            print(f"Iteration {iteration}/{max_iterations}", file=sys.stderr)
            print(f"Description: {current_description}", file=sys.stderr)
            print(f"{'='*60}", file=sys.stderr)

        all_queries = train_set + test_set
        t0 = time.time()
        all_results = run_eval(
            eval_set=all_queries,
            skill_name=name,
            description=current_description,
            num_workers=num_workers,
            timeout=timeout,
            project_root=project_root,
            runs_per_query=runs_per_query,
            trigger_threshold=trigger_threshold,
            model=model,
            backend=backend,
        )
        eval_elapsed = time.time() - t0

        train_queries_set = {q["query"] for q in train_set}
        train_result_list = [r for r in all_results["results"] if r["query"] in train_queries_set]
        test_result_list = [r for r in all_results["results"] if r["query"] not in train_queries_set]

        train_passed = sum(1 for r in train_result_list if r["pass"])
        train_total = len(train_result_list)
        train_summary = {"passed": train_passed, "failed": train_total - train_passed, "total": train_total}
        train_results = {"results": train_result_list, "summary": train_summary}

        if test_set:
            test_passed = sum(1 for r in test_result_list if r["pass"])
            test_total = len(test_result_list)
            test_summary = {"passed": test_passed, "failed": test_total - test_passed, "total": test_total}
            test_results = {"results": test_result_list, "summary": test_summary}
        else:
            test_results = None
            test_summary = None

        history.append({
            "iteration": iteration,
            "description": current_description,
            "train_passed": train_summary["passed"],
            "train_failed": train_summary["failed"],
            "train_total": train_summary["total"],
            "train_results": train_results["results"],
            "test_passed": test_summary["passed"] if test_summary else None,
            "test_failed": test_summary["failed"] if test_summary else None,
            "test_total": test_summary["total"] if test_summary else None,
            "test_results": test_results["results"] if test_results else None,
            "passed": train_summary["passed"],
            "failed": train_summary["failed"],
            "total": train_summary["total"],
            "results": train_results["results"],
        })

        if live_report_path:
            partial_output = {
                "original_description": original_description,
                "best_description": current_description,
                "best_score": "in progress",
                "iterations_run": len(history),
                "holdout": holdout,
                "train_size": len(train_set),
                "test_size": len(test_set),
                "history": history,
            }
            live_report_path.write_text(
                generate_html(partial_output, auto_refresh=True, skill_name=name),
                encoding="utf-8",
            )

        if verbose:
            def print_eval_stats(label, results, elapsed):
                pos = [r for r in results if r["should_trigger"]]
                neg = [r for r in results if not r["should_trigger"]]
                tp = sum(r["triggers"] for r in pos)
                pos_runs = sum(r["runs"] for r in pos)
                fn = pos_runs - tp
                fp = sum(r["triggers"] for r in neg)
                neg_runs = sum(r["runs"] for r in neg)
                tn = neg_runs - fp
                total = tp + tn + fp + fn
                precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
                recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
                accuracy = (tp + tn) / total if total > 0 else 0.0
                print(f"{label}: {tp+tn}/{total} correct, precision={precision:.0%} recall={recall:.0%} accuracy={accuracy:.0%} ({elapsed:.1f}s)", file=sys.stderr)
                for r in results:
                    status = "PASS" if r["pass"] else "FAIL"
                    rate_str = f"{r['triggers']}/{r['runs']}"
                    print(f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:60]}", file=sys.stderr)

            print_eval_stats("Train", train_results["results"], eval_elapsed)
            if test_summary:
                print_eval_stats("Test ", test_results["results"], 0)

        if train_summary["failed"] == 0:
            exit_reason = f"all_passed (iteration {iteration})"
            if verbose:
                print(f"\nAll train queries passed on iteration {iteration}!", file=sys.stderr)
            break

        if iteration == max_iterations:
            exit_reason = f"max_iterations ({max_iterations})"
            if verbose:
                print(f"\nMax iterations reached ({max_iterations}).", file=sys.stderr)
            break

        if verbose:
            print(f"\nImproving description...", file=sys.stderr)

        t0 = time.time()
        blinded_history = [
            {k: v for k, v in h.items() if not k.startswith("test_")}
            for h in history
        ]
        new_description = improve_description(
            skill_name=name,
            skill_content=content,
            current_description=current_description,
            eval_results=train_results,
            history=blinded_history,
            model=model,
            log_dir=log_dir,
            iteration=iteration,
            backend=backend,
        )
        improve_elapsed = time.time() - t0

        if verbose:
            print(f"Proposed ({improve_elapsed:.1f}s): {new_description}", file=sys.stderr)

        current_description = new_description

    summary = _compute_best_summary(
        history=history,
        original_description=original_description,
        current_description=current_description,
        exit_reason=exit_reason,
        holdout=holdout,
        train_size=len(train_set),
        test_size=len(test_set),
    )

    if verbose:
        print(f"\nExit reason: {exit_reason}", file=sys.stderr)
        print(f"Best score: {summary['best_score']}", file=sys.stderr)

    return summary


def main():
    ensure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Run eval + improve loop")
    parser.add_argument("--eval-set", default=None, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", default=None, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override starting description")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--max-iterations", type=int, default=5, help="Max improvement iterations")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
    parser.add_argument("--holdout", type=float, default=0.4, help="Fraction of eval set to hold out for testing (0 to disable)")
    parser.add_argument("--model", default=None, help="Model for improvement")
    parser.add_argument(
        "--backend",
        choices=["auto", "claude", "gemini-api", "anthropic-api"],
        default="auto",
        help="Execution backend for standalone loop (default: auto)",
    )
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    parser.add_argument("--report", default="auto", help="Generate HTML report at this path (default: 'auto' for temp file, 'none' to disable)")
    parser.add_argument("--results-dir", default=None, help="Save all outputs (results.json, report.html, log.txt) to a timestamped subdirectory here")

    # Step-mode arguments for Antigravity native subagent subscription mode
    parser.add_argument("--init-split", action="store_true", help="Initialize train/test split state file for Antigravity native subagent loop")
    parser.add_argument("--record-iteration", action="store_true", help="Record subagent trigger results for one iteration and update report")
    parser.add_argument("--set-next-description", default=None, help="Set the next candidate description on an existing state file")
    parser.add_argument("--state-file", type=Path, default=None, help="Path to loop_state.json for step mode")
    parser.add_argument("--triggers-file", type=Path, default=None, help="Path to iteration trigger results JSON for --record-iteration")
    args = parser.parse_args()

    # Step mode 1: --init-split
    if args.init_split:
        if not args.eval_set or not args.skill_path or not args.state_file:
            print("Error: --init-split requires --eval-set, --skill-path, and --state-file", file=sys.stderr)
            sys.exit(1)
        eval_set = json.loads(Path(args.eval_set).read_text(encoding="utf-8-sig"))
        out = init_split_state(
            eval_set=eval_set,
            skill_path=Path(args.skill_path),
            state_file=args.state_file,
            description_override=args.description,
            holdout=args.holdout,
            max_iterations=args.max_iterations,
            runs_per_query=args.runs_per_query,
            trigger_threshold=args.trigger_threshold,
            report_arg=args.report,
        )
        print(json.dumps(out, indent=2))
        sys.exit(0)

    # Step mode 2: --set-next-description (alone)
    if args.set_next_description and not args.record_iteration:
        if not args.state_file or not args.state_file.exists():
            print("Error: --set-next-description requires an existing --state-file", file=sys.stderr)
            sys.exit(1)
        state = json.loads(args.state_file.read_text(encoding="utf-8-sig"))
        clean_desc = args.set_next_description.replace("<", "").replace(">", "").strip()
        state["current_description"] = clean_desc
        args.state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")
        print(json.dumps({"status": "updated", "current_description": clean_desc}, indent=2))
        sys.exit(0)

    # Step mode 3: --record-iteration
    if args.record_iteration:
        if not args.state_file or not args.triggers_file:
            print("Error: --record-iteration requires --state-file and --triggers-file", file=sys.stderr)
            sys.exit(1)
        out = record_iteration_state(
            state_file=args.state_file,
            triggers_file=args.triggers_file,
            next_description=args.set_next_description,
        )
        print(json.dumps(out, indent=2))
        sys.exit(0)

    # Standalone loop mode
    if not args.eval_set or not args.skill_path:
        print("Error: --eval-set and --skill-path are required", file=sys.stderr)
        sys.exit(1)

    eval_set = json.loads(Path(args.eval_set).read_text(encoding="utf-8-sig"))
    skill_path = Path(args.skill_path)

    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    name, _, _ = parse_skill_md(skill_path)

    if args.report != "none":
        if args.report == "auto":
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            live_report_path = Path(tempfile.gettempdir()) / f"skill_description_report_{skill_path.name}_{timestamp}.html"
        else:
            live_report_path = Path(args.report)
        live_report_path.parent.mkdir(parents=True, exist_ok=True)
        live_report_path.write_text(
            "<html><head><meta charset='utf-8'><meta http-equiv='refresh' content='5'></head>"
            "<body><h1>Starting optimization loop...</h1></body></html>",
            encoding="utf-8",
        )
        webbrowser.open(str(live_report_path))
    else:
        live_report_path = None

    if args.results_dir:
        timestamp = time.strftime("%Y-%m-%d_%H%M%S")
        results_dir = Path(args.results_dir) / timestamp
        results_dir.mkdir(parents=True, exist_ok=True)
    else:
        results_dir = None

    log_dir = results_dir / "logs" if results_dir else None

    output = run_loop(
        eval_set=eval_set,
        skill_path=skill_path,
        description_override=args.description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        max_iterations=args.max_iterations,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        holdout=args.holdout,
        model=args.model,
        verbose=args.verbose,
        live_report_path=live_report_path,
        log_dir=log_dir,
        backend=args.backend,
    )

    json_output = json.dumps(output, indent=2)
    print(json_output)
    if results_dir:
        (results_dir / "results.json").write_text(json_output, encoding="utf-8")

    if live_report_path:
        live_report_path.write_text(generate_html(output, auto_refresh=False, skill_name=name), encoding="utf-8")
        print(f"\nReport: {live_report_path}", file=sys.stderr)

    if results_dir and live_report_path:
        (results_dir / "report.html").write_text(
            generate_html(output, auto_refresh=False, skill_name=name),
            encoding="utf-8",
        )

    if results_dir:
        print(f"Results saved to: {results_dir}", file=sys.stderr)


if __name__ == "__main__":
    main()
