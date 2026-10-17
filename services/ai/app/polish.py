"""Editor-text polish (Phase P S5 — "Polish with AI" on community notes).

The demo polisher is DETERMINISTIC and offline: it only tidies the editor's own
words — spacing and punctuation, sentence capitals, filler words, a handful of
informal phrasings. It never adds a number, a name or a link, so its output
always passes the main app's no-new-claims validator. The validator in the main
app checks EVERY rewrite anyway (this one, a production LLM behind the same
`/polish` contract, or a rewrite pasted from elsewhere): the AI never decides
what is published — the editor approves.

Production swap: an LLM can back the same contract later without changing the
main app (BLUEPRINT 2.8); the call stays off the public request path.
"""

from __future__ import annotations

import re

# Informal phrasings → plain ones (lower case; the replacement adds no claims).
_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("gonna", "going to"),
    ("wanna", "want to"),
    ("kinda", "somewhat"),
    ("sorta", "somewhat"),
    ("a lot of", "many"),
    ("lots of", "many"),
    ("pretty much", "largely"),
)
# Filler words dropped when they stand alone.
_FILLERS: tuple[str, ...] = (
    "really",
    "very",
    "basically",
    "honestly",
    "literally",
    "actually",
    "just",
    "kind of",
    "sort of",
)
_SPACES = re.compile(r"\s+")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.;:!?])")
_REPEATED_PUNCT = re.compile(r"([!?.,])\1+")
_ORPHAN_COMMA = re.compile(r"[,;:]+(?=[.!?])")
_LEADING_COMMA = re.compile(r"(^|[.!?]\s+)[,;:]\s*")
_SENTENCE_START = re.compile(r"(^|[.!?]\s+)([a-z])")


def _phrase(pattern: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![\w']){re.escape(pattern)}(?![\w'])", re.IGNORECASE)


def _keep_case(original: str, replacement: str) -> str:
    return replacement[:1].upper() + replacement[1:] if original[:1].isupper() else replacement


def polish(text: str) -> str:
    """Tidy an editor's text without adding anything. Empty in → empty out."""
    out = _SPACES.sub(" ", text or "").strip()
    if not out:
        return ""
    for src, dst in _REPLACEMENTS:

        def _swap(m: re.Match[str], replacement: str = dst) -> str:
            return _keep_case(m.group(0), replacement)

        out = _phrase(src).sub(_swap, out)
    for filler in _FILLERS:
        out = _phrase(filler).sub("", out)
    out = _SPACES.sub(" ", out).strip()
    out = _SPACE_BEFORE_PUNCT.sub(r"\1", out)
    out = _REPEATED_PUNCT.sub(r"\1", out)
    out = _ORPHAN_COMMA.sub("", out)
    out = _LEADING_COMMA.sub(r"\1", out)
    out = _SENTENCE_START.sub(lambda m: m.group(1) + m.group(2).upper(), out)
    out = out.rstrip(",;: ")
    if out and out[-1] not in ".!?":
        out += "."
    return out
