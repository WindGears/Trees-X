"""Logical text-file capabilities, not an OS sandbox.

Each replacement is atomic. A multi-file apply uses a durable journal and
compensating rollback; it is not an atomic filesystem transaction. Other local
processes retain OS access, so callers must also isolate untrusted execution.
"""

from __future__ import annotations

import codecs
import difflib
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import secrets
import stat
import tempfile


MAX_FILE_BYTES = 512 * 1024
MAX_READ_BYTES = 2 * 1024 * 1024
MAX_STAGE_BYTES = 4 * 1024 * 1024
MAX_READ_FILES = 50
MAX_WRITE_FILES = 20
_PROTECTED = frozenset({
    ".git", ".codex", ".tools", ".ssh", ".aws", ".azure", ".kube",
    ".workbuddy", ".claude", ".cline", ".gnupg", ".docker",
    "node_modules", "artifacts", "dist", "target", "build", "__pycache__",
    ".venv", "venv", "logs", "backups", "config.toml", "auth.json",
    ".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials",
    ".yarnrc", ".yarnrc.yml", ".boto", "kubeconfig",
})
_SENSITIVE = re.compile(r"(?:^|[._-])(?:credentials?|secrets?|tokens?|passwords?)(?:[._-]|$)", re.I)
_PRIVATE_KEY = re.compile(r"id_(?:rsa|ed25519|ecdsa|dsa)(?:[._-]|$)", re.I)
_DEVICES = re.compile(r"(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])\Z", re.I)
_FORBIDDEN_SUFFIXES = frozenset({
    ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks", ".kdbx",
    ".db", ".sqlite", ".sqlite3", ".dump", ".bak", ".log",
})
_HEX = re.compile(r"[0-9a-f]{64}\Z")
_STATUSES = frozenset({"staging", "applying", "recovery_required", "applied", "cancelled"})
_ATOMICITY = "per-file atomic replacement; multi-file compensating rollback"


class WorkspaceError(ValueError):
    """A safe error whose message never includes file contents or credentials."""


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _is_link(path: Path) -> bool:
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 1024)


def _regular_info(path: Path) -> os.stat_result:
    info = path.lstat()
    if _is_link(path) or not stat.S_ISREG(info.st_mode) or info.st_nlink > 1:
        raise WorkspaceError("Only regular files without links are available.")
    return info


