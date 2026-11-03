#!/usr/bin/env bash
set -euo pipefail

data_dir=/custom_files
pbf="$data_dir/peru-latest.osm.pbf"
config="$data_dir/valhalla.json"
tiles="$data_dir/tiles.tar"
concurrency="${VALHALLA_BUILD_CONCURRENCY:-2}"

if [[ ! -s "$pbf" ]]; then
  echo "Missing $pbf. Download the Peru OSM extract as described in docs/operations/gps-tracking.md." >&2
  exit 1
fi
if [[ ! "$concurrency" =~ ^[1-9][0-9]*$ ]]; then
  echo "VALHALLA_BUILD_CONCURRENCY must be a positive integer." >&2
  exit 1
fi

mkdir -p "$data_dir/tiles"
if [[ ! -s "$config" ]]; then
  valhalla_build_config \
    --mjolnir-tile-dir "$data_dir/tiles" \
    --mjolnir-tile-extract "$tiles" \
    --mjolnir-admin "$data_dir/admins.sqlite" \
    --mjolnir-timezone "$data_dir/timezones.sqlite" \
    --mjolnir-concurrency "$concurrency" > "$config"
fi

if [[ ! -s "$data_dir/admins.sqlite" ]]; then
  valhalla_build_admins -c "$config" "$pbf"
fi

if [[ ! -s "$tiles" ]]; then
  valhalla_build_tiles -j "$concurrency" -c "$config" "$pbf"
fi

exec valhalla_service "$config" 1
