"""Inline the FE results (data/*.json) into lab_src.html -> wirtualne_laboratorium.html."""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
D = HERE / "data"
load = lambda n: json.loads((D / n).read_text(encoding="utf-8"))
data = {"sc": load("sciskanie.json"), "tz": load("tarcza.json"),
        "zb": {"klejone": load("zbiornik_klejone.json"), "sruby": load("zbiornik_sruby.json")}}
src = (HERE / "lab_src.html").read_text(encoding="utf-8")
out = src.replace("__DATA__", json.dumps(data, separators=(",", ":")))
(HERE / "wirtualne_laboratorium.html").write_text(out, encoding="utf-8")
print(f"wirtualne_laboratorium.html: {len(out) / 1e6:.2f} MB")
