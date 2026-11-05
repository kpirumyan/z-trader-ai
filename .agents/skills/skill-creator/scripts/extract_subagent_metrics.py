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


def extract_metrics(transcript_path: Path, run_dir: Path) -> dict:
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
    # Estimate tokens (~4 chars per token) if not explicitly reported in step metadata
    estimated_tokens = max(1, total_chars_processed // 4)

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

    timing_data = {
        "total_tokens": estimated_tokens,
        "duration_ms": duration_ms,
        "total_duration_seconds": round(duration_sec, 2),
        "executor_start": start_iso,
        "executor_end": end_iso,
        "executor_duration_seconds": round(duration_sec, 2),
    }
    timing_path = run_dir / "timing.json"
    timing_path.write_text(json.dumps(timing_data, indent=2), encoding="utf-8")

    metrics_data = {
        "tool_calls": tool_counts,
        "total_tool_calls": total_tool_calls,
        "total_steps": planner_steps,
        "files_created": files_created,
        "errors_encountered": errors_encountered,
        "output_chars": output_chars,
        "transcript_chars": len(transcript_text),
    }
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
    args = parser.parse_args()

    try:
        t_path = find_transcript_path(args.conversation_id, args.transcript, args.app_data_dir)
        summary = extract_metrics(t_path, args.run_dir.resolve())
        print(json.dumps(summary, indent=2))
    except Exception as e:
        print(f"Error extracting subagent metrics: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
