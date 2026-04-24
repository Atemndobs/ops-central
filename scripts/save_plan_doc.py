#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path


REQUIRED_DIAGRAMS = [
    "## High-Level Diagram (Mermaid)",
    "## Architecture Diagram (Mermaid)",
    "## Flow Diagram (Mermaid)",
    "## Data Flow Diagram (Mermaid)",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Save an ADR-style plan to the project docs directory."
    )
    parser.add_argument("--title", required=True, help="Feature-oriented plan title")
    parser.add_argument(
        "--input-file",
        help="Optional path to a markdown file. Reads stdin when omitted.",
    )
    return parser.parse_args()


def detect_project_root() -> Path:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True,
            capture_output=True,
            text=True,
        )
        root = result.stdout.strip()
        if root:
            return Path(root)
    except Exception:
        pass
    return Path.cwd()


def load_content(args: argparse.Namespace) -> str:
    if args.input_file:
        return Path(args.input_file).read_text(encoding="utf-8")
    return sys.stdin.read()


def slugify(value: str) -> str:
    slug = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug or "plan"


def ensure_heading(content: str, title: str) -> str:
    stripped = content.lstrip()
    if stripped.startswith("# "):
        return content
    return f"# {title}\n\n{content.lstrip()}"


def ensure_diagram_sections(content: str) -> str:
    updated = content.rstrip()
    for heading in REQUIRED_DIAGRAMS:
        if heading not in updated:
            updated += (
                f"\n\n{heading}\n\n"
                "```mermaid\n"
                "flowchart TD\n"
                '  A["Add diagram details"] --> B["Replace stub before sharing"]\n'
                "```\n"
            )
    return updated + "\n"


def pick_output_path(docs_dir: Path, title: str) -> Path:
    base_name = f"{date.today().isoformat()}-{slugify(title)}-plan"
    candidate = docs_dir / f"{base_name}.md"
    version = 2
    while candidate.exists():
        candidate = docs_dir / f"{base_name}-v{version}.md"
        version += 1
    return candidate


def detect_docs_dir(project_root: Path) -> Path:
    for candidate_name in ("Docs", "docs"):
        candidate = project_root / candidate_name
        if candidate.exists():
            return candidate
    return project_root / "docs"


def main() -> int:
    args = parse_args()
    content = load_content(args)
    if not content.strip():
        raise SystemExit("No plan content provided via stdin or --input-file.")

    project_root = detect_project_root()
    docs_dir = detect_docs_dir(project_root)
    docs_dir.mkdir(parents=True, exist_ok=True)

    normalized = ensure_heading(content, args.title)
    normalized = ensure_diagram_sections(normalized)

    output_path = pick_output_path(docs_dir, args.title)
    output_path.write_text(normalized, encoding="utf-8")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
