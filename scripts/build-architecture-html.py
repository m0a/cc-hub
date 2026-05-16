#!/usr/bin/env python3
"""Embed architecture.json into the <script type="application/json"
id="arch-data"> tag inside architecture.html so the viewer works in
contexts that can't fetch relative URLs (e.g. cchub's blob:// HtmlViewer).

Run after editing architecture.json.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / 'architecture.html'
JSON_FILE = ROOT / 'architecture.json'

raw = JSON_FILE.read_text(encoding='utf-8').strip()
json.loads(raw)  # validate
# Prevent the embedded JSON from accidentally closing the parent <script> tag.
escaped = raw.replace('</script>', '<\\/script>')

html = HTML.read_text(encoding='utf-8')
pattern = re.compile(
    r'(<script type="application/json" id="arch-data">)(.*?)(</script>)',
    re.DOTALL,
)
if not pattern.search(html):
    sys.exit('inline JSON script tag not found in architecture.html')

# `re.sub` interprets backslashes in the replacement string, so use a lambda
# to pass the substitution verbatim.
new_html = pattern.sub(lambda m: m.group(1) + escaped + m.group(3), html)
HTML.write_text(new_html, encoding='utf-8')
print(f'embedded {len(escaped)} chars of JSON into {HTML.name}')
