#!/usr/bin/env python3
"""Offline end-to-end smoke: real Pi CLI + synthetic history, no model/API calls.

POSIX only (Linux/macOS). Uses an isolated HOME/config/cwd and a real PTY.
The extension must recover text that is absent from the compacted main view,
then survive /reload and both renderer modes. No user session is ever opened.
"""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "node_modules/@earendil-works/pi-coding-agent"
PACKAGE = json.loads((HOST / "package.json").read_text())
CLI = HOST / PACKAGE["bin"]["pi"]
NODE = shutil.which("node")
assert NODE, "Node.js is required"


def make_session(directory):
    stamp = "2026-01-01T00:00:00.000Z"
    entries = [{"type": "session", "version": 3, "id": "11111111-1111-4111-8111-111111111111", "timestamp": stamp, "cwd": str(directory)}]
    parent = None

    def add(kind, **fields):
        nonlocal parent
        entry_id = f"{len(entries):08x}"
        entries.append({"type": kind, "id": entry_id, "parentId": parent, "timestamp": stamp, **fields})
        parent = entry_id
        return entry_id

    def assistant(blocks):
        return {"role": "assistant", "content": blocks, "api": "anthropic-messages", "provider": "anthropic", "model": "claude-sonnet-4-5", "stopReason": "stop", "timestamp": 1,
                "usage": {"input": 1, "output": 1, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 2, "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0}}}

    add("message", message={"role": "user", "content": "The oldest question: RETRIEVED_OLD_TURN. 中文问题。", "timestamp": 1})
    add("message", message=assistant([{"type": "toolCall", "name": "bash", "id": "tool-1", "arguments": {"command": "echo synthetic"}}]))
    add("message", message={"role": "toolResult", "toolCallId": "tool-1", "toolName": "bash", "content": [{"type": "text", "text": "needle: RETRIEVED_TOOL_OUTPUT"}], "isError": False, "timestamp": 2})
    add("message", message=assistant([{"type": "text", "text": "Original answer."}]))
    kept = add("message", message={"role": "user", "content": "LATEST_REQUEST_SENTINEL", "timestamp": 3})
    add("message", message=assistant([{"type": "text", "text": "Latest response."}]))
    add("compaction", summary="Synthetic compacted context.", firstKeptEntryId=kept, tokensBefore=80000)
    path = directory / "synthetic.jsonl"
    path.write_text("".join(json.dumps(entry) + "\n" for entry in entries))
    return path


def run(mode):
    with tempfile.TemporaryDirectory(prefix="pi-transcript-pty-") as temp:
        work = Path(temp)
        session = make_session(work)
        env = {"PATH": os.environ.get("PATH", ""), "HOME": str(work), "TMPDIR": str(work),
               "TERM": "xterm-256color", "LANG": "en_US.UTF-8", "SHELL": "/bin/sh",
               "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_CODING_AGENT_DIR": str(work / "agent")}
        args = [NODE, str(CLI), "--offline", "--no-approve", "--no-context-files", "--no-extensions",
                "--no-skills", "--no-prompt-templates", "--no-themes", "-e", str(ROOT / "src/index.ts"),
                "--session", str(session), "--tui-mode", mode]
        pid, master = pty.fork()
        if pid == 0:
            os.chdir(work)
            os.execve(NODE, args, env)
        transcript = bytearray()
        reaped = False

        def resize(rows, columns):
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
            os.kill(pid, signal.SIGWINCH)

        def pump(seconds=0.25):
            deadline = time.monotonic() + seconds
            chunk = bytearray()
            while time.monotonic() < deadline:
                ready, _, _ = select.select([master], [], [], max(0, deadline - time.monotonic()))
                if not ready:
                    break
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                transcript.extend(data)
                chunk.extend(data)
            return chunk

        def wait(text, start=0, seconds=12):
            deadline = time.monotonic() + seconds
            needle = text.encode()
            while time.monotonic() < deadline:
                pump(0.1)
                if needle in transcript[start:]:
                    return
            raise AssertionError(f"{mode}: did not render {text!r}")

        def send(text):
            start = len(transcript)
            os.write(master, text.encode())
            return start

        try:
            resize(28, 100)
            wait("LATEST_REQUEST_SENTINEL")
            pump(0.5)
            assert b"RETRIEVED_OLD_TURN" not in transcript, "Compacted main view unexpectedly included original turn"
            start = send("/transcript oldest\r")
            wait("RETRIEVED_OLD_TURN", start)
            send("\x1b")
            pump(0.3)
            start = send("/transcript needle\r")
            wait("RETRIEVED_TOOL_OUTPUT", start)
            resize(16, 42)
            pump(0.3)
            resize(28, 100)
            pump(0.3)
            send("\x1b")
            pump(0.3)
            start = send("/reload\r")
            wait("Reloaded", start)
            pump(0.2)
            start = send("/transcript oldest\r")
            wait("RETRIEVED_OLD_TURN", start)
            send("\x1b")
            pump(0.3)
            send("/quit\r")
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                pump(0.1)
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    reaped = True
                    assert os.waitstatus_to_exitcode(status) == 0, f"Pi exited with status {status}"
                    break
            assert reaped, "Pi did not exit after /quit"
            raw = session.read_text()
            assert raw.count("RETRIEVED_OLD_TURN") == 1, "Original turn duplicated or lost in storage"
            assert raw.count("RETRIEVED_TOOL_OUTPUT") == 1, "Tool result duplicated or lost in storage"
            assert b"exiting due to uncaughtException" not in transcript
            print(f"PASS Pi {PACKAGE['version']} {mode}: old history, folded-result search, resize, reload, clean exit")
        except Exception:
            artifacts = ROOT / ".test-artifacts"
            artifacts.mkdir(exist_ok=True)
            (artifacts / f"pty-{mode}.log").write_bytes(transcript)
            print(f"Synthetic-only failure log: .test-artifacts/pty-{mode}.log", file=sys.stderr)
            raise
        finally:
            if not reaped:
                try:
                    os.kill(pid, signal.SIGTERM)
                    os.waitpid(pid, 0)
                except ProcessLookupError:
                    pass
            os.close(master)


if __name__ == "__main__":
    for mode in ["regular", "fullscreen"]:
        run(mode)
