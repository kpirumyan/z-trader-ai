#!/usr/bin/env python3
"""Extract timing.json, outputs/metrics.json, and transcript.md from an Antigravity subagent transcript.

Works on both Linux and Windows with zero external dependencies (stdlib only).
Reads `<appDataDir>/brain/<conversation-id>/.system_generated/logs/transcript.jsonl`
(or an explicit `--transcript` file) and writes the exact files expected by
`agents/grader.md`, `agents/analyzer.md`, and `scripts/aggregate_benchmark.py`.

Usage:
    python -m scripts.extract_subagent_metrics --conversation-id <id> --run-dir <path>
    python -m scripts.extract_subagent_metrics --transcript <path/to/transcript.jsonl> --run-dir <path>
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from scripts.utils import ensure_utf8_stdio

METADATA_FILES = {"transcript.md", "user_notes.md", "metrics.json"}


def find_transcript_path(conversation_id: str | None, transcript_arg: Path | None, app_data_dir: Path | None) -> Path:
    """Resolve the path to transcript.jsonl across Windows and Linux."""
    if transcript_arg:
        if transcript_arg.exists():
            return transcript_arg
        raise FileNotFoundError(f"Transcript file not found: {transcript_arg}")

    if not conversation_id:
        raise ValueError("Either --conversation-id or --transcript must be provided")

    candidates: list[Path] = []
    if app_data_dir:
        candidates.append(app_data_dir)
    candidates.append(Path.home() / ".gemini" / "antigravity")

    for base in candidates:
        full_path = base / "brain" / conversation_id / ".system_generated" / "logs" / "transcript_full.jsonl"
        compact_path = base / "brain" / conversation_id / ".system_generated" / "logs" / "transcript.jsonl"
        if full_path.exists():
            return full_path
        if compact_path.exists():
            return compact_path

    raise FileNotFoundError(
        f"Could not find transcript.jsonl for conversation {conversation_id} in "
        f"{[str(c) for c in candidates]}"
    )


def parse_iso_timestamp(ts: str) -> datetime | None:
    """Parse ISO 8601 timestamp string into a datetime object."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def _step_token_usage(step: dict) -> tuple[bool, int, int, int, int]:
    """Extract real (found, input, cache_read, cache_creation, output) tokens from a transcript step."""
    usage = step.get("usage") if isinstance(step.get("usage"), dict) else {}

    def _pick(*keys: str) -> int | None:
        for src in (step, usage):
            for k in keys:
                val = src.get(k)
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    return int(val)
        return None

    inp = _pick("input_tokens", "prompt_tokens")
    cache_read = _pick("cache_read_tokens", "cache_read_input_tokens", "cached_content_token_count")
    cache_create = _pick("cache_creation_tokens", "cache_creation_input_tokens")
    out = _pick("output_tokens", "completion_tokens", "candidates_token_count")

    found = any(v is not None for v in (inp, cache_read, cache_create, out))
    return (
        found,
        max(0, inp or 0),
        max(0, cache_read or 0),
        max(0, cache_create or 0),
        max(0, out or 0),
    )


def _matches_forbidden_skill(tool_name: str, tool_args: dict, forbidden_skill: str) -> str | None:
    """Return a short evidence string if a tool call accessed the forbidden skill, else None."""
    fs = forbidden_skill.strip().lower()
    if not fs:
        return None

    if isinstance(tool_args, str):
        try:
            tool_args = json.loads(tool_args)
        except json.JSONDecodeError:
            tool_args = {}
    if not isinstance(tool_args, dict):
        return None

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
        if (
            norm_path.endswith(f"/{fs}/skill.md")
            or f"/skills/{fs}/" in norm_path
        ):
            return f"{tool_name}({path_str})"
    elif tool_name == "Skill":
        skill_arg = str(tool_args.get("skill") or "").strip().strip('"').strip("'").lower()
        if fs in skill_arg:
            return f"Skill({skill_arg})"
    return None


