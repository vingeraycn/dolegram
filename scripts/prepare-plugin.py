#!/usr/bin/env python3
"""Prepare an account plugin package for an independently verified HTTPS backend."""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--endpoint', required=True, help='Previously verified public HTTPS /mcp URL; not a deployment command')
    parser.add_argument('--output', required=True, help='New output directory; must not already exist')
    args = parser.parse_args()
    url = urlparse(args.endpoint)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.fragment or url.query or url.path != '/mcp' or url.hostname.endswith('.invalid') or url.port not in (None, 443):
        parser.error('Use a verified HTTPS /mcp endpoint without credentials, query, fragment, or a nonstandard port.')
    source = Path(__file__).resolve().parent.parent / 'plugin-template' / 'dolegram'
    output = Path(args.output)
    shutil.copytree(source, output)
    manifest = json.loads((output / 'mcp.json.example').read_text())
    manifest['mcpServers']['dolegram']['url'] = args.endpoint
    (output / 'mcp.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (output / 'mcp.json.example').unlink()
    print('Prepared package files only. Endpoint reachability, upload, installation and subscription are not verified.')


if __name__ == '__main__':
    main()
