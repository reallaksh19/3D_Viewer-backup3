#!/usr/bin/env python3
"""Portable master-customization primitives for the XML -> CII pipeline.

Design (mirrors the PcfStudio_Basic_Legacy service layer so behaviour matches,
but kept dependency-free so this file can be COPIED as-is into a standalone app
alongside xml_to_cii2019.py):

  * Pure functions only. No DOM, no localStorage, no file/network I/O, no
    globals. Masters, overrides and config are passed in by the caller, which
    owns persistence/UI at the edge.
  * Precedence everywhere: manual override > exact > fuzzy(contains) >
    fuzzy(token overlap) > none.
  * Fuzzy results carry a confidence and a `needs_review` flag so the host can
    raise an "approximate match" prompt instead of silently guessing.

Supported customizations:
  1. material      - map a master material *name* to a material *code* via a
                     Material Map, with fuzzy fallback and manual overrides.
  2. approximate   - resolve a derived piping class against the known class set
     class match     (exact -> startsWith -> fuzzy ratio), flagging approximate
                     hits for review.
  3. manual        - any field can be force-set via an overrides table keyed by
     overrides       (kind, key); checked first, always wins.
  4. fuzzy logic   - shared string-similarity helpers (normalize, contains,
     mapping         token Jaccard, ratio) used by the above and reusable for
                     other master lookups.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Iterable, Optional

# ---------------------------------------------------------------------------
# Configuration (all overridable by passing a dict; never read from globals).
# ---------------------------------------------------------------------------
DEFAULT_CONFIG: dict[str, Any] = {
    # Fuzzy-name matching (material names, descriptions...).
    "contains_confidence": 0.90,      # one string contains the other
    "token_jaccard_threshold": 0.35,  # min token-set overlap to accept
    # Approximate piping-class matching.
    "class_startswith_confidence": 0.80,
    "class_fuzzy_threshold": 0.60,    # min SequenceMatcher ratio to accept
    # Any accepted match below this confidence is flagged needs_review.
    "review_below": 1.00,
}


def merged_config(overrides: Optional[dict] = None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg


# ---------------------------------------------------------------------------
# Fuzzy-logic primitives
# ---------------------------------------------------------------------------
def normalize(value: Any) -> str:
    """Lowercase, collapse non-alphanumerics to single spaces, trim."""
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _tokens(value: str) -> set[str]:
    return {t for t in normalize(value).split(" ") if t}


def token_jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def fuzzy_name_match(name: str, candidates: Iterable[Any], cfg: Optional[dict] = None,
                     key=lambda c: c) -> Optional[dict]:
    """Match `name` against candidates using exact -> contains -> token Jaccard.

    Returns {candidate, score, method} for the best acceptable match, or None.
    `key` extracts the comparable string from each candidate.
    """
    cfg = merged_config(cfg)
    n = normalize(name)
    if not n:
        return None
    cand = list(candidates)

    # 1) exact (normalized)
    for c in cand:
        if normalize(key(c)) == n:
            return {"candidate": c, "score": 1.0, "method": "exact"}

    # 2) contains (either direction)
    best = None
    for c in cand:
        ck = normalize(key(c))
        if ck and (ck in n or n in ck):
            score = cfg["contains_confidence"]
            if best is None or score > best["score"]:
                best = {"candidate": c, "score": score, "method": "contains"}
    if best:
        return best

    # 3) token Jaccard
    for c in cand:
        j = token_jaccard(n, key(c))
        if j >= cfg["token_jaccard_threshold"] and (best is None or j > best["score"]):
            best = {"candidate": c, "score": j, "method": "token-jaccard"}
    return best


# ---------------------------------------------------------------------------
# Manual overrides (highest precedence)
# ---------------------------------------------------------------------------
def override_for(overrides: Optional[dict], kind: str, key: Any) -> Optional[Any]:
    """Look up a manual override. `overrides` is { kind: { normKey: value } }.

    Matching is case/format-insensitive on the key. Returns the override value
    or None. This is checked before any automatic resolution.
    """
    if not overrides:
        return None
    bucket = overrides.get(kind) or {}
    if not isinstance(bucket, dict):
        return None
    nk = normalize(key)
    for k, v in bucket.items():
        if normalize(k) == nk:
            return v
    return None


# ---------------------------------------------------------------------------
# Material name -> code resolution
# ---------------------------------------------------------------------------
def resolve_material_code(material_name: str, material_map: Iterable[dict],
                          overrides: Optional[dict] = None,
                          cfg: Optional[dict] = None,
                          code_key: str = "code", desc_key: str = "material") -> dict:
    """Resolve a material *code* from a material *name* via the Material Map.

    material_map: iterable of {code, material/desc} rows.
    Returns {code, name, method, confidence, needs_review}.
    Precedence: manual override -> exact -> contains -> token Jaccard.
    """
    cfg = merged_config(cfg)
    ov = override_for(overrides, "material", material_name)
    if ov not in (None, ""):
        return {"code": str(ov), "name": material_name, "method": "override",
                "confidence": 1.0, "needs_review": False}

    rows = [r for r in (material_map or []) if r]
    hit = fuzzy_name_match(material_name, rows, cfg, key=lambda r: r.get(desc_key, ""))
    if not hit:
        return {"code": None, "name": material_name, "method": "none",
                "confidence": 0.0, "needs_review": True}
    row = hit["candidate"]
    return {
        "code": row.get(code_key),
        "name": row.get(desc_key, material_name),
        "method": hit["method"],
        "confidence": hit["score"],
        "needs_review": hit["score"] < cfg["review_below"],
    }


# ---------------------------------------------------------------------------
# Approximate piping-class match
# ---------------------------------------------------------------------------
def approximate_class_match(derived_class: str, known_classes: Iterable[str],
                            overrides: Optional[dict] = None,
                            cfg: Optional[dict] = None) -> dict:
    """Resolve a derived class against the known class set.

    Order: manual override -> exact -> startsWith -> fuzzy ratio.
    Returns {pipingClass, method, confidence, needs_review}. `needs_review` is
    the signal the host uses to show the 'approximate class match' prompt.
    """
    cfg = merged_config(cfg)
    ov = override_for(overrides, "pipingClass", derived_class)
    if ov not in (None, ""):
        return {"pipingClass": str(ov), "method": "override", "confidence": 1.0, "needs_review": False}

    d = normalize(derived_class)
    classes = [str(c) for c in (known_classes or []) if str(c).strip()]
    if not d or not classes:
        return {"pipingClass": None, "method": "none", "confidence": 0.0, "needs_review": True}

    # exact
    for c in classes:
        if normalize(c) == d:
            return {"pipingClass": c, "method": "exact", "confidence": 1.0, "needs_review": False}

    # startsWith (either direction) - the reference's primary fuzzy tier
    sw = [c for c in classes if normalize(c).startswith(d) or d.startswith(normalize(c))]
    if len(sw) == 1:
        conf = cfg["class_startswith_confidence"]
        return {"pipingClass": sw[0], "method": "startsWith", "confidence": conf,
                "needs_review": conf < cfg["review_below"]}
    if len(sw) > 1:
        return {"pipingClass": None, "method": "ambiguous", "confidence": cfg["class_startswith_confidence"],
                "needs_review": True, "candidates": sw}

    # fuzzy ratio
    best_c, best_s = None, 0.0
    for c in classes:
        s = ratio(d, c)
        if s > best_s:
            best_c, best_s = c, s
    if best_c is not None and best_s >= cfg["class_fuzzy_threshold"]:
        return {"pipingClass": best_c, "method": "fuzzy", "confidence": best_s,
                "needs_review": best_s < cfg["review_below"]}
    return {"pipingClass": None, "method": "none", "confidence": best_s, "needs_review": True}
