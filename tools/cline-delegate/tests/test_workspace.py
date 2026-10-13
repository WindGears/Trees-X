from __future__ import annotations

import codecs
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import workspace
from workspace import StagedWorkspace, Workspace, WorkspaceError


class WorkspaceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="trees-cline-workspace-")
        self.addCleanup(self.temporary.cleanup)
        self.container = Path(self.temporary.name)
        self.root = self.container / "selected-project"
        self.root.mkdir()
        self.state = self.container / "private-stage"

    def put(self, path: str, content: str | bytes) -> Path:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode("utf-8") if isinstance(content, str) else content)
        return target

    def stage(self, reads: list[str], writes: list[str], name: str = "private-stage") -> StagedWorkspace:
        return StagedWorkspace(self.root, self.container / name, reads, writes)

    def two_file_stage(self) -> StagedWorkspace:
        self.put("a.txt", "original a\n")
        self.put("b.txt", "original b\n")
        stage = self.stage([], ["a.txt", "b.txt"])
        stage.write("a.txt", "proposal a\n")
        stage.write("b.txt", "proposal b\n")
        return stage

    def test_selected_root_and_literal_search(self) -> None:
        self.put("src/input.txt", "line one\nneedle here\nneedle again\n")
        selected = Workspace(self.root)
        result = selected.read("src\\input.txt")
        self.assertEqual(result["path"], "src/input.txt")
        self.assertEqual(result["sha256"], hashlib.sha256((self.root / "src/input.txt").read_bytes()).hexdigest())
        self.assertEqual(selected.search("needle", ["src/input.txt"], 1), [
            {"path": "src/input.txt", "line": 2, "text": "needle here"}])
        self.assertFalse(hasattr(selected, "execute"))

    def test_unsafe_windows_and_relative_paths(self) -> None:
        selected = Workspace(self.root)
        paths = ["../outside.txt", "src/../a.txt", "./a.txt", "/absolute.txt",
                 "C:/a.txt", "C:a.txt", "\\\\host\\share\\file.txt", "\\\\?\\C:\\a.txt",
                 "a.txt:stream", "a.txt.", "folder /a.txt", "a.txt ", "a//b.txt",
                 "CON", "con.txt", "NUL.txt", "AUX/a.txt", "COM1.txt", "lpt9.md",
                 "COM¹.txt", "CONOUT$.txt", "a|b.txt", "a<b.txt", "a\x00b.txt"]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(WorkspaceError):
                selected.validate_path(path, write=True)

    def test_protected_credentials_are_unavailable(self) -> None:
        selected = Workspace(self.root)
        paths = ["config.toml", "src/auth.json", ".npmrc", "id_rsa", "id_ed25519",
                 "id_rsa.pub", "id_rsa_backup", ".npmrc.local", ".yarnrc.yml",
                 ".workbuddy/settings.json", ".claude/settings.json",
                 ".codex/config.toml", ".git/config", ".ssh/known_hosts", ".aws/config",
                 ".docker/config.json", ".netrc", "credentials.json", "secrets.yaml",
                 "access-token.txt", ".env.local", "private.pem", "dump.sql.bak", "logs/run.txt"]
        for path in paths:
            with self.subTest(path=path), self.assertRaises(WorkspaceError):
                selected.validate_path(path, write=True)
        self.assertEqual(selected.validate_path("src/config.json", write=True), self.root / "src/config.json")

    def test_binary_invalid_utf8_and_file_limits(self) -> None:
        for path, data in (("nul.txt", b"abc\x00def"), ("bytes.txt", b"\xff"),
                           ("large.txt", b"x" * (workspace.MAX_FILE_BYTES + 1))):
            self.put(path, data)
            with self.subTest(path=path), self.assertRaises(WorkspaceError):
                Workspace(self.root).read(path)
        self.put("input.txt", "ok\n")
        with self.assertRaises(WorkspaceError):
            Workspace(self.root).search("ok", ["input.txt"] * 51)
        with self.assertRaises(WorkspaceError):
            self.stage(["input.txt"] * 51, [])
        with self.assertRaises(WorkspaceError):
            self.stage([], [f"new-{index}.txt" for index in range(21)])

    def test_aggregate_snapshot_limit(self) -> None:
        paths = [f"large-{index}.txt" for index in range(5)]
        for path in paths:
            self.put(path, b"x" * workspace.MAX_FILE_BYTES)
        with self.assertRaises(WorkspaceError):
            self.stage(paths, [])
        self.assertFalse(self.state.exists())

    def test_reject_hard_link_target_and_stored_content(self) -> None:
        target = self.put("input.txt", "original\n")
        link = self.container / "outside-link.txt"
        try:
            os.link(target, link)
        except OSError:
            self.skipTest("Filesystem does not support hard links.")
        with self.assertRaises(WorkspaceError):
            Workspace(self.root).read("input.txt")
        with self.assertRaises(WorkspaceError):
            self.stage(["input.txt"], [])
        link.unlink()
        stage = self.stage(["input.txt"], [])
        os.link(self.state / "0.base", link)
        with self.assertRaises(WorkspaceError):
            stage.read("input.txt")

    def test_snapshot_isolation_and_immutable_scope(self) -> None:
        target = self.put("input.txt", "original\n")
        self.put("output.txt", "old output\n")
        reads = ["input.txt"]
        writes = ["output.txt", "new.txt"]
        stage = self.stage(reads, writes)
        reads.append("new-outside.txt")
        writes.append("new-outside.txt")
        target.write_text("changed externally\n", encoding="utf-8")
        self.assertEqual(stage.read("input.txt")["content"], "original\n")
        self.assertIn("output.txt", stage.read_paths)
        self.assertEqual(stage.read("output.txt")["content"], "old output\n")
        self.assertIsInstance(stage.read_paths, tuple)
        with self.assertRaises(AttributeError):
            stage.root = self.container
        with self.assertRaises(AttributeError):
            stage.read_paths = ()
        with self.assertRaises(AttributeError):
            stage.write_paths = ()
        with self.assertRaises(WorkspaceError):
            stage.write("input.txt", "not allowed\n")
        with self.assertRaises(WorkspaceError):
            stage.write("new-outside.txt", "not allowed\n")
        with self.assertRaises(WorkspaceError):
            stage.read("new.txt")

    def test_stage_does_not_write_working_files_and_applies_idempotently(self) -> None:
        source = self.put("src/input.txt", "input\n")
        target = self.put("src/output.txt", "before\n")
        stage = self.stage(["src/input.txt"], ["src/output.txt", "nested/new.txt"])
        stage.write("src/output.txt", "after\n")
        stage.write("nested/new.txt", "new file\n")
        self.assertEqual(target.read_text(), "before\n")
        self.assertFalse((self.root / "nested").exists())
        difference = stage.diff()
        self.assertIn("-before\n+after\n", difference["files"][1]["diff"])
        self.assertIn("compensating rollback", difference["atomicity"])
        result = stage.apply(str(difference["digest"]))
        self.assertEqual(result["status"], "applied")
        self.assertEqual(target.read_text(), "after\n")
        self.assertEqual((self.root / "nested/new.txt").read_text(), "new file\n")
        self.assertEqual(source.read_text(), "input\n")
        self.assertEqual(stage.apply(str(difference["digest"]))["status"], "already_applied")
        self.assertEqual(stage.diff()["digest"], difference["digest"])

    def test_crlf_bom_and_existing_mode_are_preserved(self) -> None:
        target = self.put("output.txt", codecs.BOM_UTF8 + b"before\r\nsecond\r\n")
        if os.name != "nt":
            target.chmod(0o640)
        original_mode = stat.S_IMODE(target.stat().st_mode)
        stage = self.stage([], ["output.txt"])
        stage.write("output.txt", "after\nsecond\n")
        self.assertEqual(stage.read("output.txt")["content"], "after\r\nsecond\r\n")
        stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(target.read_bytes(), codecs.BOM_UTF8 + b"after\r\nsecond\r\n")
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), original_mode)

    def test_persistent_load_keeps_snapshot_proposal_and_applied_digest(self) -> None:
        self.put("input.txt", "input\n")
        stage = self.stage(["input.txt"], ["new.txt"])
        stage.write("new.txt", "proposal\n")
        digest = str(stage.diff()["digest"])
        loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.diff()["digest"], digest)
        self.assertEqual(loaded.read("new.txt")["content"], "proposal\n")
        self.assertEqual(loaded.apply(digest)["status"], "applied")
        self.assertEqual(StagedWorkspace.load(self.root, self.state).apply(digest)["status"], "already_applied")
        other_root = self.container / "other"
        other_root.mkdir()
        with self.assertRaises(WorkspaceError):
            StagedWorkspace.load(other_root, self.state)

    def test_dirty_read_input_blocks_apply_without_writes(self) -> None:
        source = self.put("input.txt", "input\n")
        stage = self.stage(["input.txt"], ["new.txt"])
        stage.write("new.txt", "proposal\n")
        source.write_text("dirty user edit\n", encoding="utf-8")
        with self.assertRaises(WorkspaceError):
            stage.apply(str(stage.diff()["digest"]))
        self.assertFalse((self.root / "new.txt").exists())
        self.assertFalse((self.state / "journal.json").exists())
        self.assertEqual(stage.status, "staging")

    def test_binary_live_files_do_not_hide_captured_snapshots_or_proposals(self) -> None:
        source = self.put("input.txt", "captured input\n")
        stage = self.stage(["input.txt"], ["new.txt"])
        stage.write("new.txt", "captured proposal\n")
        digest = str(stage.diff()["digest"])
        source_binary = b"\xff\x00external source"
        new_binary = b"\xfe\x00external new file"
        source.write_bytes(source_binary)
        target = self.put("new.txt", new_binary)
        self.assertEqual(stage.read("input.txt")["content"], "captured input\n")
        self.assertEqual(stage.read("new.txt")["content"], "captured proposal\n")
        loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.status, "staging")
        self.assertEqual(loaded.diff()["digest"], digest)
        self.assertEqual(loaded.read("input.txt")["content"], "captured input\n")
        self.assertEqual(loaded.read("new.txt")["content"], "captured proposal\n")
        with self.assertRaisesRegex(WorkspaceError, "Workspace changed"):
            loaded.apply(digest)
        self.assertEqual(source.read_bytes(), source_binary)
        self.assertEqual(target.read_bytes(), new_binary)
        with self.assertRaises(WorkspaceError):
            Workspace(self.root).read("input.txt")

    def test_content_independent_snapshot_checks_still_reject_unsafe_live_types(self) -> None:
        target = self.put("input.txt", "captured\n")
        stage = self.stage(["input.txt"], [])
        target.unlink()
        target.mkdir()
        with self.assertRaises(WorkspaceError):
            stage.read("input.txt")
        with self.assertRaises(WorkspaceError):
            StagedWorkspace.load(self.root, self.state)
        target.rmdir()
        target.write_bytes(b"\xffexternal binary")
        hard_link = self.container / "outside-hard-link.txt"
        try:
            os.link(target, hard_link)
        except OSError:
            self.skipTest("Filesystem does not support hard links.")
        with self.assertRaises(WorkspaceError):
            stage.read("input.txt")
        with self.assertRaises(WorkspaceError):
            StagedWorkspace.load(self.root, self.state)

    def test_diff_digest_binds_root_all_read_bases_and_scopes(self) -> None:
        self.put("input.txt", "one\n")
        self.put("context.txt", "context\n")
        stage = self.stage(["input.txt"], ["new.txt"])
        stage.write("new.txt", "proposal\n")
        digest = stage.diff()["digest"]
        different_scope = self.stage(["input.txt", "context.txt"], ["new.txt"], "other-scope")
        different_scope.write("new.txt", "proposal\n")
        self.assertNotEqual(digest, different_scope.diff()["digest"])
        expanded_write = self.stage(["input.txt"], ["new.txt", "unused.txt"], "other-write")
        expanded_write.write("new.txt", "proposal\n")
        self.assertNotEqual(digest, expanded_write.diff()["digest"])
        self.put("input.txt", "two\n")
        changed_read = self.stage(["input.txt"], ["new.txt"], "other-read")
        changed_read.write("new.txt", "proposal\n")
        self.assertNotEqual(digest, changed_read.diff()["digest"])
        alternate_root = self.container / "alternate"
        alternate_root.mkdir()
        (alternate_root / "input.txt").write_text("one\n", encoding="utf-8")
        moved = StagedWorkspace(alternate_root, self.container / "other-root", ["input.txt"], ["new.txt"])
        moved.write("new.txt", "proposal\n")
        self.assertNotEqual(digest, moved.diff()["digest"])
        with self.assertRaises(WorkspaceError):
            changed_read.apply(str(digest))

    def test_staged_content_and_manifest_tampering_are_rejected(self) -> None:
        self.put("input.txt", "input\n")
        stage = self.stage(["input.txt"], ["new.txt"])
        proposal = stage.write("new.txt", "proposal\n")
        digest = str(stage.diff()["digest"])
        path = self.state / f"{proposal['sha256']}.proposal"
        path.write_text("tampered\n", encoding="utf-8")
        with self.assertRaises(WorkspaceError):
            stage.apply(digest)
        self.assertFalse((self.root / "new.txt").exists())
        path.write_text("proposal\n", encoding="utf-8")
        manifest_path = self.state / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["write_paths"].append("outside.txt")
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaises(WorkspaceError):
            StagedWorkspace.load(self.root, self.state)

    def test_toctou_during_prepare_preserves_external_change(self) -> None:
        stage = self.two_file_stage()
        actual_proposal = stage._proposal
        changed = False

        def mutate_before_prepare(entry):
            nonlocal changed
            if stage.status == "applying" and not changed:
                changed = True
                (self.root / "b.txt").write_text("external edit\n", encoding="utf-8")
            return actual_proposal(entry)

        with patch.object(stage, "_proposal", side_effect=mutate_before_prepare):
            result = stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(result["status"], "rolled_back")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "external edit\n")

    def test_replace_failure_rolls_back_and_preserves_mode(self) -> None:
        stage = self.two_file_stage()
        original_mode = stat.S_IMODE((self.root / "a.txt").stat().st_mode)
        actual_replace = workspace.os.replace
        failed_once = False

        def fail_second(source, destination):
            nonlocal failed_once
            if Path(destination) == self.root / "b.txt" and not failed_once:
                failed_once = True
                raise OSError("injected replace failure")
            return actual_replace(source, destination)

        with patch.object(workspace.os, "replace", side_effect=fail_second):
            result = stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(result["status"], "rolled_back")
        self.assertEqual(result["files"], ["a.txt"])
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        self.assertEqual(stat.S_IMODE((self.root / "a.txt").stat().st_mode), original_mode)
        self.assertEqual(StagedWorkspace.load(self.root, self.state).status, "staging")
        stage.write("a.txt", "revised proposal\n")
        self.assertEqual(StagedWorkspace.load(self.root, self.state).read("a.txt")["content"], "revised proposal\n")

    def test_journal_must_exist_before_first_working_replace(self) -> None:
        stage = self.two_file_stage()
        actual_replace = workspace.os.replace
        observed = []

        def observe(source, destination):
            if Path(destination).parent == self.root:
                journal = json.loads((self.state / "journal.json").read_text(encoding="utf-8"))
                manifest = json.loads((self.state / "manifest.json").read_text(encoding="utf-8"))
                self.assertEqual(journal["status"], "applying")
                self.assertEqual(manifest["status"], "applying")
                self.assertEqual(len(journal["files"]), 2)
                observed.append(Path(destination).name)
            return actual_replace(source, destination)

        with patch.object(workspace.os, "replace", side_effect=observe):
            self.assertEqual(stage.apply(str(stage.diff()["digest"]))["status"], "applied")
        self.assertEqual(observed, ["a.txt", "b.txt"])

    def test_journal_write_failure_prevents_working_replacement(self) -> None:
        stage = self.two_file_stage()
        with patch.object(stage, "_save_journal", side_effect=OSError("cannot persist journal")):
            result = stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(result["status"], "rolled_back")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        self.assertFalse(list(self.root.glob(".cline-*")))

    def test_rollback_preserves_external_edits_and_requires_recovery(self) -> None:
        stage = self.two_file_stage()
        actual_replace = workspace.os.replace

        def edit_then_fail(source, destination):
            if Path(destination) == self.root / "b.txt":
                (self.root / "a.txt").write_text("external edit after apply\n", encoding="utf-8")
                raise OSError("injected second replace failure")
            return actual_replace(source, destination)

        with patch.object(workspace.os, "replace", side_effect=edit_then_fail):
            result = stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(result["status"], "rollback_incomplete")
        self.assertEqual(result["failed"], ["a.txt"])
        self.assertEqual((self.root / "a.txt").read_text(), "external edit after apply\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        self.assertEqual(stage.status, "recovery_required")
        loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.status, "recovery_required")
        with self.assertRaises(WorkspaceError):
            loaded.apply(str(loaded.diff()["digest"]))
        self.assertEqual(loaded.recover()["status"], "rollback_incomplete")
        self.assertEqual((self.root / "a.txt").read_text(), "external edit after apply\n")

    def test_stage_hash_change_after_preparation_blocks_replacement(self) -> None:
        stage = self.two_file_stage()
        digest = str(stage.diff()["digest"])
        actual_verify = stage._verify_inputs
        verifications = 0

        def tamper(*args, **kwargs):
            nonlocal verifications
            actual_verify(*args, **kwargs)
            verifications += 1
            if verifications == 2:
                proposal_hash = stage._entries[0]["proposed_sha256"]
                (self.state / f"{proposal_hash}.proposal").write_text("tampered\n", encoding="utf-8")

        with patch.object(stage, "_verify_inputs", side_effect=tamper):
            result = stage.apply(digest)
        self.assertEqual(result["status"], "rolled_back")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")

    def test_interrupted_apply_load_requires_explicit_rollback(self) -> None:
        stage = self.two_file_stage()
        digest = str(stage.diff()["digest"])
        actual_replace = workspace.os.replace

        def stop_after_replace(source, destination):
            result = actual_replace(source, destination)
            if Path(destination) == self.root / "a.txt":
                raise KeyboardInterrupt("simulate process interruption before journal update")
            return result

        with patch.object(workspace.os, "replace", side_effect=stop_after_replace), self.assertRaises(KeyboardInterrupt):
            stage.apply(digest)
        self.assertEqual((self.root / "a.txt").read_text(), "proposal a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        with patch.object(workspace.os, "replace", wraps=actual_replace) as replacement:
            loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.status, "recovery_required")
        self.assertTrue(all(Path(call.args[1]).parent != self.root for call in replacement.call_args_list))
        self.assertEqual((self.root / "a.txt").read_text(), "proposal a\n")
        with self.assertRaises(WorkspaceError):
            loaded.apply(digest)
        with self.assertRaises(WorkspaceError):
            loaded.write("a.txt", "forbidden while recovery\n")
        with self.assertRaises(WorkspaceError):
            loaded.cancel()
        self.assertEqual(loaded.recover()["status"], "rolled_back")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        self.assertFalse(list(self.root.glob(".cline-*")))
        self.assertEqual(StagedWorkspace.load(self.root, self.state).status, "staging")

    def test_interrupted_apply_binary_conflicts_remain_inspectable_and_preserved(self) -> None:
        for label, existed in (("existing", True), ("new", False)):
            with self.subTest(base=label):
                path = f"case-{label}/output.txt"
                if existed:
                    self.put(path, "original\n")
                stage = self.stage([], [path], f"stage-{label}")
                stage.write(path, "proposal\n")
                digest = str(stage.diff()["digest"])
                target = self.root / path
                binary = b"\xff\x00external binary edit"
                actual_replace = workspace.os.replace

                def stop_after_external_binary_edit(source, destination):
                    result = actual_replace(source, destination)
                    if Path(destination) == target:
                        target.write_bytes(binary)
                        raise KeyboardInterrupt("interrupt after external binary edit")
                    return result

                with patch.object(workspace.os, "replace", side_effect=stop_after_external_binary_edit), self.assertRaises(KeyboardInterrupt):
                    stage.apply(digest)
                state_dir = self.container / f"stage-{label}"
                loaded = StagedWorkspace.load(self.root, state_dir)
                self.assertEqual(loaded.status, "recovery_required")
                self.assertEqual(loaded.read(path)["content"], "proposal\n")
                self.assertEqual(loaded.diff()["digest"], digest)
                self.assertEqual(target.read_bytes(), binary)
                result = loaded.recover()
                self.assertEqual(result["status"], "rollback_incomplete")
                self.assertEqual(result["failed"], [path])
                self.assertEqual(target.read_bytes(), binary)
                restarted = StagedWorkspace.load(self.root, state_dir)
                self.assertEqual(restarted.status, "recovery_required")
                self.assertEqual(restarted.read(path)["content"], "proposal\n")
                self.assertEqual(restarted.diff()["digest"], digest)

    def test_preparation_interruption_has_durable_cleanup_ownership(self) -> None:
        stage = self.stage([], ["nested/new.txt"])
        stage.write("nested/new.txt", "proposal\n")
        actual_proposal = stage._proposal

        def stop_during_prepare(entry):
            if stage.status == "applying":
                raise KeyboardInterrupt("interrupted after creating journaled replacement")
            return actual_proposal(entry)

        with patch.object(stage, "_proposal", side_effect=stop_during_prepare), self.assertRaises(KeyboardInterrupt):
            stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(stage.status, "applying")
        self.assertTrue((self.root / "nested").exists())
        self.assertTrue(list((self.root / "nested").glob(".cline-*")))
        loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.status, "recovery_required")
        self.assertFalse((self.root / "nested/new.txt").exists())
        self.assertEqual(loaded.recover()["status"], "rolled_back")
        self.assertFalse((self.root / "nested").exists())

    def test_in_memory_idle_status_cannot_bypass_pending_journal(self) -> None:
        stage = self.two_file_stage()
        actual_save = stage._save

        def stop_before_applying_manifest(*args, **kwargs):
            if kwargs.get("status") == "applying":
                raise KeyboardInterrupt("journal persisted before in-memory applying state")
            return actual_save(*args, **kwargs)

        with patch.object(stage, "_save", side_effect=stop_before_applying_manifest), self.assertRaises(KeyboardInterrupt):
            stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(stage.status, "staging")
        with self.assertRaises(WorkspaceError):
            stage.cancel()
        self.assertEqual(stage.status, "recovery_required")
        self.assertEqual(stage.recover()["status"], "rolled_back")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual((self.root / "b.txt").read_text(), "original b\n")
        self.assertFalse(list(self.root.glob(".cline-*")))
        self.assertEqual(StagedWorkspace.load(self.root, self.state).status, "staging")

    def test_interruption_between_journal_and_applying_manifest(self) -> None:
        stage = self.two_file_stage()
        actual_save = stage._save

        def stop_before_applying_manifest(*args, **kwargs):
            if kwargs.get("status") == "applying":
                raise KeyboardInterrupt("journal persisted before applying manifest")
            return actual_save(*args, **kwargs)

        with patch.object(stage, "_save", side_effect=stop_before_applying_manifest), self.assertRaises(KeyboardInterrupt):
            stage.apply(str(stage.diff()["digest"]))
        self.assertEqual(json.loads((self.state / "manifest.json").read_text())["status"], "staging")
        loaded = StagedWorkspace.load(self.root, self.state)
        self.assertEqual(loaded.status, "recovery_required")
        self.assertEqual((self.root / "a.txt").read_text(), "original a\n")
        self.assertEqual(loaded.recover()["status"], "rolled_back")

    def test_cancellation_never_writes_working_files(self) -> None:
        target = self.put("output.txt", "original\n")
        stage = self.stage([], ["output.txt", "new.txt"])
        stage.write("output.txt", "proposal\n")
        stage.write("new.txt", "proposal\n")
        self.assertEqual(stage.cancel(), {"status": "cancelled", "files": []})
        self.assertEqual(target.read_text(), "original\n")
        self.assertFalse((self.root / "new.txt").exists())
        self.assertEqual(StagedWorkspace.load(self.root, self.state).status, "cancelled")
        with self.assertRaises(WorkspaceError):
            stage.apply(str(stage.diff()["digest"]))
        with self.assertRaises(WorkspaceError):
            stage.write("new.txt", "another\n")

    @unittest.skipUnless(os.name == "nt", "Actual Windows junction validation.")
    def test_actual_windows_junction_and_root_ancestor_are_rejected(self) -> None:
        actual = self.container / "actual-directory"
        (actual / "nested").mkdir(parents=True)
        (actual / "nested/input.txt").write_text("outside\n", encoding="utf-8")
        junction = self.root / "junction"
        environment = dict(os.environ, TREES_TEST_JUNCTION=str(junction), TREES_TEST_TARGET=str(actual))
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
                                 "New-Item -ItemType Junction -Path $env:TREES_TEST_JUNCTION -Target $env:TREES_TEST_TARGET | Out-Null"],
                                env=environment, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            self.skipTest("This Windows environment cannot create junctions.")
        self.addCleanup(lambda: junction.rmdir() if junction.exists() else None)
        self.assertTrue(workspace._is_link(junction))
        with self.assertRaises(WorkspaceError):
            Workspace(self.root).read("junction/nested/input.txt")
        with self.assertRaises(WorkspaceError):
            Workspace(junction / "nested")
        with self.assertRaises(WorkspaceError):
            StagedWorkspace(self.root, junction / "stage", [], ["new.txt"])

    @unittest.skipIf(os.name == "nt", "Windows uses the actual junction test.")
    def test_actual_symlink_and_root_ancestor_are_rejected(self) -> None:
        actual = self.container / "actual-directory"
        (actual / "nested").mkdir(parents=True)
        (actual / "nested/input.txt").write_text("outside\n", encoding="utf-8")
        symlink = self.root / "symlink"
        symlink.symlink_to(actual, target_is_directory=True)
        with self.assertRaises(WorkspaceError):
            Workspace(self.root).read("symlink/nested/input.txt")
        with self.assertRaises(WorkspaceError):
            Workspace(symlink / "nested")


if __name__ == "__main__":
    unittest.main()
