#!/usr/bin/env python3

from pathlib import Path
import sys

MARKER = "SONGLESS_16K_LINK_FLAGS"
FLAG = "-Wl,-z,max-page-size=16384"


def patch(source_root: Path) -> bool:
    common = source_root / "common.gypi"
    text = common.read_text(encoding="utf-8")
    if MARKER in text:
        return False
    needle = "      ['OS==\"android\"', {\n"
    if text.count(needle) != 1:
        raise RuntimeError("bloc Android unique introuvable dans common.gypi")
    replacement = (
        needle
        + f"        # {MARKER}\n"
        + f"        'ldflags': [ '{FLAG}' ],\n"
    )
    common.write_text(text.replace(needle, replacement), encoding="utf-8")
    return True


if __name__ == "__main__":
    try:
        changed = patch(Path(sys.argv[1]).resolve())
        print("Sources Node Mobile préparées pour 16 Kio." if changed else
              "Sources Node Mobile déjà préparées pour 16 Kio.")
    except Exception as error:
        print(f"Préparation des sources impossible : {error}", file=sys.stderr)
        sys.exit(1)
