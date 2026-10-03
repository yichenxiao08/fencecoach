import unittest
from unittest.mock import patch

from scripts.container_smoke import main


class ContainerStartupTests(unittest.TestCase):
    def test_connection_reset_during_startup_is_retried(self):
        responses = [
            ConnectionResetError("Startup race"),
            {"status": "ok"},
            {"session_id": "test-session"},
            {"citation_ids_valid": True, "citation_count": 1},
        ]
        with (
            patch("scripts.container_smoke.call", side_effect=responses) as call,
            patch("scripts.container_smoke.time.sleep") as sleep,
            patch("builtins.print"),
        ):
            main()
        self.assertEqual(call.call_count, 4)
        sleep.assert_called_once_with(1)

    def test_unhealthy_container_eventually_fails(self):
        with (
            patch("scripts.container_smoke.call", side_effect=ConnectionResetError),
            patch("scripts.container_smoke.time.sleep"),
            self.assertRaises(RuntimeError),
        ):
            main()
