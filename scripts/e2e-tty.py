#!/usr/bin/env python3
"""End-to-end test of the interactive flow under a real pseudo-terminal.

The agents are replaced by fake executables that only record how they were called,
so the whole search -> select -> confirm -> resume flow runs without ever starting
a real `claude` or `codex`. Requires a built CLI (`npm run build`) and Node on PATH.
"""
import json
import os
import pty
import re
import select
import shutil
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "dist", "cli", "main.js")
NODE = shutil.which("node")
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")

ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ID_C = "01a00000-0000-7000-8000-0000000000c3"


class Sandbox:
    def __init__(self, extra_sessions=0, missing_claude=False):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="sesq-e2e-"))
        self.home = os.path.join(self.root, "home")
        self.work_a = os.path.join(self.root, "work-a")
        self.work_c = os.path.join(self.root, "work-c")
        self.current = os.path.join(self.root, "current")
        self.record = os.path.join(self.root, "record.txt")
        for path in (self.home, self.work_a, self.work_c, self.current):
            os.makedirs(path)

        bin_dir = os.path.join(self.root, "bin")
        os.makedirs(bin_dir)
        for name in ("claude", "codex"):
            path = os.path.join(bin_dir, name)
            with open(path, "w") as handle:
                handle.write('#!/bin/sh\nprintf "%s|%s|%s\\n" "${0##*/}" "$(pwd -P)" "$*" >> "$SESQ_RECORD"\nexit 0\n')
            os.chmod(path, 0o755)
        self.bin_dir = bin_dir

        now = time.time()
        self.claude_session(ID_A, self.work_a, "timeout in alpha", now - 10)
        self.claude_session(ID_B, "/definitely/not/here/xyz", "timeout in beta", now - 20)
        self.codex_archived(ID_C, self.work_c, "timeout in gamma", now - 30)
        for index in range(extra_sessions):
            extra_id = f"cccccccc-cccc-4ccc-8ccc-{index:012d}"
            self.claude_session(extra_id, self.work_a, f"timeout extra {index}", now - 100 - index)

        config_dir = os.path.join(self.home, ".config", "sesq")
        os.makedirs(config_dir)
        with open(os.path.join(config_dir, "config.json"), "w") as handle:
            claude_path = os.path.join(self.root, "does-not-exist", "claude") if missing_claude else os.path.join(bin_dir, "claude")
            json.dump({"agents": {"claude": {"executable": claude_path},
                                  "codex": {"executable": os.path.join(bin_dir, "codex")}}}, handle)

    def claude_session(self, session_id, cwd, text, mtime):
        directory = os.path.join(self.home, ".claude", "projects", "-e2e")
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"{session_id}.jsonl")
        lines = [{"type": "user", "cwd": cwd, "timestamp": "2026-01-01T00:00:00.000Z",
                  "message": {"role": "user", "content": text}}]
        with open(path, "w") as handle:
            handle.write("\n".join(json.dumps(line) for line in lines))
        os.utime(path, (mtime, mtime))

    def codex_archived(self, session_id, cwd, text, mtime):
        directory = os.path.join(self.home, ".codex", "archived_sessions")
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"rollout-2026-01-03T00-00-00-{session_id}.jsonl")
        lines = [
            {"type": "session_meta", "payload": {"id": session_id, "session_id": session_id, "cwd": cwd,
                                                 "timestamp": "2026-01-03T00:00:00.000Z"}},
            {"type": "response_item", "timestamp": "2026-01-03T00:00:01.000Z",
             "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}},
        ]
        with open(path, "w") as handle:
            handle.write("\n".join(json.dumps(line) for line in lines))
        os.utime(path, (mtime, mtime))

    def env(self):
        return {"HOME": self.home, "PATH": os.path.dirname(NODE), "NO_COLOR": "1", "TERM": "xterm",
                "SESQ_RECORD": self.record}

    def records(self):
        if not os.path.exists(self.record):
            return []
        with open(self.record) as handle:
            return [line.rstrip("\n") for line in handle if line.strip()]

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


class Terminal:
    def __init__(self, sandbox, args, cwd=None):
        self.buffer = ""
        self.position = 0
        self.closed = False
        self.exit_code = None
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(cwd or sandbox.current)
            os.execve(NODE, [NODE, MAIN] + args, sandbox.env())
        self.pid, self.fd = pid, fd

    def pump(self, seconds):
        deadline = time.time() + seconds
        while not self.closed and time.time() < deadline:
            ready, _, _ = select.select([self.fd], [], [], 0.05)
            if not ready:
                continue
            try:
                data = os.read(self.fd, 4096)
            except OSError:
                data = b""
            if not data:
                self.closed = True
                break
            self.buffer += ANSI.sub("", data.decode("utf-8", errors="replace"))

    def expect(self, pattern, timeout=10):
        regex = re.compile(pattern)
        deadline = time.time() + timeout
        while True:
            match = regex.search(self.buffer, self.position)
            if match:
                self.position = match.end()
                return
            if self.closed or time.time() > deadline:
                raise AssertionError(f"timed out waiting for /{pattern}/")
            self.pump(0.1)

    def absent(self, pattern, seconds):
        self.pump(seconds)
        if re.compile(pattern).search(self.buffer, self.position):
            raise AssertionError(f"unexpected /{pattern}/ appeared")

    def send(self, text):
        self.pump(0.25)
        for character in text:
            os.write(self.fd, character.encode())
            self.pump(0.04)

    def finish(self, timeout=10):
        deadline = time.time() + timeout
        while self.exit_code is None and time.time() < deadline:
            self.pump(0.1)
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.exit_code = os.waitstatus_to_exitcode(status)
        if self.exit_code is None:
            raise AssertionError("process did not exit")
        return self.exit_code

    def kill(self):
        if self.exit_code is None:
            try:
                os.kill(self.pid, 9)
                os.waitpid(self.pid, 0)
            except OSError:
                pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def scenario_decline_then_accept(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("1\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("n\r")
    t.expect(r"Cancelled\.")
    t.expect(r"Results 1-3 of 3")
    t.send("1\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("y\r")
    check(t.finish() == 0, "exit code should be 0")
    check(sb.records() == [f"claude|{sb.work_a}|--resume {ID_A}"], f"unexpected launches: {sb.records()}")


def scenario_missing_original_folder(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("2\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("y\r")
    t.expect(r"The original folder no longer exists")
    t.send("3\r")
    t.expect(r"Cancelled\.")
    t.expect(r"Results 1-3 of 3")
    check(sb.records() == [], "nothing may launch after cancelling")
    t.send("2\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("y\r")
    t.expect(r"The original folder no longer exists")
    t.send("1\r")
    check(t.finish() == 0, "exit code should be 0")
    check(sb.records() == [f"claude|{sb.current}|--resume {ID_B}"], f"unexpected launches: {sb.records()}")


def scenario_archived_codex(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("3\r")
    t.expect(r"This session is archived")
    t.send("y\r")
    check(t.finish() == 0, "exit code should be 0")
    expected = [f"codex|{sb.work_c}|unarchive {ID_C}", f"codex|{sb.work_c}|resume {ID_C}"]
    check(sb.records() == expected, f"unexpected launches: {sb.records()}")


def scenario_cwd_current(sb):
    t = Terminal(sb, ["timeout", "--cwd", "current"])
    t.expect(r"Results 1-3 of 3")
    t.send("1\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("y\r")
    check(t.finish() == 0, "exit code should be 0")
    check(sb.records() == [f"claude|{sb.current}|--resume {ID_A}"], f"unexpected launches: {sb.records()}")


def scenario_quit(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("q\r")
    check(t.finish() == 0, "exit code should be 0")
    check(sb.records() == [], "quitting must not launch anything")


def scenario_ctrl_c_at_list(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("\x03")
    t.finish()
    check("Fatal error" not in t.buffer, "Ctrl+C must not print a fatal error")
    check(t.exit_code == 130, f"Ctrl+C should exit with 130, got {t.exit_code}")
    check(sb.records() == [], "Ctrl+C must not launch anything")


def scenario_ctrl_c_at_confirmation(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("1\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("\x03")
    t.finish()
    check("Fatal error" not in t.buffer, "Ctrl+C must not print a fatal error")
    check(t.exit_code == 130, f"Ctrl+C should exit with 130, got {t.exit_code}")
    check(sb.records() == [], "Ctrl+C must not launch anything")


def scenario_missing_executable(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-3 of 3")
    t.send("1\r")
    t.expect(r"Resume this session\? \[y/N\]")
    t.send("y\r")
    t.finish()
    check(t.exit_code == 3, f"exit code should be 3, got {t.exit_code}")
    check("was not found" in t.buffer, "the message must say the executable was not found")
    check("sesq config set claude.executable" in t.buffer, "the message must say how to fix it")
    check("ENOENT" not in t.buffer, "the raw spawn error should not be shown")


def scenario_paging(sb):
    t = Terminal(sb, ["timeout"])
    t.expect(r"Results 1-5 of 11")
    t.send("\r")
    t.expect(r"Results 6-10 of 11")
    t.absent(r"Results 11-11 of 11", 0.6)
    t.send("p\r")
    t.expect(r"Results 1-5 of 11")
    t.absent(r"Results 6-10 of 11", 0.6)
    t.send("q\r")
    check(t.finish() == 0, "exit code should be 0")


SCENARIOS = [
    ("decline returns to the list, then accept launches", 0, scenario_decline_then_accept),
    ("missing original folder menu", 0, scenario_missing_original_folder),
    ("archived Codex session is restored, then resumed", 0, scenario_archived_codex),
    ("--cwd current launches from the current folder", 0, scenario_cwd_current),
    ("q quits without launching", 0, scenario_quit),
    ("Enter/p paging moves exactly one page", 8, scenario_paging),
    ("a missing executable explains how to fix it", 0, scenario_missing_executable),
    ("Ctrl+C at the results list exits cleanly", 0, scenario_ctrl_c_at_list),
    ("Ctrl+C at the confirmation prompt exits cleanly", 0, scenario_ctrl_c_at_confirmation),
]


def main():
    if not NODE:
        print("node not found on PATH")
        return 2
    if not os.path.exists(MAIN):
        print("dist/cli/main.js not found; run `npm run build` first")
        return 2

    failures = 0
    for name, extra, run in SCENARIOS:
        sandbox = Sandbox(extra_sessions=extra, missing_claude=run is scenario_missing_executable)
        terminal_ref = {}
        original_init = Terminal.__init__

        def tracking_init(self, *args, **kwargs):
            original_init(self, *args, **kwargs)
            terminal_ref["t"] = self

        Terminal.__init__ = tracking_init
        try:
            run(sandbox)
            print(f"PASS  {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {name}: {error}")
            terminal = terminal_ref.get("t")
            if terminal:
                print("      --- terminal output ---")
                for line in terminal.buffer.splitlines()[-25:]:
                    print(f"      {line}")
        finally:
            Terminal.__init__ = original_init
            if "t" in terminal_ref:
                terminal_ref["t"].kill()
            sandbox.cleanup()

    print(f"\n{len(SCENARIOS) - failures}/{len(SCENARIOS)} scenarios passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
