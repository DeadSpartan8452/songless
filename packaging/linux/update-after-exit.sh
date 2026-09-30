#!/bin/sh
set -eu

root_arg=${1:-}
stage_arg=${2:-}
parent_pid=${3:-}
[ -n "$root_arg" ] && [ -n "$stage_arg" ] && [ "$parent_pid" -gt 1 ] || exit 2

root=$(CDPATH= cd -P -- "$root_arg" && pwd)
stage_parent=$(CDPATH= cd -P -- "$(dirname -- "$stage_arg")" && pwd)
stage_name=$(basename -- "$stage_arg")
[ "$root" != / ] && [ "$root" != "$HOME" ] || exit 2
[ "$stage_parent" = "$root" ] || exit 2
case "$stage_name" in .songless-update-*) ;; *) exit 2 ;; esac
[ -f "$root/app/server.js" ] || exit 2
[ -f "$stage_arg/new/app/server.js" ] || exit 2
[ -f "$stage_arg/new/VERSION" ] || exit 2

while kill -0 "$parent_pid" 2>/dev/null; do sleep 1; done

mkdir -p -- "$stage_arg/old"
changed=''
rollback() {
  result=$?
  if [ "$result" -ne 0 ]; then
    for name in $changed; do
      if [ -e "$root/$name" ]; then
        mv -- "$root/$name" "$stage_arg/new/failed-$name" 2>/dev/null || true
      fi
      if [ -e "$stage_arg/old/$name" ]; then
        mv -- "$stage_arg/old/$name" "$root/$name" 2>/dev/null || true
      fi
    done
  fi
  exit "$result"
}
trap rollback EXIT HUP INT TERM

for name in app runtime packaging Songless README-Linux.txt VERSION; do
  changed="$changed $name"
  if [ -e "$root/$name" ]; then
    mv -- "$root/$name" "$stage_arg/old/$name"
  fi
  if [ -e "$stage_arg/new/$name" ]; then
    mv -- "$stage_arg/new/$name" "$root/$name"
  fi
done

trap - EXIT HUP INT TERM
version=$(cat -- "$root/VERSION")
rm -rf -- "$stage_arg"
if command -v notify-send >/dev/null 2>&1; then
  notify-send 'Songless mis à jour' "Version $version. Relance ./Songless."
fi
