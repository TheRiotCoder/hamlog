#!/bin/sh
# Builds dist/ = exactly the files Cloudflare Pages serves: the app + _headers + a real 404 page. No tests, tools or .git.
# Usage: sh tools/build-site.sh && npx wrangler pages deploy dist --project-name hamlog --branch main   (see README "Deploying to Cloudflare Pages")
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp index.html manifest.webmanifest sw.js _headers dist/
cp -R css js icons dist/
cat > dist/404.html <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not found – HamLog</title><link rel="icon" href="/icons/favicon-32.png"></head><body><h1>404</h1><p>Nothing here. <a href="/">Open HamLog</a></p></body></html>
HTML
echo "dist/ ready: $(find dist -type f | wc -l) files"