def _text(data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise WorkspaceError("Text file exceeds the size limit.")
    try:
        content = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise WorkspaceError("Only UTF-8 text files are supported.") from None
    if any(ord(char) < 32 and char not in "\t\n\r" for char in content):
        raise WorkspaceError("Binary text content is not supported.")
    return content


def _bytes(path: Path, *, check_text: bool = True) -> bytes:
    """Read bounded regular content; raw mode is only for live conflict checks."""
    try:
        before = _regular_info(path)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb") as handle:
            opened = os.fstat(handle.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink > 1 or (
                before.st_dev, before.st_ino
            ) != (opened.st_dev, opened.st_ino):
                raise WorkspaceError("Text file changed while opening it.")
            data = handle.read(MAX_FILE_BYTES + 1)
            after = _regular_info(path)
            if (after.st_dev, after.st_ino) != (opened.st_dev, opened.st_ino):
                raise WorkspaceError("Text file changed while reading it.")
    except OSError:
        raise WorkspaceError("Text file cannot be read.") from None
    if len(data) > MAX_FILE_BYTES:
        raise WorkspaceError("File exceeds the captured file size limit.")
    if check_text:
        _text(data)
    return data


def _safe_directory(path: Path, create: bool = False) -> None:
    """Check the anchor and every ancestor, including ancestors above root."""
    absolute = Path(os.path.abspath(path))
    current = Path(absolute.anchor)
    for part in (None, *absolute.parts[1:]):
        if part is not None:
            current /= part
        if current.exists() or current.is_symlink():
            if _is_link(current) or not current.is_dir():
                raise WorkspaceError("Directory and all its ancestors must be regular directories.")
        elif create:
            current.mkdir()
        else:
            raise WorkspaceError("Required directory does not exist.")


def _sync_directory(path: Path) -> None:
    if os.name != "nt":
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _atomic_write(path: Path, data: bytes, mode: int | None = None) -> None:
    _safe_directory(path.parent)
    if path.exists() or path.is_symlink():
        _regular_info(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".cline-", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(temporary_path, mode)
        _safe_directory(path.parent)
        if path.exists() or path.is_symlink():
            _regular_info(path)
        os.replace(temporary_path, path)
        _sync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


class Workspace:
    def __init__(self, root: Path):
        self._root = Path(os.path.abspath(root))
        _safe_directory(self._root)
        self._case_insensitive = os.name == "nt"

    @property
    def root(self) -> Path:
        return self._root

    def key(self, path: str) -> str:
        return path.casefold() if self._case_insensitive else path

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def validate_path(self, relative: str, write: bool = False, allow_missing: bool = False,
                      *, check_content: bool = True) -> Path:
        """Always validate path/link/type safety; captured reads skip live decoding."""
        if not isinstance(relative, str) or not relative or relative != relative.strip():
            raise WorkspaceError("An explicit relative file path is required.")
        normalized = relative.replace("\\", "/")
        windows_path = PureWindowsPath(relative)
        parts = normalized.split("/")
        if windows_path.drive or normalized.startswith("/") or any(
            not part or part in {".", ".."} or part.rstrip(" .") != part
            or any(ord(char) < 32 or char in ':*?[]"<>|' for char in part)
            or _DEVICES.fullmatch(part.split(".", 1)[0].rstrip(" ")) for part in parts
        ):
            raise WorkspaceError("Unsafe file path.")
        for part in parts:
            name = part.casefold()
            if name in _PROTECTED or name.startswith((".env", ".npmrc", ".pypirc", ".netrc")) or (
                _SENSITIVE.search(name) or _PRIVATE_KEY.match(name)
            ):
                raise WorkspaceError("Protected or sensitive paths are not available.")
        if Path(parts[-1]).suffix.casefold() in _FORBIDDEN_SUFFIXES:
            raise WorkspaceError("Sensitive file types are not available.")
        _safe_directory(self.root)
        target = self.root.joinpath(*parts)
        current = self.root
        for index, part in enumerate(parts):
            current /= part
            if current.exists() or current.is_symlink():
                if _is_link(current):
                    raise WorkspaceError("Symbolic links and reparse points are not available.")
                if index < len(parts) - 1:
                    if not current.is_dir():
                        raise WorkspaceError("A file path has an invalid parent.")
                else:
                    _regular_info(current)
                    if check_content:
                        _bytes(current)
            elif not (allow_missing or write):
                raise WorkspaceError("Requested text file does not exist.")
        return target

    def read(self, path: str) -> dict[str, object]:
        target = self.validate_path(path)
        data = _bytes(target)
        return {"path": self.relative(target), "content": _text(data), "sha256": _sha(data)}

    def search(self, query: str, paths: list[str], max_results: int = 50) -> list[dict[str, object]]:
        if not isinstance(query, str) or not query or not isinstance(paths, list):
            raise WorkspaceError("Literal query and selected file paths are required.")
        if len(paths) > MAX_READ_FILES:
            raise WorkspaceError("Read scope exceeds the file limit.")
        if type(max_results) is not int or not 1 <= max_results <= 200:
            raise WorkspaceError("Result limit must be between 1 and 200.")
        selected: dict[str, dict[str, object]] = {}
        total = 0
        for path in paths:
            result = self.read(path)
            key = self.key(str(result["path"]))
            if key not in selected:
                total += len(_bytes(self.validate_path(path)))
                if total > MAX_READ_BYTES:
                    raise WorkspaceError("Selected text files exceed the aggregate read limit.")
                selected[key] = result
        matches: list[dict[str, object]] = []
        for result in selected.values():
            for number, line in enumerate(str(result["content"]).splitlines(), 1):
                if query in line:
                    matches.append({"path": result["path"], "line": number, "text": line})
                    if len(matches) == max_results:
                        return matches
        return matches


class StagedWorkspace:
    """Immutable scopes/snapshots; only explicit orchestration applies or recovers."""

    def __init__(self, root: Path, state_dir: Path, read_paths: list[str], write_paths: list[str]):
        self.workspace = Workspace(root)
        self._root = self.workspace.root
        self.state_dir = Path(os.path.abspath(state_dir))
        reads = self._declarations(read_paths, False)
        writes = self._declarations(write_paths, True)
        if len(writes) > MAX_WRITE_FILES:
            raise WorkspaceError("Write scope exceeds the file limit.")
        read_keys = {self.workspace.key(path) for path in reads}
        for path in writes:
            if self.workspace.validate_path(path, write=True).exists() and self.workspace.key(path) not in read_keys:
                reads.append(path)
                read_keys.add(self.workspace.key(path))
        if len(reads) > MAX_READ_FILES:
            raise WorkspaceError("Read scope exceeds the file limit.")
        self._read_paths = tuple(reads)
        self._write_paths = tuple(writes)
        paths = {self.workspace.key(path): path for path in self.read_paths + self.write_paths}
        snapshots: list[bytes | None] = []
        self._entries: list[dict[str, object]] = []
        total = 0
        for path in sorted(paths.values(), key=self.workspace.key):
            target = self.workspace.validate_path(path, allow_missing=True)
            data = _bytes(target) if target.exists() else None
            total += len(data) if data is not None else 0
            if total > MAX_READ_BYTES:
                raise WorkspaceError("Input snapshots exceed the aggregate read limit.")
            snapshots.append(data)
            self._entries.append({"path": path, "base_sha256": _sha(data) if data is not None else None,
                                  "base_mode": stat.S_IMODE(_regular_info(target).st_mode) if data is not None else None,
                                  "proposed_sha256": None})
        _safe_directory(self.state_dir, create=True)
        if any(self.state_dir.iterdir()):
            raise WorkspaceError("Staging directory must be empty; use load to inspect a task.")
        self.status = "staging"
        self.applied_digest: str | None = None
        self._snapshot_digest = _sha(_json_bytes(self._binding()))
        for index, data in enumerate(snapshots):
            if data is not None:
                _atomic_write(self.state_dir / f"{index}.base", data)
        self._save()

    @property
    def root(self) -> Path:
        return self._root

    @property
    def read_paths(self) -> tuple[str, ...]:
        return self._read_paths

    @property
    def write_paths(self) -> tuple[str, ...]:
        return self._write_paths

    def _declarations(self, paths: list[str], write: bool) -> list[str]:
        if not isinstance(paths, list):
            raise WorkspaceError("File scope must be a list of explicit paths.")
        if len(paths) > (MAX_WRITE_FILES if write else MAX_READ_FILES):
            raise WorkspaceError("File scope exceeds the file limit.")
        unique: dict[str, str] = {}
        for path in paths:
            target = self.workspace.validate_path(path, write=write, allow_missing=write)
            normalized = self.workspace.relative(target)
            unique.setdefault(self.workspace.key(normalized), normalized)
        return list(unique.values())

    def _binding(self) -> dict[str, object]:
        return {"root": self.workspace.key(str(self.root)),
                "read_paths": sorted(self.read_paths, key=self.workspace.key),
                "write_paths": sorted(self.write_paths, key=self.workspace.key),
                "inputs": [[entry["path"], entry["base_sha256"], entry["base_mode"]] for entry in self._entries]}

    def _assert_binding(self) -> None:
        if _sha(_json_bytes(self._binding())) != self._snapshot_digest:
            raise WorkspaceError("Immutable task scope or snapshot metadata changed.")

    def _save(self, entries: list[dict[str, object]] | None = None,
              status: str | None = None, applied_digest: str | None = None) -> None:
        self._assert_binding()
        _safe_directory(self.state_dir)
        manifest = {"version": 2, "root": str(self.root), "read_paths": self.read_paths,
                    "write_paths": self.write_paths, "snapshot_digest": self._snapshot_digest,
                    "entries": entries if entries is not None else self._entries,
                    "status": status or self.status,
                    "applied_digest": applied_digest if applied_digest is not None else self.applied_digest}
        _atomic_write(self.state_dir / "manifest.json", _json_bytes(manifest))

    def _stored(self, filename: str, digest: str) -> bytes:
        _safe_directory(self.state_dir)
        path = self.state_dir / filename
        if not path.is_file() or _is_link(path):
            raise WorkspaceError("Staged content is unavailable or unsafe.")
        data = _bytes(path)
        if _sha(data) != digest:
            raise WorkspaceError("Staged content failed integrity validation.")
        return data

    def _base(self, index: int, entry: dict[str, object]) -> bytes | None:
        digest = entry["base_sha256"]
        return self._stored(f"{index}.base", str(digest)) if digest is not None else None

    def _proposal(self, entry: dict[str, object]) -> bytes:
        digest = str(entry["proposed_sha256"])
        return self._stored(f"{digest}.proposal", digest)

    def _entry(self, path: str, write: bool = False) -> tuple[int, dict[str, object]]:
        self._assert_binding()
        normalized = self.workspace.relative(self.workspace.validate_path(
            path, write=True, allow_missing=True, check_content=False))
        scope = self.write_paths if write else self.read_paths + self.write_paths
        key = self.workspace.key(normalized)
        if key not in {self.workspace.key(item) for item in scope}:
            raise WorkspaceError("File is outside the task scope.")
        return next((index, entry) for index, entry in enumerate(self._entries)
                    if self.workspace.key(str(entry["path"])) == key)

    def read(self, path: str) -> dict[str, object]:
        index, entry = self._entry(path)
        data = self._proposal(entry) if entry["proposed_sha256"] else self._base(index, entry)
        if data is None:
            raise WorkspaceError("File has no captured or staged content.")
        return {"path": entry["path"], "content": _text(data), "sha256": _sha(data)}

    def write(self, path: str, content: str) -> dict[str, object]:
        if self.status != "staging" or not isinstance(content, str):
            raise WorkspaceError("Task does not accept staged text writes.")
        self._require_idle()
        index, entry = self._entry(path, write=True)
        base = self._base(index, entry)
        has_bom = content.startswith("\ufeff") or (base is not None and base.startswith(codecs.BOM_UTF8))
        content = content.removeprefix("\ufeff")
        if base is not None and b"\r\n" in base and b"\n" not in base.replace(b"\r\n", b""):
            content = content.replace("\r\n", "\n").replace("\n", "\r\n")
        try:
            data = (codecs.BOM_UTF8 if has_bom else b"") + content.encode("utf-8")
        except UnicodeEncodeError:
            raise WorkspaceError("Only UTF-8 text content is supported.") from None
        _text(data)
        total = len(data) + sum(len(self._proposal(other)) for other_index, other in enumerate(self._entries)
                                if other_index != index and other["proposed_sha256"])
        if total > MAX_STAGE_BYTES:
            raise WorkspaceError("Proposals exceed the aggregate staging limit.")
        digest = _sha(data)
        _safe_directory(self.state_dir)
        _atomic_write(self.state_dir / f"{digest}.proposal", data)
        updated = [dict(item) for item in self._entries]
        updated[index]["proposed_sha256"] = digest
        # A completed compensating rollback belongs to the old proposal.
        # Remove its terminal journal before changing the proposal digest.
        old_journal = self._journal()
        if old_journal is not None:
            if old_journal["status"] != "rolled_back":
                raise WorkspaceError("Task has an unresolved apply journal.")
            (self.state_dir / "journal.json").unlink()
        self._save(entries=updated)
        self._entries = updated
        return {"path": entry["path"], "sha256": digest, "bytes": len(data), "status": "staged"}

    def diff(self) -> dict[str, object]:
        self._assert_binding()
        files: list[dict[str, object]] = []
        for index, entry in enumerate(self._entries):
            base = self._base(index, entry)
            if entry["proposed_sha256"] is None:
                continue
            path = str(entry["path"])
            proposal = self._proposal(entry)
            lines = list(difflib.unified_diff(_text(base or b"").splitlines(keepends=True),
                         _text(proposal).splitlines(keepends=True),
                         fromfile=f"a/{path}" if base is not None else "/dev/null", tofile=f"b/{path}"))
            files.append({"path": path, "base_sha256": entry["base_sha256"],
                          "proposed_sha256": entry["proposed_sha256"],
                          "added": sum(line.startswith("+") for line in lines[2:]),
                          "removed": sum(line.startswith("-") for line in lines[2:]), "diff": "".join(lines)})
        digest = _sha(_json_bytes({"snapshot": self._binding(),
                                  "proposals": [[item["path"], item["proposed_sha256"]] for item in files]}))
        return {"files": files, "digest": digest, "status": self.status, "atomicity": _ATOMICITY}

    def _verify_inputs(self, replaced: set[str] | None = None) -> None:
        for index, entry in enumerate(self._entries):
            self._base(index, entry)
            if replaced is not None and str(entry["path"]) in replaced:
                continue
            target = self.workspace.validate_path(str(entry["path"]), allow_missing=True, check_content=False)
            live = _bytes(target, check_text=False) if target.exists() else None
            if (_sha(live) if live is not None else None) != entry["base_sha256"]:
                raise WorkspaceError("Workspace changed after the input snapshot; recreate the task.")

    def _save_journal(self, journal: dict[str, object]) -> None:
        _safe_directory(self.state_dir)
        _atomic_write(self.state_dir / "journal.json", _json_bytes(journal))

    def _require_idle(self) -> None:
        if self.status != "staging":
            raise WorkspaceError("Task is not idle; apply recovery must be explicit.")
        journal = self._journal()
        if journal is not None and journal["status"] != "rolled_back":
            self.status = "recovery_required"
            self.applied_digest = None
            self._save()
            raise WorkspaceError("Task has an interrupted apply journal; recovery must be explicit.")

    def _journal(self) -> dict[str, object] | None:
        path = self.state_dir / "journal.json"
        _safe_directory(self.state_dir)
        if not path.exists() and not path.is_symlink():
            return None
        try:
            journal = json.loads(_bytes(path))
            if not isinstance(journal, dict) or journal["version"] != 1 or (
                journal["snapshot_digest"] != self._snapshot_digest or journal["digest"] != self.diff()["digest"]
            ) or journal["status"] not in {"applying", "recovery_required", "completed", "rolled_back"}:
                raise WorkspaceError("Apply journal failed integrity validation.")
            expected = [entry for entry in self._entries if entry["proposed_sha256"] is not None]
            records = journal["files"]
            if not isinstance(records, list) or len(records) != len(expected):
                raise WorkspaceError("Apply journal does not match the proposal.")
            for record, entry in zip(records, expected):
                if not isinstance(record, dict) or any(record[field] != entry[field]
                    for field in ("path", "base_sha256", "proposed_sha256", "base_mode")):
                    raise WorkspaceError("Apply journal does not match the proposal.")
                temporary = record["temporary"]
                if not isinstance(temporary, str) or not temporary.startswith(".cline-") or (
                    Path(temporary).name != temporary or "/" in temporary or "\\" in temporary
                ) or record["state"] not in {"prepared", "replaced", "rolled_back", "conflict"}:
                    raise WorkspaceError("Invalid apply journal record.")
            directories = journal["created_dirs"]
            if not isinstance(directories, list) or any(not isinstance(item, str) for item in directories):
                raise WorkspaceError("Invalid apply journal directories.")
            allowed: set[str] = set()
            for entry in expected:
                parent = Path(str(entry["path"])).parent
                while parent != Path("."):
                    allowed.add(parent.as_posix())
                    parent = parent.parent
            if len(directories) != len(set(directories)) or any(item not in allowed for item in directories):
                raise WorkspaceError("Apply journal directories are outside the write scope.")
            return journal
        except (KeyError, TypeError, AttributeError, json.JSONDecodeError):
            raise WorkspaceError("Invalid apply journal.") from None

    def _restore(self, index: int, entry: dict[str, object], temporary_name: str) -> None:
        path = str(entry["path"])
        target = self.workspace.validate_path(path, write=True, allow_missing=True, check_content=False)
        live = _bytes(target, check_text=False) if target.exists() else None
        current = _sha(live) if live is not None else None
        if current == entry["base_sha256"]:
            return
        if current != entry["proposed_sha256"]:
            raise WorkspaceError("Rollback target changed externally; it was preserved.")
        original = self._base(index, entry)
        if original is None:
            self.workspace.validate_path(path, write=True, check_content=False)
            if _sha(_bytes(target, check_text=False)) != entry["proposed_sha256"]:
                raise WorkspaceError("Rollback target changed externally; it was preserved.")
            target.unlink()
            _sync_directory(target.parent)
            return
        temporary_path = target.parent / temporary_name
        if temporary_path.exists() or temporary_path.is_symlink():
            _regular_info(temporary_path)
            temporary_path.unlink()
        descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(original)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, int(entry["base_mode"]))
            self.workspace.validate_path(path, write=True, check_content=False)
            if _sha(_bytes(target, check_text=False)) != entry["proposed_sha256"]:
                raise WorkspaceError("Rollback target changed externally; it was preserved.")
            os.replace(temporary_path, target)
            _sync_directory(target.parent)
        finally:
            self._remove_temporary(path, temporary_path.name)

    def _remove_temporary(self, path: str, filename: str) -> None:
        try:
            _safe_directory(self.root)
            target = self.root / path
            _safe_directory(target.parent)
            temporary = target.parent / filename
            if temporary.exists() or temporary.is_symlink():
                _regular_info(temporary)
                temporary.unlink()
        except (OSError, WorkspaceError):
            pass

    def _cleanup(self, journal: dict[str, object]) -> None:
        for record in journal["files"]:
            self._remove_temporary(str(record["path"]), str(record["temporary"]))
        for relative in reversed(journal["created_dirs"]):
            try:
                _safe_directory(self.root)
                parent = self.root / str(relative)
                _safe_directory(parent)
                parent.rmdir()
            except (OSError, WorkspaceError):
                pass

    def _rollback(self, journal: dict[str, object], applied: list[str], uncertain: bool = False) -> dict[str, object]:
        failed: list[str] = []
        records = journal["files"]
        entry_map = {str(entry["path"]): (index, entry) for index, entry in enumerate(self._entries)}
        for record in reversed(records):
            path = str(record["path"])
            if not uncertain and path not in applied:
                record["state"] = "rolled_back"
                continue
            try:
                index, entry = entry_map[path]
                self._restore(index, entry, str(record["temporary"]))
                record["state"] = "rolled_back"
            except (OSError, WorkspaceError):
                record["state"] = "conflict"
                failed.append(path)
        journal["status"] = "recovery_required" if failed else "rolled_back"
        self.status = "recovery_required" if failed else "staging"
        self.applied_digest = None
        persistence_failed = False
        try:
            self._save_journal(journal)
            self._save()
        except (OSError, WorkspaceError):
            self.status = "recovery_required"
            persistence_failed = True
        self._cleanup(journal)
        return {"status": "rollback_incomplete" if failed or persistence_failed else "rolled_back",
                "digest": journal["digest"], "files": applied, "failed": failed,
                "recovery_required": self.status == "recovery_required", "atomicity": _ATOMICITY}

    def apply(self, expected_digest: str) -> dict[str, object]:
        difference = self.diff()
        digest = str(difference["digest"])
        if not isinstance(expected_digest, str) or not _HEX.fullmatch(expected_digest) or expected_digest != digest:
            raise WorkspaceError("Proposal digest does not match the reviewed diff.")
        if self.status == "applied":
            if self.applied_digest != digest:
                raise WorkspaceError("Applied task metadata failed integrity validation.")
            return {"status": "already_applied", "digest": digest, "files": [], "atomicity": _ATOMICITY}
        self._require_idle()
        if not difference["files"]:
            raise WorkspaceError("There are no staged files to apply.")
        self._verify_inputs()
        journal: dict[str, object] = {"version": 1, "snapshot_digest": self._snapshot_digest,
                                     "digest": digest, "status": "applying", "created_dirs": [],
                                     "files": [dict(entry, temporary=f".cline-{secrets.token_hex(16)}", state="prepared")
                                               for entry in self._entries if entry["proposed_sha256"] is not None]}
        applied: list[str] = []
        journal_written = False
        try:
            # Record every owned replacement before even creating its file.
            self._save_journal(journal)
            journal_written = True
            self._save(status="applying")
            self.status = "applying"
            for record in journal["files"]:
                path = str(record["path"])
                target = self.workspace.validate_path(path, write=True, allow_missing=True, check_content=False)
                missing: list[Path] = []
                parent = target.parent
                while parent != self.root and not parent.exists():
                    missing.append(parent)
                    parent = parent.parent
                for parent in reversed(missing):
                    self.workspace.validate_path(path, write=True, allow_missing=True, check_content=False)
                    journal["created_dirs"].append(self.workspace.relative(parent))
                    self._save_journal(journal)
                    parent.mkdir()
                temporary_path = target.parent / str(record["temporary"])
                descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
                with os.fdopen(descriptor, "wb") as handle:
                    handle.write(self._proposal(record))
                    handle.flush()
                    os.fsync(handle.fileno())
                if record["base_mode"] is not None:
                    os.chmod(temporary_path, int(record["base_mode"]))
            self._verify_inputs()
            for record in journal["files"]:
                self._verify_inputs(set(applied))
                path = str(record["path"])
                target = self.workspace.validate_path(path, write=True, allow_missing=True, check_content=False)
                live = _bytes(target, check_text=False) if target.exists() else None
                if (_sha(live) if live is not None else None) != record["base_sha256"]:
                    raise WorkspaceError("Workspace changed while preparing the apply operation.")
                temporary = target.parent / str(record["temporary"])
                self._proposal(record)
                if _sha(_bytes(temporary)) != record["proposed_sha256"]:
                    raise WorkspaceError("Prepared replacement failed integrity validation.")
                self.workspace.validate_path(path, write=True, allow_missing=True, check_content=False)
                live = _bytes(target, check_text=False) if target.exists() else None
                if (_sha(live) if live is not None else None) != record["base_sha256"]:
                    raise WorkspaceError("Workspace changed immediately before replacement.")
                os.replace(temporary, target)
                applied.append(path)
                record["state"] = "replaced"
                _sync_directory(target.parent)
                self._save_journal(journal)
            journal["status"] = "completed"
            self._save_journal(journal)
            self._save(status="applied", applied_digest=digest)
        except (OSError, WorkspaceError):
            if journal_written:
                return self._rollback(journal, applied)
            self._cleanup(journal)
            return {"status": "rolled_back", "digest": digest, "files": [], "failed": [], "atomicity": _ATOMICITY}
        # KeyboardInterrupt/process termination deliberately leave the durable
        # applying journal for explicit recovery, without resuming application.
        self.status = "applied"
        self.applied_digest = digest
        self._cleanup(journal)
        return {"status": "applied", "digest": digest, "files": applied, "atomicity": _ATOMICITY}

    def recover(self) -> dict[str, object]:
        """Explicitly roll back interrupted replacements; never resume apply."""
        if self.status not in {"applying", "recovery_required"}:
            raise WorkspaceError("Task does not require apply recovery.")
        journal = self._journal()
        if journal is None:
            raise WorkspaceError("Apply journal is unavailable; manual recovery is required.")
        applied = [str(record["path"]) for record in journal["files"] if record["state"] == "replaced"]
        return self._rollback(journal, applied, uncertain=True)

    def cancel(self) -> dict[str, object]:
        """Only root orchestration may call this when its task worker is idle."""
        self._require_idle()
        self._save(status="cancelled")
        self.status = "cancelled"
        return {"status": "cancelled", "files": []}

    @classmethod
    def load(cls, root: Path, state_dir: Path) -> StagedWorkspace:
        instance = cls.__new__(cls)
        instance.workspace = Workspace(root)
        instance._root = instance.workspace.root
        instance.state_dir = Path(os.path.abspath(state_dir))
        _safe_directory(instance.state_dir)
        try:
            manifest = json.loads(_bytes(instance.state_dir / "manifest.json"))
            if manifest["version"] != 2 or not isinstance(manifest["root"], str) or (
                instance.workspace.key(manifest["root"]) != instance.workspace.key(str(instance.root))
            ):
                raise WorkspaceError("Staging manifest belongs to another workspace or unsupported version.")
            instance._read_paths = instance._declarations_for_load(manifest["read_paths"], MAX_READ_FILES)
            instance._write_paths = instance._declarations_for_load(manifest["write_paths"], MAX_WRITE_FILES)
            instance._entries = manifest["entries"]
            instance.status = manifest["status"]
            instance.applied_digest = manifest["applied_digest"]
            instance._snapshot_digest = manifest["snapshot_digest"]
            if instance.status not in _STATUSES or not isinstance(instance._entries, list) or (
                not isinstance(instance._snapshot_digest, str) or not _HEX.fullmatch(instance._snapshot_digest)
            ):
                raise WorkspaceError("Invalid staging metadata.")
            scope = {instance.workspace.key(path) for path in instance.read_paths + instance.write_paths}
            read_scope = {instance.workspace.key(path) for path in instance.read_paths}
            write_scope = {instance.workspace.key(path) for path in instance.write_paths}
            entries: set[str] = set()
            total = 0
            staged_total = 0
            previous: str | None = None
            for index, entry in enumerate(instance._entries):
                path = entry["path"]
                instance.workspace.validate_path(path, allow_missing=True, check_content=False)
                key = instance.workspace.key(path)
                if key not in scope or key in entries or (previous is not None and key < previous):
                    raise WorkspaceError("Staging entries do not match the declared scope.")
                previous = key
                entries.add(key)
                for field in ("base_sha256", "proposed_sha256"):
                    value = entry[field]
                    if value is not None and (not isinstance(value, str) or not _HEX.fullmatch(value)):
                        raise WorkspaceError("Invalid staging content digest.")
                mode = entry["base_mode"]
                if (entry["base_sha256"] is None and mode is not None) or (entry["base_sha256"] is not None and (
                    type(mode) is not int or mode < 0 or mode > 0o7777
                )):
                    raise WorkspaceError("Invalid snapshot file mode.")
                if entry["base_sha256"] is None and key in read_scope:
                    raise WorkspaceError("Read scope is missing an input snapshot.")
                base = instance._base(index, entry)
                total += len(base) if base is not None else 0
                if entry["proposed_sha256"] is not None:
                    if key not in write_scope:
                        raise WorkspaceError("Proposal is outside the declared write scope.")
                    staged_total += len(instance._proposal(entry))
            if entries != scope or total > MAX_READ_BYTES or staged_total > MAX_STAGE_BYTES:
                raise WorkspaceError("Staging scope or size limits failed validation.")
            instance._assert_binding()
            digest = str(instance.diff()["digest"])
            if instance.status == "applied" and instance.applied_digest != digest:
                raise WorkspaceError("Applied task metadata failed integrity validation.")
            if instance.status != "applied" and instance.applied_digest is not None:
                raise WorkspaceError("Invalid staging status metadata.")
            journal = instance._journal()
            interrupted = instance.status in {"applying", "recovery_required"} or (
                journal is not None and journal["status"] in {"applying", "recovery_required"}
            ) or (
                journal is not None and instance.status == "applied" and journal["status"] != "completed"
            ) or (
                journal is not None and instance.status in {"staging", "cancelled"} and journal["status"] == "completed"
            )
            if interrupted:
                instance.status = "recovery_required"
                instance.applied_digest = None
                instance._save()
        except (KeyError, TypeError, AttributeError, json.JSONDecodeError):
            raise WorkspaceError("Invalid staging manifest.") from None
        return instance

    def _declarations_for_load(self, paths: list[str], maximum: int) -> tuple[str, ...]:
        if not isinstance(paths, list) or len(paths) > maximum:
            raise WorkspaceError("Invalid staging scope or file limit.")
        normalized = tuple(self.workspace.relative(self.workspace.validate_path(
            path, allow_missing=True, check_content=False)) for path in paths)
        if len({self.workspace.key(path) for path in normalized}) != len(normalized):
            raise WorkspaceError("Staging scope contains duplicate files.")
        return normalized
