"""Local dev server for Hakoniwa: static files that the browser may cache but must revalidate.

`Cache-Control: no-cache` lets the browser keep files (so the background prefetch of the other season and
season switches are fast), while every load still checks for changes, so edits always show on reload.

Usage: python serve.py [port]   (default 5183), then open http://localhost:5183/
"""
import functools
import http.server
import os
import sys


class RevalidatingHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5183
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(RevalidatingHandler, directory=root)
    print(f'Hakoniwa on http://localhost:{port}/')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
