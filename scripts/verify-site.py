#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(reason)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--materialize", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    payload = json.loads((root / "site-manifest.json").read_text(encoding="utf-8"))
    require(payload["schema_version"] == 1, "schema_version")
    files = payload["files"]
    require(isinstance(files, list) and bool(files), "files")
    paths = [row["path"] for row in files]
    require(paths == sorted(paths) and len(paths) == len(set(paths)), "file_order")
    for row in files:
        path = root / row["path"]
        require(path.is_file() and not path.is_symlink(), "file_missing")
        require(digest(path) == row["sha256"], "file_hash")
        require(path.stat().st_size == row["size"], "file_size")
    allowed_meta = {
        "site-manifest.json",
        "README.md",
        ".gitignore",
        "scripts/verify-site.py",
        ".github/workflows/pages.yml",
    }
    actual = {
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.is_file() and ".git" not in path.parts
    }
    require(actual == set(paths) | allowed_meta, "file_set")
    if args.materialize:
        destination = args.materialize.resolve()
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(parents=True)
        for relative in [*paths, "site-manifest.json"]:
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / relative, target)
    print(f"SPO public site verified: {len(paths)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
