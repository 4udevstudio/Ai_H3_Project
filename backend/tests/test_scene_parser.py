"""Scene JSON parsing and the paragraph/sentence fallback."""
from app.services.scene_parser import parse_scenes


def test_parses_fenced_json_and_clamps_duration():
    text = """
Here is the plan:
```json
[
  {"prompt": "Wide shot of a harbor at dawn", "mode": "text_to_video", "duration": 2},
  {"prompt": "The boat leaves the dock", "mode": "FL2VA", "duration": 40},
  {"prompt": "bad", "mode": "NOPE", "duration": 5}
]
```
"""
    scenes = parse_scenes(text, "unused because the model payload is valid", max_scenes=8)
    assert len(scenes) == 2
    assert scenes[0]["mode"] == "T2V"
    assert scenes[0]["duration"] == 5
    assert scenes[1]["mode"] == "FL2VA"
    assert scenes[1]["duration"] == 15
    assert scenes[0]["prompt"].startswith("Wide shot")


def test_parses_object_wrapper_and_respects_max_scenes():
    text = '{"scenes": [{"prompt": "One", "mode": "T2V", "duration": 6}, {"prompt": "Two", "mode": "REF2VA", "duration": 7}, {"prompt": "Three", "mode": "FL2VA", "duration": 8}]}'
    scenes = parse_scenes(text, "ignored", max_scenes=2)
    assert [scene["prompt"] for scene in scenes] == ["One", "Two"]
    assert scenes[1]["mode"] == "REF2VA"


def test_fallback_splits_paragraphs_then_sentences():
    script = "Rain on the window.\n\nShe opens the door and steps into the alley."
    scenes = parse_scenes("not json at all", script, max_scenes=8)
    assert [scene["mode"] for scene in scenes] == ["T2V", "FL2VA"]
    assert scenes[0]["prompt"].startswith("Rain on the window")
    assert scenes[1]["duration"] == 5

    sentences = parse_scenes("", "Dawn breaks. The city wakes. A train leaves.", max_scenes=2)
    assert len(sentences) == 2
    assert sentences[0]["mode"] == "T2V"
    assert sentences[1]["mode"] == "FL2VA"
    assert "train" not in sentences[1]["prompt"]
