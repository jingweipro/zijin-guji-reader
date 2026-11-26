"""Build a named OFL WOFF2 derivative from the pinned TTF and frozen character list."""
import argparse
import hashlib
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
NAMES = {"wenkai": ("Zijin WenKai TC", "Zijin-WenKaiTC"), "cnskai": ("Zijin CNS Kai", "Zijin-CNSKai")}


def build(key, source):
    family, filename = NAMES[key]
    font = TTFont(source, recalcTimestamp=False)
    original = font.getBestCmap()
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    worker = subset.Subsetter(options=options)
    points = [int(point, 16) for point in (HERE / "codepoints.txt").read_text().split()]
    worker.populate(unicodes=points)
    worker.subset(font)
    names = font["name"]
    replacements = {1: family, 2: "Regular", 3: filename + "-V1.7", 4: family + " Regular",
                    6: filename + "-Regular", 16: family, 17: "Regular", 21: family, 22: "Regular"}
    for record in list(names.names):
        if record.nameID in replacements:
            names.setName(replacements[record.nameID], record.nameID, record.platformID,
                          record.platEncID, record.langID)
    font.flavor = "woff2"
    out = ROOT / "fonts" / (filename + ".woff2")
    font.save(out)
    digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
    print(f"{key}: original {digest(source)} ({len(original)} code points); "
          f"subset {digest(out)} ({len(font.getBestCmap())} code points, {out.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("family", choices=NAMES)
    parser.add_argument("ttf", type=Path)
    args = parser.parse_args()
    build(args.family, args.ttf)
