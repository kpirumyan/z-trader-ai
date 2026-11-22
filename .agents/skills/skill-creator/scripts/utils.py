"""Shared utilities for skill-creator scripts."""

import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

_YAML_BLOCK_INDICATORS = (">", "|", ">-", "|-", ">+", "|+")
_YAML_SPECIAL_START = ("#", "-", "?", ":", "!", "&", "*", "[", "]", "{", "}", ",", ">", "|", "'", '"', "%", "@", "`", "~")
_YAML_RESERVED_LITERALS = {"null", "true", "false", "yes", "no", "on", "off", "~"}


def ensure_utf8_stdio() -> None:
    """Ensure stdout and stderr use UTF-8 encoding on Windows and POSIX."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _find_frontmatter_bounds(lines: list[str]) -> int:
    """Return closing --- line index or raise ValueError."""
    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md missing frontmatter (no opening ---)")
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return i
    raise ValueError("SKILL.md missing frontmatter (no closing ---)")


def _unquote_yaml_scalar(value: str) -> str:
    """Unquote a single-line YAML scalar (handling JSON-style double-quoted escapes)."""
    val = value.strip()
    if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
        try:
            parsed = json.loads(val)
            if isinstance(parsed, str):
                return parsed
        except json.JSONDecodeError:
            return val[1:-1]
    if len(val) >= 2 and val[0] == "'" and val[-1] == "'":
        return val[1:-1].replace("''", "'")
    return val


def format_yaml_scalar(value: str) -> str:
    """Format a single-line string safely as a valid YAML scalar (quoting if needed)."""
    clean = " ".join(value.splitlines()).strip()
    needs_quoting = (
        not clean
        or clean.lower() in _YAML_RESERVED_LITERALS
        or clean.startswith(_YAML_SPECIAL_START)
        or clean.endswith(":")
        or ": " in clean
        or " #" in clean
        or any(ch in clean for ch in ('"', "'", "\\", "[", "]", "{", "}", "\t"))
        or re.fullmatch(r"[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?", clean) is not None
    )
    if needs_quoting:
        return json.dumps(clean, ensure_ascii=False)
    return clean


def _find_description_span(frontmatter_lines: list[str]) -> tuple[int, int] | None:
    """Return (start_idx, end_idx_exclusive) of the description field in frontmatter_lines."""
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("description:"):
            start = i
            value = line[len("description:"):].strip()
            i += 1
            if value in _YAML_BLOCK_INDICATORS or not value:
                while i < len(frontmatter_lines) and (
                    frontmatter_lines[i].startswith((" ", "\t")) or not frontmatter_lines[i].strip()
                ):
                    i += 1
                # Don't consume trailing blank lines right before the next key
                while i > start + 1 and not frontmatter_lines[i - 1].strip():
                    i -= 1
            else:
                # Handle wrapped plain/quoted multiline scalars indented on continuation lines
                while i < len(frontmatter_lines) and frontmatter_lines[i].startswith((" ", "\t")):
                    i += 1
            return start, i
        i += 1
    return None


def extract_raw_description_block(skill_path: Path) -> list[str] | None:
    """Return the exact raw frontmatter lines for `description:` so it can be restored verbatim."""
    content = (skill_path / "SKILL.md").read_text(encoding="utf-8-sig")
    lines = content.splitlines()
    end_idx = _find_frontmatter_bounds(lines)
    frontmatter_lines = lines[1:end_idx]
    span = _find_description_span(frontmatter_lines)
    if span is None:
        return None
    return frontmatter_lines[span[0] : span[1]]


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Parse a SKILL.md file, returning (name, description, full_content)."""
    content = (skill_path / "SKILL.md").read_text(encoding="utf-8-sig")
    lines = content.splitlines()
    end_idx = _find_frontmatter_bounds(lines)
    frontmatter_lines = lines[1:end_idx]

    if yaml is not None:
        try:
            fm = yaml.safe_load("\n".join(frontmatter_lines))
            if isinstance(fm, dict):
                name = str(fm.get("name") or "").strip()
                desc_val = fm.get("description")
                description = str(desc_val).strip() if desc_val is not None else ""
                return name, description, content
        except Exception:
            pass

    name = ""
    description = ""
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("name:"):
            name = _unquote_yaml_scalar(line[len("name:"):])
        elif line.startswith("description:"):
            value = line[len("description:"):].strip()
            if value in _YAML_BLOCK_INDICATORS:
                continuation_lines: list[str] = []
                i += 1
                while i < len(frontmatter_lines) and (
                    frontmatter_lines[i].startswith((" ", "\t")) or not frontmatter_lines[i].strip()
                ):
                    if frontmatter_lines[i].strip():
                        continuation_lines.append(frontmatter_lines[i].strip())
                    i += 1
                description = " ".join(continuation_lines)
                continue
            else:
                description = _unquote_yaml_scalar(value)
        i += 1

    return name, description, content


def update_skill_md_description(
    skill_path: Path,
    new_description: str,
    raw_lines: list[str] | None = None,
) -> None:
    """Update the description field in SKILL.md frontmatter in-place, preserving body and other fields.

    When `raw_lines` is provided (e.g. restoring an original multiline block scalar), those exact
    frontmatter lines are spliced back verbatim. Otherwise `new_description` is safely YAML-encoded.
    """
    skill_file = skill_path / "SKILL.md"
    content = skill_file.read_text(encoding="utf-8-sig")
    newline = "\r\n" if "\r\n" in content else "\n"
    lines = content.splitlines()
    end_idx = _find_frontmatter_bounds(lines)

    frontmatter_lines = lines[1:end_idx]
    replacement_lines = (
        list(raw_lines)
        if raw_lines
        else [f"description: {format_yaml_scalar(new_description)}"]
    )

    span = _find_description_span(frontmatter_lines)
    if span is not None:
        new_frontmatter = (
            frontmatter_lines[: span[0]]
            + replacement_lines
            + frontmatter_lines[span[1] :]
        )
    else:
        new_frontmatter = [*frontmatter_lines, *replacement_lines]

    updated_lines = ["---", *new_frontmatter, "---", *lines[end_idx + 1 :]]
    trailing = newline if content.endswith(("\n", "\r\n")) else ""
    skill_file.write_text(newline.join(updated_lines) + trailing, encoding="utf-8")


