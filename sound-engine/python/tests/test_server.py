import contextlib
import io
import socket
import unittest

from gravitunes_sound import Score, cli, server


def busy_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    return s, s.getsockname()[1]


class Server(unittest.TestCase):
    def test_preview_reuses_fallback_server_when_port_busy(self):
        sock, port = busy_port()
        try:
            n = len(server._servers)
            s = Score().note(t=0, step=0)
            u1 = server.preview(s, port=port, open_browser=False)
            u2 = server.preview(s, port=port, open_browser=False)
            self.assertNotIn(":%d/" % port, u1)
            self.assertEqual(u1.split("/player")[0], u2.split("/player")[0])
            self.assertEqual(len(server._servers), n + 1)
        finally:
            sock.close()

    def test_serve_busy_port_prints_hint(self):
        sock, port = busy_port()
        err = io.StringIO()
        try:
            with contextlib.redirect_stderr(err):
                rc = cli.main(["serve", "--port", str(port)])
        finally:
            sock.close()
        self.assertEqual(rc, 1)
        self.assertIn("--port", err.getvalue())
        self.assertIn(str(port), err.getvalue())


class Direction(unittest.TestCase):
    def test_direction_field(self):
        s = Score().note(t=0, id="a", value=3, direction="down").set(t=1, id="a", value=1, direction="up")
        self.assertEqual(s.validate(), [])
        self.assertTrue(Score().note(t=0, value=3, direction="sideways").validate())


if __name__ == "__main__":
    unittest.main()
