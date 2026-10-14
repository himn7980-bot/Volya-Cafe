#!/usr/bin/env bash
# Builds index.html (the deployable page) from game.html (the single-file game) and web/head.html.
set -euo pipefail
cd "$(dirname "$0")"
{ cat web/head.html; sed '/^<div class="stage"/,$d' game.html; echo '</head>'; echo '<body>'; sed -n '/^<div class="stage"/,$p' game.html; echo '</body>'; echo '</html>'; } > index.html.tmp
mv index.html.tmp index.html
echo "index.html built"
