import argparse
import json
import sys
import time

from .schema import validate


def _relay(ws_port):
    try:
        from websockets.sync.server import serve
    except ImportError:
        print('warning: websockets not installed; serving static files only. '
              'pip install -e "sound-engine/python[live]"', file=sys.stderr)
        return None
    import threading
    clients = set()
    lock = threading.Lock()

    def handler(conn):
        with lock:
            clients.add(conn)
        try:
            for msg in conn:
                with lock:
                    others = [c for c in clients if c is not conn]
                for c in others:
                    try:
                        c.send(msg)
                    except Exception:
                        pass
        except Exception:
            pass
        finally:
            with lock:
                clients.discard(conn)

    try:
        srv = serve(handler, "127.0.0.1", ws_port)
    except OSError as e:
        print("error: cannot start the live relay on ws://localhost:%d (%s). Is another 'serve' running? "
              "Pick another port with --ws-port, e.g. --ws-port %d" % (ws_port, e.strerror or e, ws_port + 1),
              file=sys.stderr)
        return None
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def cmd_serve(a):
    from .server import start_http
    try:
        _, port = start_http(a.port, quiet=False)
    except OSError as e:
        print("error: cannot serve on port %d (%s). Is another server running there? "
              "Pick another port with --port, e.g. --port %d" % (a.port, e.strerror or e, a.port + 1), file=sys.stderr)
        return 1
    print("static: http://127.0.0.1:%d/  (player.html, playground.html)" % port)
    if _relay(a.ws_port):
        print("relay:  ws://localhost:%d" % a.ws_port)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    return 0


def cmd_validate(a):
    rc = 0
    for f in a.files:
        try:
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as e:
            print("%s: cannot read: %s" % (f, e))
            rc = 1
            continue
        errs = validate(data)
        if errs:
            rc = 1
            print("%s: INVALID" % f)
            for e in errs:
                print("  - " + e)
        else:
            print("%s: ok" % f)
    return rc


def main(argv=None):
    p = argparse.ArgumentParser(prog="gravitunes_sound")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="serve sound-engine/ and run the websocket relay")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--ws-port", type=int, default=8765)
    s.set_defaults(fn=cmd_serve)
    v = sub.add_parser("validate", help="validate score JSON files")
    v.add_argument("files", nargs="+")
    v.set_defaults(fn=cmd_validate)
    a = p.parse_args(argv)
    return a.fn(a)
