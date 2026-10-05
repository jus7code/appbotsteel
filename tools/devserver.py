"""Servidor estático temporal (hasta tener Nginx) que pide a Cloudflare/navegador no cachear."""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if not self.path.split('?')[0].endswith('.glb'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
handler = functools.partial(NoCacheHandler, directory=sys.argv[2] if len(sys.argv) > 2 else 'public')
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
