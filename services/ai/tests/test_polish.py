"""Editor-text polish tests (Phase P S5). Deterministic; never adds claims."""

from __future__ import annotations

import re

from app.polish import polish


def test_tidies_spacing_punctuation_and_capitals() -> None:
    assert (
        polish("  players   love the new  patch ,  mostly!!  ")
        == "Players love the new patch, mostly!"
    )
    assert polish("the patch landed. players are happy") == "The patch landed. Players are happy."


def test_drops_fillers_and_informal_phrasing() -> None:
    out = polish("Players are really gonna like it, honestly. A lot of fans agree")
    assert out == "Players are going to like it. Many fans agree."


def test_adds_no_numbers_names_or_links() -> None:
    src = "the community on reddit thinks the update is kinda rough, a lot of people want fixes"
    out = polish(src)
    assert not re.search(r"\d", out)
    assert "http" not in out and "www" not in out and "@" not in out
    # every capitalised word in the output exists in the input (case-insensitive)
    words = {w.lower() for w in re.findall(r"[A-Za-z']+", src)}
    extra = {"going", "to", "want", "somewhat", "many", "largely"}
    for w in re.findall(r"[A-Za-z']+", out):
        assert w.lower() in words or w.lower() in extra


def test_is_deterministic_and_handles_empty_input() -> None:
    text = "steam reviewers say performance is basically fine now."
    assert polish(text) == polish(text)
    assert polish("") == ""
    assert polish("   ") == ""


def test_keeps_editor_numbers_and_names_untouched() -> None:
    src = "Larian's patch 7 fixed crashes for 80% of players."
    assert polish(src) == src


def test_removing_a_filler_leaves_no_orphan_punctuation() -> None:
    assert polish("Honestly, the servers are fine now") == "The servers are fine now."
    assert polish("it works, really.") == "It works."


def test_polish_endpoint_contract() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.post("/polish", json={"text": "players  love it ,  really"})
        assert r.status_code == 200
        assert r.json() == {"text": "Players love it.", "model": "tidy-v1"}
        too_long = client.post("/polish", json={"text": "x" * 4001})
        assert too_long.status_code == 422
