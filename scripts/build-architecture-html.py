#!/usr/bin/env python3
"""Refresh `architecture.json` (version + generated date) from `package.json`
and embed the result into the <script type="application/json" id="arch-data">
tag inside `architecture.html`.

`architecture.html` ships with the JSON inlined so it renders in contexts
that cannot fetch relative URLs (e.g. cchub's blob:// HtmlViewer iframe).

Usage: run this after editing `architecture.json`, or as part of a release
(it syncs the version field to whatever is in `package.json`).
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'architecture.html'
JSON_FILE = ROOT / 'architecture.json'
PKG_FILE = ROOT / 'package.json'

# 1) Sync version + generated date in architecture.json from package.json
pkg = json.loads(PKG_FILE.read_text(encoding='utf-8'))
arch = json.loads(JSON_FILE.read_text(encoding='utf-8'))
target_version = pkg['version']
target_date = date.today().isoformat()

changed = False
if arch.get('version') != target_version:
    arch['version'] = target_version
    changed = True
if arch.get('generated') != target_date:
    arch['generated'] = target_date
    changed = True

if changed:
    # Preserve the trailing newline + 2-space indent we use everywhere else.
    JSON_FILE.write_text(
        json.dumps(arch, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8',
    )
    print(f'updated architecture.json: version={target_version} generated={target_date}')
else:
    print(f'architecture.json already current (v{target_version}, {target_date})')

# 2) Embed JSON into architecture.html
raw = JSON_FILE.read_text(encoding='utf-8').strip()
# Prevent the embedded JSON from accidentally closing the parent <script>.
escaped = raw.replace('</script>', '<\\/script>')

html = HTML.read_text(encoding='utf-8')
pattern = re.compile(
    r'(<script type="application/json" id="arch-data">)(.*?)(</script>)',
    re.DOTALL,
)
if not pattern.search(html):
    sys.exit('inline JSON script tag not found in architecture.html')

# `re.sub` interprets backslashes in replacement strings, so use a lambda.
new_html = pattern.sub(lambda m: m.group(1) + escaped + m.group(3), html)
if new_html != html:
    HTML.write_text(new_html, encoding='utf-8')
    print(f'embedded {len(escaped)} chars of JSON into {HTML.name}')
else:
    print(f'{HTML.name} already up to date')
