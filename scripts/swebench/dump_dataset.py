#!/usr/bin/env python
"""Dump the SWE-bench Lite test split to JSONL (subset of fields).

Run inside the `swebench` conda env (the `datasets` package is a swebench
dependency). Honors HF_ENDPOINT so the download can go through hf-mirror.

Usage:
  python dump_dataset.py --output E:/swe-bench-work/instances.jsonl
"""
import argparse
import json
import os
import re
import sys


def gold_patch_files(patch: str) -> list:
    """File paths touched by the gold patch (for out-of-scope-pollution metrics)."""
    return sorted({m.group(1) for m in re.finditer(r"^\+\+\+ b/(.+)$", patch or "", flags=re.M)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="Output JSONL path")
    args = parser.parse_args()

    # Must be set before `datasets`/huggingface_hub is imported.
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

    from datasets import load_dataset  # noqa: E402  (after env override)

    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    count = 0
    with open(args.output, "w", encoding="utf-8", newline="\n") as handle:
        for row in ds:
            patch = row.get("patch") or ""
            handle.write(
                json.dumps(
                    {
                        "instance_id": row["instance_id"],
                        "repo": row["repo"],
                        "base_commit": row["base_commit"],
                        "problem_statement": row["problem_statement"],
                        "patch_lines": len(patch.splitlines()),
                        "patch_files": gold_patch_files(patch),
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            count += 1
    print(f"wrote {count} instances to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
