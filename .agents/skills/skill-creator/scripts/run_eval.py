#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes the agent to trigger (read the skill)
for a set of queries. Works on both Linux and Windows.

Supports:
1. Antigravity Native Subagent mode (via `run_loop.py --init-split` / `--record-iteration`, using Antigravity subscription without any API keys)
2. CLI Subscription mode (`claude -p` using Claude Code subscription, cross-platform on Linux & Windows)
3. Optional API key fallback (`GEMINI_API_KEY` / `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` via stdlib `urllib.request`)
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
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from pathlib import Path

from scripts.utils import ensure_utf8_stdio, parse_skill_md


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for .agents/ or .claude/."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".agents").is_dir() or (parent / ".claude").is_dir():
            return parent
    return current


def detect_backend(requested: str = "auto") -> str:
    """Detect which execution backend is available for standalone CLI execution."""
    if requested != "auto":
        return requested
    if shutil.which("claude"):
        return "claude"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic-api"
    if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
        return "gemini-api"
    return "claude"


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


def run_single_query_claude(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
) -> bool:
    """Run a single query via `claude -p` (subscription) and return whether the skill was triggered.

    Uses a cross-platform reader thread + queue instead of Unix-only `select.select`
    so it works on both Linux and Windows.
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
            "-p", query,
            "--output-format", "stream-json",
            "--verbose",
            "--include-partial-messages",
        ]
        if model:
            cmd.extend(["--model", model])

        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=project_root,
            env=env,
        )

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


def _discover_other_skills(project_root: Path, exclude_skill: str) -> list[tuple[str, str]]:
    """Collect (name, description) of other installed skills in workspace for realistic competition."""
    skills: list[tuple[str, str]] = []
    for rel in [".agents/skills", ".claude/skills"]:
        skills_dir = project_root / rel
        if not skills_dir.is_dir():
            continue
        for child in sorted(skills_dir.iterdir()):
            if child.is_dir() and (child / "SKILL.md").exists():
                try:
                    s_name, s_desc, _ = parse_skill_md(child)
                    if s_name and s_name != exclude_skill:
                        skills.append((s_name, s_desc))
                except Exception:
                    pass
    return skills


def run_single_query_api(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
    backend: str = "gemini-api",
) -> bool:
    """Optional API fallback (when running standalone outside subscription CLI/subagents)."""
    other_skills = _discover_other_skills(Path(project_root), skill_name)
    all_skills = [(skill_name, skill_description), *other_skills]
    skills_list_str = "\n".join(
        f"- {name} (.agents/skills/{name}/SKILL.md): {desc}"
        for name, desc in all_skills
    )

    system_instruction = (
        "You are an AI coding assistant with access to specialized skills.\n"
        "If a skill is relevant to the user's task, your FIRST action MUST be to read its SKILL.md "
        "by outputting `<read_skill>SKILL_NAME</read_skill>`. If no skill is needed or the task can be "
        "handled directly without reading a specialized skill, output `<read_skill>NONE</read_skill>`.\n\n"
        f"Available skills:\n{skills_list_str}"
    )

    if backend == "gemini-api":
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("Neither subscription CLI nor GEMINI_API_KEY/GOOGLE_API_KEY found.")
        gemini_model = model if (model and "gemini" in model.lower()) else "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
        payload = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": [{"role": "user", "parts": [{"text": query}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 120},
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
        return f"<read_skill>{skill_name}</read_skill>" in text

    elif backend == "anthropic-api":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not found.")
        anth_model = model if (model and "claude" in model.lower()) else "claude-sonnet-4-20250514"
        url = "https://api.anthropic.com/v1/messages"
        payload = {
            "model": anth_model,
            "max_tokens": 120,
            "system": system_instruction,
            "messages": [{"role": "user", "content": query}],
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        )
        return f"<read_skill>{skill_name}</read_skill>" in text

    raise ValueError(f"Unsupported backend: {backend}")


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
    backend: str = "auto",
) -> bool:
    """Dispatch a single query to the selected backend."""
    resolved = detect_backend(backend)
    if resolved == "claude":
        return run_single_query_claude(
            query, skill_name, skill_description, timeout, project_root, model
        )
    return run_single_query_api(
        query, skill_name, skill_description, timeout, project_root, model, resolved
    )


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
    backend: str = "auto",
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
                    backend,
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
    parser.add_argument(
        "--backend",
        choices=["auto", "claude", "gemini-api", "anthropic-api"],
        default="auto",
        help="Execution backend for standalone CLI usage (default: auto)",
    )
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
        backend=args.backend,
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
