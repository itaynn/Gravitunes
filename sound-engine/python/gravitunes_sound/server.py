import functools
import http.server
import json
import os
import threading
import webbrowser

ENGINE_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
_servers = {}
_previews = {}
_preview_ports = {}  # requested port -> port actually serving previews (a fallback if it was busy)


class _Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/__preview__/"):
            body = _previews.get(path.rsplit("/", 1)[-1])
            if body is None:
                self.send_error(404)
                return
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *a):
        pass


def start_http(port=8000, directory=ENGINE_DIR, quiet=True):
    """Start (or reuse) a static server in a daemon thread. Returns (server, port)."""
    if port in _servers:
        return _servers[port], port
    handler = functools.partial(_Handler, directory=directory)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _servers[srv.server_address[1]] = srv
    return srv, srv.server_address[1]


def preview(score, port=8000, open_browser=True):
    """Serve the score at /__preview__/ and return (and open) a player.html URL for it.
    If `port` is busy, one fallback server on a free port is started and reused by later calls."""
    requested = port
    port = _preview_ports.get(requested)
    if port is None:
        try:
            _, port = start_http(requested)
        except OSError:
            _, port = start_http(0)  # port busy: pick a free one (once)
        _preview_ports[requested] = port
    name = "preview-%d.score.json" % len(_previews)
    _previews[name] = json.dumps(score.to_dict())
    url = "http://127.0.0.1:%d/player.html?score=/__preview__/%s" % (port, name)
    if open_browser:
        webbrowser.open(url)
    return url