def extract_metrics(
    transcript_path: Path,
    run_dir: Path,
    forbidden_skill: str | None = None,
) -> dict:
    """Parse Antigravity JSONL transcript and write timing.json, metrics.json, and transcript.md."""
    lines = transcript_path.read_text(encoding="utf-8", errors="replace").splitlines()
    steps = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            steps.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    timestamps: list[tuple[datetime, str]] = []
    tool_counts: dict[str, int] = {}
    total_tool_calls = 0
    planner_steps = 0
    errors_encountered = 0
    total_chars_processed = 0
    has_real_tokens = False
    total_input_tokens = 0
    total_cache_read_tokens = 0
    total_cache_creation_tokens = 0
    total_output_tokens = 0
    executor_model = ""
    leak_evidence: list[str] = []
    eval_prompt = ""
    md_sections: list[str] = ["# Execution Transcript\n"]

    for idx, step in enumerate(steps):
        created_at = step.get("created_at", "")
        dt = parse_iso_timestamp(created_at)
        if dt:
            timestamps.append((dt, created_at))

        step_type = step.get("type", "")
        status = step.get("status", "")
        content = step.get("content", "") or ""
        thinking = step.get("thinking", "") or ""
        tool_calls = step.get("tool_calls", []) or []

        total_chars_processed += len(content) + len(thinking) + len(json.dumps(tool_calls))

        found_tok, inp_t, cr_t, cc_t, out_t = _step_token_usage(step)
        if found_tok:
            has_real_tokens = True
            total_input_tokens += inp_t
            total_cache_read_tokens += cr_t
            total_cache_creation_tokens += cc_t
            total_output_tokens += out_t

        if step.get("model"):
            executor_model = str(step["model"])

        if status == "ERROR":
            errors_encountered += 1

        if step_type == "USER_INPUT" and not eval_prompt and content:
            eval_prompt = content.strip()
            md_sections.append(f"## Eval Prompt\n\n{eval_prompt}\n")
        elif step_type == "PLANNER_RESPONSE":
            planner_steps += 1
            md_sections.append(f"## Step {planner_steps}\n")
            if thinking:
                md_sections.append(f"**Thinking:**\n{thinking.strip()}\n")
            if tool_calls:
                for tc in tool_calls:
                    t_name = tc.get("name") or tc.get("tool_name") or "unknown"
                    t_args = tc.get("arguments") or tc.get("args") or tc.get("input") or {}
                    tool_counts[t_name] = tool_counts.get(t_name, 0) + 1
                    total_tool_calls += 1
                    if forbidden_skill:
                        hit = _matches_forbidden_skill(t_name, t_args, forbidden_skill)
                        if hit:
                            leak_evidence.append(f"Step {planner_steps}: {hit}")
                    args_str = json.dumps(t_args, ensure_ascii=False)
                    if len(args_str) > 500:
                        args_str = args_str[:500] + "..."
                    md_sections.append(f"- **Tool `{t_name}`**: `{args_str}`")
                md_sections.append("")
            if content:
                md_sections.append(f"**Response:**\n{content.strip()}\n")

    # Calculate timing
    if len(timestamps) >= 2:
        start_dt, start_iso = timestamps[0]
        end_dt, end_iso = timestamps[-1]
        duration_sec = max(0.0, (end_dt - start_dt).total_seconds())
    elif len(timestamps) == 1:
        start_iso = end_iso = timestamps[0][1]
        duration_sec = 0.0
    else:
        start_iso = end_iso = ""
        duration_sec = 0.0

    duration_ms = int(round(duration_sec * 1000))
    if has_real_tokens:
        total_tokens = (
            total_input_tokens
            + total_cache_read_tokens
            + total_cache_creation_tokens
            + total_output_tokens
        )
        token_source = "transcript"
    else:
        total_tokens = max(1, total_chars_processed // 4)
        token_source = "estimated"

    outputs_dir = run_dir / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    output_chars = 0
    files_created: list[str] = []
    for f in sorted(outputs_dir.rglob("*")):
        if f.is_file() and f.name not in METADATA_FILES:
            files_created.append(str(f.relative_to(outputs_dir)).replace("\\", "/"))
            try:
                output_chars += len(f.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                output_chars += f.stat().st_size

    transcript_text = "\n".join(md_sections)
    transcript_md_path = run_dir / "transcript.md"
    transcript_md_path.write_text(transcript_text, encoding="utf-8")

    timing_data: dict = {
        "total_tokens": total_tokens,
        "token_source": token_source,
        "duration_ms": duration_ms,
        "total_duration_seconds": round(duration_sec, 2),
        "executor_start": start_iso,
        "executor_end": end_iso,
        "executor_duration_seconds": round(duration_sec, 2),
    }
    if has_real_tokens:
        timing_data["input_tokens"] = total_input_tokens
        timing_data["cache_read_tokens"] = total_cache_read_tokens
        if total_cache_creation_tokens:
            timing_data["cache_creation_tokens"] = total_cache_creation_tokens
        timing_data["output_tokens"] = total_output_tokens
    if executor_model:
        timing_data["executor_model"] = executor_model

    timing_path = run_dir / "timing.json"
    timing_path.write_text(json.dumps(timing_data, indent=2), encoding="utf-8")

    metrics_data: dict = {
        "tool_calls": tool_counts,
        "total_tool_calls": total_tool_calls,
        "total_steps": planner_steps,
        "files_created": files_created,
        "errors_encountered": errors_encountered,
        "output_chars": output_chars,
        "transcript_chars": len(transcript_text),
    }
    if forbidden_skill:
        metrics_data["forbidden_skill"] = forbidden_skill
        metrics_data["skill_leak_detected"] = bool(leak_evidence)
        if leak_evidence:
            metrics_data["skill_leak_evidence"] = leak_evidence
            print(
                f"WARNING: Baseline skill leak detected! Subagent accessed forbidden skill "
                f"'{forbidden_skill}': {'; '.join(leak_evidence)}",
                file=sys.stderr,
            )

    metrics_path = outputs_dir / "metrics.json"
    metrics_path.write_text(json.dumps(metrics_data, indent=2), encoding="utf-8")

    return {
        "timing_path": str(timing_path),
        "metrics_path": str(metrics_path),
        "transcript_path": str(transcript_md_path),
        "timing": timing_data,
        "metrics": metrics_data,
    }


def main() -> None:
    ensure_utf8_stdio()
    parser = argparse.ArgumentParser(
        description="Extract timing.json, metrics.json, and transcript.md from an Antigravity subagent"
    )
    parser.add_argument("--conversation-id", default=None, help="Subagent conversationId returned by invoke_subagent")
    parser.add_argument("--transcript", type=Path, default=None, help="Explicit path to transcript.jsonl")
    parser.add_argument("--app-data-dir", type=Path, default=None, help="Optional Antigravity appDataDir override")
    parser.add_argument("--run-dir", type=Path, required=True, help="Target run directory (e.g. eval-0/with_skill)")
    parser.add_argument(
        "--forbidden-skill",
        default=None,
        help="Optional skill name that should NOT be read (e.g. for without_skill baseline runs); warns if accessed",
    )
    args = parser.parse_args()

    try:
        t_path = find_transcript_path(args.conversation_id, args.transcript, args.app_data_dir)
        summary = extract_metrics(t_path, args.run_dir.resolve(), forbidden_skill=args.forbidden_skill)
        print(json.dumps(summary, indent=2))
    except Exception as e:
        print(f"Error extracting subagent metrics: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
