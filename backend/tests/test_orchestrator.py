"""Tests for the Evon orchestrator plan generation."""

import unittest

from pipeline.orchestrator import plan_from_transcript


class TestOrchestrator(unittest.TestCase):
    def setUp(self):
        self.tools = [
            {"name": "read_file", "description": "Read a file"},
            {"name": "write_file", "description": "Write a file"},
            {"name": "run_script", "description": "Run a script"},
        ]

    def test_read_intent(self):
        plan = plan_from_transcript("show me the file app/page.tsx", self.tools)
        self.assertEqual(plan["action"], "read")
        self.assertEqual(plan["tool"], "read_file")

    def test_write_intent(self):
        plan = plan_from_transcript("write a python function", self.tools)
        self.assertEqual(plan["action"], "write")
        self.assertEqual(plan["tool"], "write_file")

    def test_run_intent(self):
        plan = plan_from_transcript("execute this script", self.tools)
        self.assertEqual(plan["action"], "run")
        self.assertEqual(plan["tool"], "run_script")

    def test_no_intent(self):
        plan = plan_from_transcript("ummmm", self.tools)
        self.assertEqual(plan["action"], "none")


if __name__ == "__main__":
    unittest.main()
