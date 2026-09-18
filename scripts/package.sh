#!/usr/bin/env bash
#
# Assembles the plugin into a zip decky-loader can install.
#
# Run `pnpm package` rather than calling this directly - it builds dist/ first.
# No Docker or Decky CLI needed: this plugin has no compiled backend, so the
# zip is just files in the right shape.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="${1:-$(node -p "require('./package.json').version")}"

# decky-loader locates a plugin by reading the name out of each folder's
# plugin.json, so the directory name itself is free. A slug keeps the install
# instructions free of shell quoting that "Don't Dimmadeck" would need.
PLUGIN_DIR="dont-dimmadeck"
OUT_DIR="out"
ZIP_NAME="${PLUGIN_DIR}-v${VERSION}.zip"

if [[ ! -f dist/index.js ]]; then
  echo "dist/index.js is missing - run 'pnpm build' first (or use 'pnpm package')." >&2
  exit 1
fi

rm -rf "${OUT_DIR:?}/${PLUGIN_DIR}" "${OUT_DIR}/${ZIP_NAME}"
mkdir -p "${OUT_DIR}/${PLUGIN_DIR}"

# The layout decky-loader expects: exactly one <folder>/plugin.json one level
# deep, with main.py and dist/index.js beside it. package.json is what the
# loader reads the version from, and the store requires the licence.
cp -r dist "${OUT_DIR}/${PLUGIN_DIR}/"
cp main.py package.json plugin.json README.md LICENSE "${OUT_DIR}/${PLUGIN_DIR}/"

# The sourcemap is ~1.4MB and of no use on a Deck.
rm -f "${OUT_DIR}/${PLUGIN_DIR}/dist/index.js.map"

(cd "${OUT_DIR}" && zip -qr "${ZIP_NAME}" "${PLUGIN_DIR}")

echo "${OUT_DIR}/${ZIP_NAME}"
