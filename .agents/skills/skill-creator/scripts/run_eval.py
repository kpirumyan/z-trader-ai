#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes the agent to trigger (read the skill)
for a set of queries. Works on both Linux and Windows.
"""

import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from pathlib import Path

from scripts.extract_subagent_metrics import find_transcript_path
from scripts.utils import ensure_utf8_stdio, parse_skill_md


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for .agents/ or .claude/."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".agents").is_dir() or (parent / ".claude").is_dir():
            return parent
    return current


def _enqueue_lines(stream, line_queue: "queue.Queue[str | None]") -> None:
    """Cross-platform background reader thread for subprocess stdout (works on Linux & Windows)."""
    try:
        for raw_line in iter(stream.readline, b""):
            if not raw_line:
                break
            line_queue.put(raw_line.decode("utf-8", errors="replace"))
    except Exception:
        pass
    finally:
        line_queue.put(None)


def check_subagent_transcript_trigger(
    conversation_id: str,
    skill_name: str,
    app_data_dir: Path | None = None,
    transcript_path: Path | None = None,
) -> bool:
    """Check whether an Antigravity subagent triggered the skill on its first action.

    Mirrors the exact 1-to-1 logic of `run_single_query`: inspects the first
    assistant turn (`PLANNER_RESPONSE`) in the subagent's JSONL transcript and
    returns True if and only if the first tool call reads `<skill_name>/SKILL.md`.
    """
    t_path = find_transcript_path(conversation_id, transcript_path, app_data_dir)
    lines = t_path.read_text(encoding="utf-8", errors="replace").splitlines()

    target_suffix = f"/{skill_name.lower()}/skill.md"

    for raw_line in lines:
        raw_line = raw_line.strip()
        if not raw_line:
            continue
        try:
            step = json.loads(raw_line)
        except json.JSONDecodeError:
            continue

        if step.get("type") != "PLANNER_RESPONSE":
            continue

        tool_calls = step.get("tool_calls") or []
        if not tool_calls:
            return False

        first_call = tool_calls[0]
        tool_name = first_call.get("name") or first_call.get("tool_name") or ""
        tool_args = first_call.get("arguments") or first_call.get("args") or first_call.get("input") or {}
        if isinstance(tool_args, str):
            try:
                tool_args = json.loads(tool_args)
            except json.JSONDecodeError:
                tool_args = {}

        if tool_name in ("read_file", "Read", "view_file"):
            raw_path = (
                tool_args.get("Path")
                or tool_args.get("file_path")
                or tool_args.get("path")
                or ""
            )
            path_str = str(raw_path).strip()
            if len(path_str) >= 2 and path_str[0] == '"' and path_str[-1] == '"':
                try:
                    decoded = json.loads(path_str)
                    if isinstance(decoded, str):
                        path_str = decoded
                except json.JSONDecodeError:
                    path_str = path_str[1:-1]
            norm_path = path_str.strip().strip("'").replace("\\", "/").lower()
            while "//" in norm_path:
                norm_path = norm_path.replace("//", "/")
            return norm_path.endswith(target_suffix)
        if tool_name == "Skill":
            skill_arg = str(tool_args.get("skill") or "").strip().strip('"').strip("'").lower()
            return skill_name.lower() in skill_arg

        return False

    return False


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
) -> bool:
    """Run a single query and return whether the skill was triggered.

    Creates a command file in .claude/commands/ so it is discovered, then runs
    `claude -p` with the raw query and checks whether the first tool call
    invokes the skill. Uses a cross-platform reader thread + queue instead of
    Unix-only `select.select` so it works on both Linux and Windows.
    """
    unique_id = uuid.uuid4().hex[:8]
    clean_name = f"{skill_name}-skill-{unique_id}"
    project_commands_dir = Path(project_root) / ".claude" / "commands"
    command_file = project_commands_dir / f"{clean_name}.md"

    try:
        project_commands_dir.mkdir(parents=True, exist_ok=True)
        indented_desc = "\n  ".join(skill_description.split("\n"))
        command_content = (
            f"---\n"
            f"description: |\n"
            f"  {indented_desc}\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"This skill handles: {skill_description}\n"
        )
        command_file.write_text(command_content, encoding="utf-8")

        claude_bin = shutil.which("claude") or "claude"
        cmd = [
            claude_bin,
            "-p",
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if model:
            cmd.extend(["--model", model])

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=project_root,
            env=env,
        )
        if process.stdin is not None:
            try:
                process.stdin.write(query.encode("utf-8"))
                process.stdin.close()
            except OSError:
                pass

        line_queue: "queue.Queue[str | None]" = queue.Queue()
        reader_thread = threading.Thread(
            target=_enqueue_lines,
            args=(process.stdout, line_queue),
            daemon=True,
        )
        reader_thread.start()

        triggered = False
        start_time = time.time()
        pending_tool_name = None
        accumulated_json = ""

        try:
            while time.time() - start_time < timeout:
                try:
                    line = line_queue.get(timeout=0.5)
                except queue.Empty:
                    if process.poll() is not None and line_queue.empty():
                        break
                    continue

                if line is None:
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue

                # Early detection via stream events
                if event.get("type") == "stream_event":
                    se = event.get("event", {})
                    se_type = se.get("type", "")

                    if se_type == "content_block_start":
                        cb = se.get("content_block", {})
                        if cb.get("type") == "tool_use":
                            tool_name = cb.get("name", "")
                            if tool_name in ("Skill", "Read"):
                                pending_tool_name = tool_name
                                accumulated_json = ""
                            else:
                                return False

                    elif se_type == "content_block_delta" and pending_tool_name:
                        delta = se.get("delta", {})
                        if delta.get("type") == "input_json_delta":
                            accumulated_json += delta.get("partial_json", "")
                            if clean_name in accumulated_json:
                                return True

                    elif se_type in ("content_block_stop", "message_stop"):
                        if pending_tool_name:
                            return clean_name in accumulated_json
                        if se_type == "message_stop":
                            return False

                # Fallback: full assistant message
                elif event.get("type") == "assistant":
                    message = event.get("message", {})
                    for content_item in message.get("content", []):
                        if content_item.get("type") != "tool_use":
                            continue
                        tool_name = content_item.get("name", "")
                        tool_input = content_item.get("input", {})
                        if tool_name == "Skill" and clean_name in tool_input.get("skill", ""):
                            triggered = True
                        elif tool_name == "Read" and clean_name in tool_input.get("file_path", ""):
                            triggered = True
                        return triggered

                elif event.get("type") == "result":
                    return triggered
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

        return triggered
    finally:
        if command_file.exists():
            try:
                command_file.unlink()
            except OSError:
                pass


def score_trigger_counts(
    eval_set: list[dict],
    query_triggers: dict[str, list[bool]],
    skill_name: str,
    description: str,
    trigger_threshold: float = 0.5,
) -> dict:
    """Compute structured eval summary from per-query boolean trigger lists."""
    results = []
    for item in eval_set:
        query = item["query"]
        triggers = query_triggers.get(query, [False])
        trigger_rate = sum(triggers) / len(triggers) if triggers else 0.0
        should_trigger = item["should_trigger"]
        if should_trigger:
            did_pass = trigger_rate >= trigger_threshold
        else:
            did_pass = trigger_rate < trigger_threshold
        results.append({
            "query": query,
            "should_trigger": should_trigger,
            "trigger_rate": trigger_rate,
            "triggers": sum(triggers),
            "runs": len(triggers),
            "pass": did_pass,
        })

    passed = sum(1 for r in results if r["pass"])
    total = len(results)

    return {
        "skill_name": skill_name,
        "description": description,
        "results": results,
        "summary": {
            "total": total,
            "passed": passed,
            "failed": total - passed,
        },
    }


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
) -> dict:
    """Run the full eval set and return results (works on both Linux and Windows)."""
    # Use ThreadPoolExecutor on Windows to avoid multiprocessing spawn overhead with subprocesses
    executor_cls = ThreadPoolExecutor if sys.platform == "win32" else ProcessPoolExecutor

    with executor_cls(max_workers=num_workers) as executor:
        future_to_info = {}
        for item in eval_set:
            for run_idx in range(runs_per_query):
                future = executor.submit(
                    run_single_query,
                    item["query"],
                    skill_name,
                    description,
                    timeout,
                    str(project_root),
                    model,
                )
                future_to_info[future] = (item, run_idx)

        query_triggers: dict[str, list[bool]] = {}
        for future in as_completed(future_to_info):
            item, _ = future_to_info[future]
            query = item["query"]
            if query not in query_triggers:
                query_triggers[query] = []
            try:
                query_triggers[query].append(future.result())
            except Exception as e:
                print(f"Warning: query failed: {e}", file=sys.stderr)
                query_triggers[query].append(False)

    return score_trigger_counts(
        eval_set=eval_set,
        query_triggers=query_triggers,
        skill_name=skill_name,
        description=description,
        trigger_threshold=trigger_threshold,
    )


def main():
    ensure_utf8_stdio()
    parser = argparse.ArgumentParser(description="Run trigger evaluation for a skill description")
    parser.add_argument("--eval-set", required=True, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=10, help="Number of parallel workers")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout per query in seconds")
    parser.add_argument("--runs-per-query", type=int, default=3, help="Number of runs per query")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Trigger rate threshold")
    parser.add_argument("--model", default=None, help="Model identifier")
    parser.add_argument("--verbose", action="store_true", help="Print progress to stderr")
    args = parser.parse_args()

    eval_set = json.loads(Path(args.eval_set).read_text(encoding="utf-8-sig"))
    skill_path = Path(args.skill_path)

    if not (skill_path / "SKILL.md").exists():
        print(f"Error: No SKILL.md found at {skill_path}", file=sys.stderr)
        sys.exit(1)

    name, original_description, _ = parse_skill_md(skill_path)
    description = args.description or original_description
    project_root = find_project_root()

    if args.verbose:
        print(f"Evaluating: {description}", file=sys.stderr)

    output = run_eval(
        eval_set=eval_set,
        skill_name=name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
    )

    if args.verbose:
        summary = output["summary"]
        print(f"Results: {summary['passed']}/{summary['total']} passed", file=sys.stderr)
        for r in output["results"]:
            status = "PASS" if r["pass"] else "FAIL"
            rate_str = f"{r['triggers']}/{r['runs']}"
            print(f"  [{status}] rate={rate_str} expected={r['should_trigger']}: {r['query'][:70]}", file=sys.stderr)

    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
