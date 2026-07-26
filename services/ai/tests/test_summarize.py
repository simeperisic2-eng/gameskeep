"""Topic-summarization tests (SPEC I3 §3). Deterministic, offline, neutral."""

from __future__ import annotations

from app.summarize import ArticleInput, summarize


def _sample() -> list[ArticleInput]:
    return [
        ArticleInput(
            title="Grand Theft Auto VI delayed to 2027",
            excerpt="Rockstar confirmed that Grand Theft Auto VI will now launch in 2027, "
            "citing extra polish. The delay affects all platforms.",
            source="ign",
        ),
        ArticleInput(
            title="Rockstar pushes back GTA 6 to 2027",
            excerpt="The publisher said the additional time will let the team finish "
            "Grand Theft Auto VI to its standards.",
            source="eurogamer",
        ),
        ArticleInput(
            title="GTA 6 release moves into 2027",
            excerpt="Investors were told the Grand Theft Auto VI release date slipped to 2027.",
            source="gamesindustry-biz",
        ),
    ]


def test_returns_non_empty_tldr_and_summary() -> None:
    tldr, summary = summarize(_sample())
    assert tldr
    assert summary
    assert len(tldr) <= 220
    assert len(summary) <= 601


def test_is_deterministic() -> None:
    a = summarize(_sample())
    b = summarize(_sample())
    assert a == b


def test_summary_is_extractive_and_on_topic() -> None:
    _, summary = summarize(_sample())
    # Neutral + extractive: the dominant subject vocabulary appears verbatim.
    lowered = summary.lower()
    assert "2027" in lowered
    assert "grand theft auto" in lowered or "gta 6" in lowered


def test_empty_input_is_safe() -> None:
    assert summarize([]) == ("", "")
    assert summarize([ArticleInput(title="", excerpt="", source="")]) == ("", "")
