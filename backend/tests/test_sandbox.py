"""Tests for the workspace sandbox executor."""

import os
import tempfile
import unittest
from pathlib import Path

from sandbox import SandboxExecutor, SandboxExecutionError


class TestSandboxExecutor(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.executor = SandboxExecutor(root=self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_workspace_created(self):
        ws = self.executor.workspace("test")
        self.assertTrue(ws.is_dir())

    def test_read_nonexistent_file(self):
        ws = self.executor.workspace("t")
        with self.assertRaises(SandboxExecutionError):
            self.executor.read(ws, "nonexistent.txt")

    def test_write_read_roundtrip(self):
        ws = self.executor.workspace("t")
        self.executor.write(ws, "hello.txt", "hello world")
        content = self.executor.read(ws, "hello.txt")
        self.assertEqual(content, "hello world")

    def test_run_script(self):
        ws = self.executor.workspace("t")
        self.executor.write(ws, "hello.py", "print('hello from python')")
        output = self.executor.run(ws, "hello.py")
        self.assertIn("hello from python", output)

    def test_run_script_with_args(self):
        ws = self.executor.workspace("t")
        self.executor.write(ws, "echo_args.py", "import sys; print(' '.join(sys.argv[1:]))")
        output = self.executor.run(ws, "echo_args.py", ["arg1", "arg2"])
        self.assertIn("arg1 arg2", output)

    def test_run_script_exit_code(self):
        ws = self.executor.workspace("t")
        self.executor.write(ws, "fail.py", "raise SystemExit(1)")
        with self.assertRaises(SandboxExecutionError):
            self.executor.run(ws, "fail.py")


if __name__ == "__main__":
    unittest.main()
