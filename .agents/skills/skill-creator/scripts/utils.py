"""Shared utilities for skill-creator scripts."""

import sys
from pathlib import Path


def ensure_utf8_stdio() -> None:
    """Ensure stdout and stderr use UTF-8 encoding on Windows and POSIX."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def parse_skill_md(skill_path: Path) -> tuple[str, str, str]:
    """Parse a SKILL.md file, returning (name, description, full_content)."""
    content = (skill_path / "SKILL.md").read_text(encoding="utf-8-sig")
    lines = content.splitlines()

    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md missing frontmatter (no opening ---)")

    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        raise ValueError("SKILL.md missing frontmatter (no closing ---)")

    name = ""
    description = ""
    frontmatter_lines = lines[1:end_idx]
    i = 0
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("name:"):
            name = line[len("name:"):].strip().strip('"').strip("'")
        elif line.startswith("description:"):
            value = line[len("description:"):].strip()
            # Handle YAML multiline indicators (>, |, >-, |-)
            if value in (">", "|", ">-", "|-"):
                continuation_lines: list[str] = []
                i += 1
                while i < len(frontmatter_lines) and (frontmatter_lines[i].startswith("  ") or frontmatter_lines[i].startswith("\t")):
                    continuation_lines.append(frontmatter_lines[i].strip())
                    i += 1
                description = " ".join(continuation_lines)
                continue
            else:
                description = value.strip('"').strip("'")
        i += 1

    return name, description, content


def update_skill_md_description(skill_path: Path, new_description: str) -> None:
    """Update the description field in SKILL.md frontmatter in-place, preserving body and other fields."""
    skill_file = skill_path / "SKILL.md"
    content = skill_file.read_text(encoding="utf-8-sig")
    newline = "\r\n" if "\r\n" in content else "\n"
    lines = content.splitlines()

    if not lines or lines[0].strip() != "---":
        raise ValueError("SKILL.md missing frontmatter (no opening ---)")

    end_idx = None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            end_idx = i
            break

    if end_idx is None:
        raise ValueError("SKILL.md missing frontmatter (no closing ---)")

    clean_desc = " ".join(new_description.splitlines()).strip()
    frontmatter_lines = lines[1:end_idx]
    new_frontmatter: list[str] = []
    i = 0
    replaced = False
    while i < len(frontmatter_lines):
        line = frontmatter_lines[i]
        if line.startswith("description:"):
            value = line[len("description:"):].strip()
            new_frontmatter.append(f"description: {clean_desc}")
            replaced = True
            if value in (">", "|", ">-", "|-"):
                i += 1
                while i < len(frontmatter_lines) and (
                    frontmatter_lines[i].startswith("  ") or frontmatter_lines[i].startswith("\t")
                ):
                    i += 1
                continue
        else:
            new_frontmatter.append(line)
        i += 1

    if not replaced:
        new_frontmatter.append(f"description: {clean_desc}")

    updated_lines = ["---", *new_frontmatter, "---", *lines[end_idx + 1 :]]
    trailing = newline if content.endswith(("\n", "\r\n")) else ""
    skill_file.write_text(newline.join(updated_lines) + trailing, encoding="utf-8")


