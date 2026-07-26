"""Embedding-engine tests (SPEC I3 §3).

These assert the properties clustering relies on. Because the engine is a real
ONNX transformer, we test **similarity within tolerance** and **semantic
ordering** — NOT bitwise equality (floating-point inference can differ across
CPUs/builds). The adversarial cases encode the owner's exact fear: distinct
events that share a game's vocabulary must NOT look identical, while the same
event described in different words must look similar.
"""

from __future__ import annotations

import math

from app.embedding import EMBEDDING_DIM, embed

TOL = 1e-4


def _cos(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b, strict=True))


def test_dimension_and_unit_norm() -> None:
    [vector] = embed(["Grand Theft Auto VI gets a second trailer"])
    assert len(vector) == EMBEDDING_DIM == 384
    norm = math.sqrt(sum(x * x for x in vector))
    assert abs(norm - 1.0) < TOL


def test_self_similarity_within_tolerance() -> None:
    text = "Baldur's Gate 3 patch 7 adds new subclasses"
    [a] = embed([text])
    [b] = embed([text])
    # Same text → same vector within floating-point tolerance (NOT bitwise).
    assert _cos(a, b) > 1.0 - TOL


def test_blank_text_is_tolerated() -> None:
    vectors = embed(["", "   ", "real text"])
    assert len(vectors) == 3
    for vector in vectors:
        assert len(vector) == EMBEDDING_DIM


def test_semantic_same_event_beats_different_event() -> None:
    """The core guard: same event / different words must out-score a different
    event that shares the same game + genre vocabulary."""
    same_event = embed(
        [
            "GTA 6 delayed to 2027, Rockstar confirms",
            "Rockstar pushes Grand Theft Auto VI release into 2027",
        ]
    )
    different_event = embed(
        [
            "GTA 6 delayed to 2027, Rockstar confirms",
            "Stardew Valley's big 1.6 update finally arrives",
        ]
    )
    assert _cos(same_event[0], same_event[1]) > _cos(different_event[0], different_event[1])


def test_semantic_same_game_different_events_are_separable() -> None:
    """The owner's fear: three DISTINCT GTA 6 stories share the game name, studio
    and genre, yet must be separable. We assert each is more similar to a
    paraphrase of itself than to the other two events — i.e. there is a usable
    gap a clustering threshold can sit in."""
    delay, delay2 = embed(
        [
            "Grand Theft Auto VI delayed to 2027",
            "Rockstar pushes back the GTA 6 launch date to 2027",
        ]
    )
    trailer, trailer2 = embed(
        [
            "GTA 6 trailer breaks YouTube view record in 24 hours",
            "Grand Theft Auto VI second trailer sets a new viewership record",
        ]
    )
    leak, leak2 = embed(
        [
            "GTA 6 map leak reveals an expanded Vice City",
            "Leaked Grand Theft Auto VI map shows a bigger Vice City",
        ]
    )
    # Each event's self-paraphrase similarity beats every cross-event pairing.
    assert _cos(delay, delay2) > _cos(delay, trailer)
    assert _cos(delay, delay2) > _cos(delay, leak)
    assert _cos(trailer, trailer2) > _cos(trailer, delay)
    assert _cos(trailer, trailer2) > _cos(trailer, leak)
    assert _cos(leak, leak2) > _cos(leak, delay)
    assert _cos(leak, leak2) > _cos(leak, trailer)
