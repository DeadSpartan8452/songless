#!/usr/bin/env bash

set -euo pipefail

TAG="v18.20.4"
COMMIT="959b6e8637c86fb1f63f1aaf72adc86c7e8c335d"
REPOSITORY="https://github.com/nodejs-mobile/nodejs-mobile.git"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NDK_ROOT="${1:-}"
OUTPUT_ROOT="${2:-$PROJECT_ROOT/dist/node-mobile-16k}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Ce constructeur exige Linux." >&2
  exit 1
fi
if [[ -z "$NDK_ROOT" || ! -d "$NDK_ROOT/toolchains/llvm" ]]; then
  echo "Usage : $0 /chemin/vers/ndk/28.0.13004108 [dossier-sortie]" >&2
  exit 1
fi
for command in git python3 make gcc g++ sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Outil requis absent : $command" >&2
    exit 1
  }
done

WORK_ROOT="$(mktemp -d)"
cleanup() {
  [[ -n "$WORK_ROOT" && -d "$WORK_ROOT" ]] && rm -rf -- "$WORK_ROOT"
}
trap cleanup EXIT

SOURCE_ROOT="$WORK_ROOT/nodejs-mobile"
git clone --depth 1 --branch "$TAG" "$REPOSITORY" "$SOURCE_ROOT"
ACTUAL_COMMIT="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$COMMIT" ]]; then
  echo "Commit source inattendu : $ACTUAL_COMMIT" >&2
  exit 1
fi

python3 "$SCRIPT_DIR/patch-node-mobile-source-16k.py" "$SOURCE_ROOT"
for arch in arm64 x86_64; do
  "$SOURCE_ROOT/tools/android_build.sh" "$NDK_ROOT" 24 "$arch"
done

READELF="$NDK_ROOT/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
[[ -x "$READELF" ]] || {
  echo "llvm-readelf introuvable dans le NDK." >&2
  exit 1
}

mkdir -p "$OUTPUT_ROOT/arm64-v8a" "$OUTPUT_ROOT/x86_64"
for abi in arm64-v8a x86_64; do
  library="$SOURCE_ROOT/out_android/$abi/libnode.so"
  [[ -f "$library" ]] || {
    echo "libnode.so absent pour $abi" >&2
    exit 1
  }
  alignments="$($READELF -lW "$library" | awk '$1 == "LOAD" {print $NF}')"
  [[ -n "$alignments" ]] || {
    echo "Aucun segment LOAD trouvé pour $abi" >&2
    exit 1
  }
  while read -r alignment; do
    (( alignment >= 0x4000 )) || {
      echo "Alignement inattendu pour $abi : $alignment" >&2
      exit 1
    }
  done <<< "$alignments"
  cp "$library" "$OUTPUT_ROOT/$abi/libnode.so"
done

(
  cd "$OUTPUT_ROOT"
  sha256sum arm64-v8a/libnode.so x86_64/libnode.so > SHA256SUMS
)
echo "Moteurs Node Mobile 16 Kio prêts dans : $OUTPUT_ROOT"
