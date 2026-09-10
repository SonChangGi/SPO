#!/usr/bin/env python3
"""Verify one derived static website using only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from datetime import date
from pathlib import Path
from typing import Any

ENTRY_FILES = {"index.html", "app.js", "analytics.mjs", "styles.css", "research.json"}
COMPATIBILITY_PAGES = {
    f"{folder}/{name}.html"
    for folder in (
        "research",
        "report",
        "sensitivity/fred",
        "sensitivity/cash",
        "sensitivity/universe",
    )
    for name in ("index", "content")
}
WEB_FILES = ENTRY_FILES | COMPATIBILITY_PAGES
PACKAGE_FILES = WEB_FILES | {"manifest.json"}
CAPITALS = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000]
COST_BPS = list(range(101))
_TOP = {
    "schema",
    "data_as_of",
    "generated_at",
    "source",
    "return_basis",
    "assets",
    "models",
    "feature_count",
    "training_samples",
    "prediction_sessions",
    "default_cost_bps",
    "execution",
    "default_model",
    "code_version",
    "universe_id",
    "quality",
    "neural",
    "diagnostics",
    "order_presets",
    "content_sha256",
}
_ROW = {
    "signal",
    "entry",
    "exit",
    "gross",
    "turnover",
    "regret",
    "weights",
    "pretrade",
    "marks",
    "dates",
    "adv20",
    "order_preview",
}
_FORBIDDEN = {
    "price",
    "prices",
    "lastprice",
    "open",
    "close",
    "high",
    "low",
    "volume",
    "tradingvalue",
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "accesstoken",
    "accesskey",
    "authkey",
    "authtoken",
    "bearertoken",
    "clientid",
    "clientsecret",
    "credentials",
    "localpath",
    "providerpath",
    "rawpayload",
    "rawsha256",
    "rawdata",
    "rawobservations",
    "rawrows",
    "providerresponse",
    "responsebody",
    "responsepayload",
    "requestheaders",
    "requesturl",
    "responseheaders",
    "fits",
    "checkpoint",
    "checkpoints",
    "statedict",
    "tensor",
    "tensors",
    "featurematrix",
    "trainingindices",
    "epochhistory",
}
_SECRET = (
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}", re.IGNORECASE),
    re.compile(
        r"(?:api[_-]?key|password|secret|authorization|access[_-]?token)"
        r"[\"']?\s*(?:=|:)\s*[\"']?[^\s\"'<>]{6,}",
        re.IGNORECASE,
    ),
    re.compile(r"/(?:Users|home|private/var|tmp)/[^\s'\"<]+|file://|[A-Za-z]:\\Users\\"),
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def _keys(value: dict[str, Any], allowed: set[str], *, exact: bool = True) -> None:
    _require(isinstance(value, dict), "Expected a JSON object.")
    _require(
        set(value) == allowed if exact else set(value) <= allowed, "Unexpected payload fields."
    )


def _privacy(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            identifier = re.sub(r"[^a-z0-9]", "", key.casefold())
            _require(identifier not in _FORBIDDEN, "Prohibited field in website data.")
            _privacy(child)
    elif isinstance(value, list):
        for child in value:
            _privacy(child)
    elif isinstance(value, str):
        _require(not any(p.search(value) for p in _SECRET), "Private or secret-like website data.")
    elif isinstance(value, (int, float)):
        _require(math.isfinite(value), "Non-finite website data.")


def _vector(value: Any, length: int, *, nonnegative: bool = True) -> None:
    _require(isinstance(value, list) and len(value) == length, "Invalid vector dimensions.")
    _require(
        all(
            type(v) in (int, float) and math.isfinite(v) and (not nonnegative or v >= 0)
            for v in value
        ),
        "Invalid vector values.",
    )


def _verify_diagnostics(value: dict[str, Any], model_ids: set[str]) -> None:
    _keys(
        value,
        {"covariance", "family", "family_cost_bps", "family_period", "covariance_cutoff"},
        exact=False,
    )
    if "covariance" in value:
        _keys(value["covariance"], {"expanding", "rolling", "ewma", "shrinkage"})
        for risk in value["covariance"].values():
            _keys(
                risk,
                {
                    "effective_observations",
                    "matrix_sha256",
                    "latest_known_at",
                    "volatility_by_model",
                },
            )
            _keys(risk["volatility_by_model"], model_ids)
    if "family" in value:
        family = value["family"]
        _keys(
            family,
            {
                "method",
                "scope",
                "family_size",
                "block_length",
                "resamples",
                "confidence",
                "desired_power_for_normal_mde",
                "mde_scope",
                "minimum_observations",
                "seed",
                "comparisons",
            },
        )
        _require(
            len(family["comparisons"]) == family["family_size"], "Comparison family size mismatch."
        )
        for key, comparison in family["comparisons"].items():
            _require(
                len(key.split("__")) == 2 and set(key.split("__")) <= model_ids,
                "Unknown comparison model.",
            )
            _keys(
                comparison,
                {
                    "observations",
                    "estimate_bps",
                    "lower_bps",
                    "upper_bps",
                    "bootstrap_standard_error_bps",
                    "approximate_mde_bps",
                    "economic_minimum_bps",
                    "raw_p_value",
                    "holm_adjusted_p_value",
                    "economic_holm_adjusted_p_value",
                    "holm_reject_zero",
                    "economically_supported",
                },
            )


def verify_web_deployment(root: Path) -> dict[str, Any]:
    """Reject unknown files, unbound bytes, provider prices, and incomplete UI data."""
    _require(root.is_dir() and not root.is_symlink(), "Website path must be a regular directory.")
    entries = list(root.rglob("*"))
    children = [p for p in entries if p.is_file()]
    directories = {
        str(parent) for name in PACKAGE_FILES for parent in Path(name).parents if str(parent) != "."
    }
    _require(
        {p.relative_to(root).as_posix() for p in children} == PACKAGE_FILES,
        "Website file allowlist mismatch.",
    )
    _require(not any(p.is_symlink() for p in entries), "Only regular website files are allowed.")
    _require(
        all(p.is_file() or p.is_dir() for p in entries),
        "Special website files are prohibited.",
    )
    _require(
        all(not p.is_dir() or p.relative_to(root).as_posix() in directories for p in entries),
        "Unexpected website directory.",
    )
    texts = {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in children}
    for text in texts.values():
        _require(
            not any(p.search(text) for p in _SECRET), "Private or secret-like website content."
        )
    manifest = json.loads(texts["manifest.json"])
    _keys(
        manifest,
        {
            "schema",
            "publication_scope",
            "files",
            "data_sha256",
            "source_version",
            "source_preview_manifest_sha256",
            "source_data_sha256",
            "source_content_sha256",
        },
    )
    _require(
        manifest["schema"] == "spo_web_deployment_manifest_v1", "Unsupported website manifest."
    )
    _require(
        manifest["publication_scope"] == "derived_analytics_and_simulated_orders",
        "Invalid publication scope.",
    )
    _keys(manifest["files"], WEB_FILES)
    for name, expected in manifest["files"].items():
        _require(
            hashlib.sha256((root / name).read_bytes()).hexdigest() == expected,
            "Website file hash mismatch.",
        )
    _require(
        manifest["data_sha256"] == manifest["files"]["research.json"], "Research hash mismatch."
    )
    for field in ("source_preview_manifest_sha256", "source_data_sha256", "source_content_sha256"):
        _require(bool(re.fullmatch(r"[a-f0-9]{64}", manifest[field])), "Invalid source binding.")
    data = json.loads(texts["research.json"])
    _keys(data, _TOP)
    _privacy(data)
    _privacy(manifest)
    _require(data["schema"] == "spo_local_workspace_v1", "Unsupported website data schema.")
    _require(data["code_version"] == manifest["source_version"], "Source version mismatch.")
    without_hash = {k: v for k, v in data.items() if k != "content_sha256"}
    expected = hashlib.sha256(
        json.dumps(without_hash, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    _require(expected == data["content_sha256"], "Website content hash mismatch.")
    _require(
        data["order_presets"] == {"capitals": CAPITALS, "cost_bps": COST_BPS},
        "Order preset grid mismatch.",
    )
    _require(data["assets"] and data["models"], "Website has no available research data.")
    for asset in data["assets"]:
        _keys(asset, {"id", "name", "sector", "sector_id"})
    asset_count = len(data["assets"])
    _require(len({a["id"] for a in data["assets"]}) == asset_count, "Duplicate assets.")
    _keys(
        data["quality"],
        {"labels_unavailable", "delayed_entries", "overlapping_execution_intervals"},
    )
    neural = data["neural"]
    if neural is not None:
        _keys(
            neural,
            {"architecture", "adaptation", "lookback", "seeds", "ensemble", "refit", "fit_count"},
        )
    model_ids = {m["id"] for m in data["models"]}
    _require(
        len(model_ids) == len(data["models"]) and data["default_model"] in model_ids,
        "Invalid strategy set.",
    )
    _verify_diagnostics(data["diagnostics"], model_ids)
    common_periods = None
    for model in data["models"]:
        _keys(model, {"id", "label", "kind", "rows"})
        _require(bool(model["rows"]), "Strategy has no available observations.")
        periods = [(r["entry"], r["exit"]) for r in model["rows"]]
        _require(common_periods is None or periods == common_periods, "Strategy periods differ.")
        common_periods = periods
        for index, row in enumerate(model["rows"]):
            _keys(row, _ROW)
            _require(
                date.fromisoformat(row["signal"])
                < date.fromisoformat(row["entry"])
                < date.fromisoformat(row["exit"]),
                "Invalid execution interval.",
            )
            _require(
                index == 0 or periods[index - 1][1] == row["entry"],
                "Execution intervals must join without overlap.",
            )
            for field in ("weights", "pretrade", "adv20"):
                _vector(row[field], asset_count)
            for field in ("weights", "pretrade"):
                _require(
                    math.isclose(sum(row[field]), 1, abs_tol=1e-8),
                    "Portfolio weights must sum to one.",
                )
            _require(
                len(row["dates"]) >= 2
                and row["dates"] == sorted(set(row["dates"]))
                and row["dates"][0] == row["entry"]
                and row["dates"][-1] == row["exit"],
                "Invalid daily valuation dates.",
            )
            _vector(row["marks"], len(row["dates"]))
            _require(
                math.isclose(row["marks"][0], 1, abs_tol=1e-10)
                and math.isclose(row["marks"][-1], 1 + row["gross"], abs_tol=1e-10),
                "Daily and interval NAV do not reconcile.",
            )
            _require(
                0 <= row["turnover"] <= 1 + 1e-8 and row["gross"] > -1,
                "Invalid portfolio accounting.",
            )
            orders = row["order_preview"]
            _keys(orders, {"active_indices", "quantities", "cash"})
            active = [i for i, w in enumerate(row["weights"]) if w > 0]
            _require(
                orders["active_indices"] == active, "Order positions differ from target portfolio."
            )
            _require(len(orders["quantities"]) == 404, "Incomplete order quantity grid.")
            _vector(orders["cash"], 404)
            for preset, quantities in enumerate(orders["quantities"]):
                _require(
                    len(quantities) == len(active)
                    and all(type(q) is int and q >= 0 for q in quantities),
                    "Invalid integer order quantities.",
                )
                capital, bps = CAPITALS[preset // 101], preset % 101
                budget = capital - capital * (bps / 10000) * row["turnover"]
                _require(
                    orders["cash"][preset] <= budget + 1e-6, "Order cash exceeds investment budget."
                )
    for name in COMPATIBILITY_PAGES:
        target = "../" * (len(Path(name).parts) - 1) + "index.html#research"
        _require(
            f'content="0;url={target}"' in texts[name] and f'href="{target}"' in texts[name],
            "Legacy route redirect mismatch.",
        )
    html = texts["index.html"]
    _require(
        'href="styles.css"' in html and 'src="app.js"' in html,
        "Relative website entry assets are missing.",
    )
    _require(
        "Content-Security-Policy" in html and "connect-src 'self'" in html,
        "Website security policy is missing.",
    )
    _require(
        "fetch('research.json')" in texts["app.js"] and "'./analytics.mjs'" in texts["app.js"],
        "Relative research module binding is missing.",
    )
    return {
        "status": "verified",
        "files": len(children),
        "assets": asset_count,
        "models": len(model_ids),
        "holding_intervals": len(common_periods or []),
        "source_version": data["code_version"],
        "data_sha256": manifest["data_sha256"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_web_deployment(args.path), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
