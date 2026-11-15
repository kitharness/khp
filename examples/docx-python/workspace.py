"""One filesystem boundary, shared by tools and document links (POSIX only)."""

from contextlib import contextmanager
import errno
import os
from pathlib import PurePosixPath
import re
import stat
from urllib.parse import unquote, urlsplit
from uuid import uuid4


class KitError(Exception):
    def __init__(self, code, message, index=None):
        super().__init__(message)
        self.error = {"code": code, "message": message}
        if index is not None:
            self.error["index"] = index


def refused():
    # Identical for existing and missing targets, without revealing OS errors.
    return KitError("not-allowed", "Use a visible workspace file with an allowed extension; symlinks are refused.")


class Workspace:
    def __init__(self, root):
        if os.name != "posix" or not hasattr(os, "O_NOFOLLOW"):
            raise ValueError("This example requires POSIX directory descriptors and O_NOFOLLOW.")
        self.root = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def close(self):
        os.close(self.root)

    def name(self, given, accept=("docx",)):
        if not isinstance(given, str) or not given:
            raise KitError("invalid-params", "path must name a workspace-relative file; call docx_create first if needed.")
        parts = given.split("/")
        if ("\\" in given or ":" in given or "\x00" in given or
                any(not part or part.startswith(".") for part in parts)):
            raise refused()
        if accept is not None and PurePosixPath(given).suffix.lower().lstrip(".") not in accept:
            raise refused()
        return given

    @contextmanager
    def parent(self, name):
        """Walk from the workspace handle; never follow a symbolic link, even in a race."""
        self.name(name, accept=None)
        fd = os.dup(self.root)
        try:
            for part in name.split("/")[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            yield fd, name.split("/")[-1]
        except OSError as exc:
            if exc.errno in (errno.ELOOP, errno.ENOTDIR, errno.EACCES, errno.EPERM):
                raise refused() from None
            if exc.errno == errno.ENOENT:
                raise KitError("not-found", "The workspace file or parent is missing; create its parent folder, then call docx_create.") from None
            raise KitError("failed", "Workspace I/O failed; check file permissions and retry the call.") from None
        finally:
            os.close(fd)

    def read(self, name):
        self.name(name)
        with self.parent(name) as (folder, leaf):
            fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise refused()
                if info.st_size > 16 * 1024 * 1024:
                    raise KitError("unsupported", "Use a DOCX smaller than 16 MiB with this teaching kit.")
                data = stream.read(16 * 1024 * 1024 + 1)
                if len(data) > 16 * 1024 * 1024:
                    raise KitError("unsupported", "Use a DOCX smaller than 16 MiB with this teaching kit.")
                return data

    def write(self, name, data, *, new=False):
        """Stage fully, then publish once. link() creates without replacing; replace() commits a run."""
        self.name(name)
        with self.parent(name) as (folder, leaf):
            try:
                info = os.stat(leaf, dir_fd=folder, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                    raise refused()
            except FileNotFoundError:
                pass
            scratch = ".khp-write-" + uuid4().hex
            fd = os.open(scratch, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=folder)
            try:
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                if new:
                    stem, suffix = os.path.splitext(leaf)
                    for number in range(1, 10001):
                        chosen = leaf if number == 1 else f"{stem} {number}{suffix}"
                        try:
                            os.link(scratch, chosen, src_dir_fd=folder, dst_dir_fd=folder, follow_symlinks=False)
                            return str(PurePosixPath(name).with_name(chosen))
                        except FileExistsError:
                            continue
                    raise KitError("failed", "Too many names are occupied; choose another output name and retry.")
                os.replace(scratch, leaf, src_dir_fd=folder, dst_dir_fd=folder)
                return name
            finally:
                # replace() consumed scratch; link() left it for cleanup.
                try:
                    os.unlink(scratch, dir_fd=folder)
                except OSError:
                    pass

    def link(self, document, target):
        """A42: outside derives from text only; refusals never reveal filesystem state."""
        answer = {"target": target, "exists": False}
        decoded = unquote(target)
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", decoded) or decoded.startswith(("/", "\\")):
            return {**answer, "outside": True}
        # URI fragments identify a location within a file, not its filesystem name.
        path = unquote(urlsplit(target).path).replace("\\", "/")
        parts = document.split("/")[:-1]
        for part in path.split("/"):
            if part == "..":
                if not parts:
                    return {**answer, "outside": True}
                parts.pop()
            elif part and part != ".":
                # Refuse hidden segments before normalizing them away.
                if part.startswith("."):
                    return answer
                parts.append(part)
        if not path or not parts:
            return answer
        try:
            name = self.name("/".join(parts), accept=None)
            with self.parent(name) as (folder, leaf):
                info = os.stat(leaf, dir_fd=folder, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode) or info.st_nlink != 1:
                    return answer
                return {**answer, "path": name, "exists": stat.S_ISREG(info.st_mode)}
        except KitError:
            return answer
