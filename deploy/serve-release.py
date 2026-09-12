#!/usr/bin/env python3
"""serve-release.py — 静态 HTTP 服务，用于 DeskTop 的 electron-updater 更新通道。

为什么不用 `python3 -m http.server`（三个硬伤，每个都会实际影响更新）：

1. **没有字节范围（Range）支持**。stdlib 的 SimpleHTTPRequestHandler 不实现
   Range，因此既不回 `Accept-Ranges: bytes`，也不回 `206 Partial Content`。
   electron-updater 的 checkIsRangesSupported() 会因此判定不支持差量，
   回落到 `fallback to full download` —— 每次更新都拉完整 ~98 MB 安装包，
   而不是只下 .blockmap 里变化的那几块。这正是我们要避免的。

2. **不能控制缓存**。SimpleHTTPRequestHandler 会带 Last-Modified，客户端可能拿
   到 304；latest.yml 一旦被缓存，客户端就长期感知不到新版本。

3. **没有托管**。裸进程随 SSH 会话一起死，机器重启也不会自启。

本脚本只实现 electron-updater 真正需要的语义，别无其他：
    GET / HEAD  /<file>     支持单段 Range
    latest.yml              永远 no-store

仅用标准库，兼容 Python 3.9+。
"""

import argparse
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

# 版本清单必须每次回源：客户端靠轮询它感知新版本。
MANIFEST_NAME = "latest.yml"
MANIFEST_CACHE = "no-store, no-cache, must-revalidate, max-age=0"

# 安装包 / blockmap 文件名里带版本号，内容永不变化，可以放心长缓存（7 天）。
ARTIFACT_CACHE = "public, max-age=604800"

# 显式映射，避免依赖各发行版 /etc/mime.types 的差异。
# electron-updater 不校验 Content-Type，这里只是为了让 curl / 浏览器可读。
EXTRA_TYPES = {
    ".exe": "application/octet-stream",
    ".blockmap": "application/octet-stream",
    ".yml": "text/yaml; charset=utf-8",
    ".yaml": "text/yaml; charset=utf-8",
    ".dmg": "application/octet-stream",
    ".zip": "application/zip",
}

# 单段 Range：bytes=start-end / bytes=start- / bytes=-suffix
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class ReleaseHandler(BaseHTTPRequestHandler):
    # HTTP/1.1 + 明确的 Content-Length，客户端才能复用连接下载大文件。
    protocol_version = "HTTP/1.1"
    server_version = "DeskTopRelease/1.0"

    # 由 main() 注入
    root = "."
    verbose = False

    # ---------------------------------------------------------------- 工具

    def _resolve(self):
        """把 URL 路径映射到磁盘路径；越界（../）返回 None。"""
        path = unquote(urlparse(self.path).path)
        # normpath 会把 '/a/../../etc/passwd' 收敛掉，再用 commonpath 兜底判断。
        candidate = os.path.normpath(os.path.join(self.root, path.lstrip("/")))
        root = os.path.realpath(self.root)
        candidate = os.path.realpath(candidate)
        if candidate != root and not candidate.startswith(root + os.sep):
            return None
        return candidate

    @staticmethod
    def _content_type(path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_TYPES:
            return EXTRA_TYPES[ext]
        import mimetypes

        guessed, _ = mimetypes.guess_type(path)
        return guessed or "application/octet-stream"

    @staticmethod
    def _cache_control(path):
        if os.path.basename(path).lower() == MANIFEST_NAME:
            return MANIFEST_CACHE
        return ARTIFACT_CACHE

    def _parse_range(self, size):
        """返回 (start, end) 闭区间；None 表示按完整响应处理。

        多段 Range（含逗号）刻意不支持：electron-updater 只发单段，
        返回 200 全量比返回不完整的 206 更安全。
        """
        raw = self.headers.get("Range")
        if not raw:
            return None
        match = RANGE_RE.match(raw.strip())
        if not match:
            return None
        first, last = match.group(1), match.group(2)
        if first == "" and last == "":
            return None
        if first == "":
            # bytes=-N：最后 N 字节
            length = int(last)
            if length <= 0:
                return None
            start = max(0, size - length)
            return (start, size - 1)
        start = int(first)
        if start >= size:
            return "unsatisfiable"
        end = size - 1 if last == "" else min(int(last), size - 1)
        if end < start:
            return None
        return (start, end)

    # ---------------------------------------------------------------- 响应

    def _send_common(self, status, headers, body=b""):
        self.send_response(status)
        for key, value in headers:
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status, message):
        body = (message + "\n").encode("utf-8")
        self._send_common(
            status,
            [("Content-Type", "text/plain; charset=utf-8"),
             ("Cache-Control", "no-store")],
            body,
        )

    def _serve(self):
        path = self._resolve()
        if path is None:
            return self._error(403, "forbidden")

        if os.path.isdir(path):
            index = os.path.join(path, "index.html")
            if not os.path.isfile(index):
                # 刻意不实现目录列表：发布目录里有哪些版本属于运维信息，
                # 不该由 HTTP 端口对外暴露。
                return self._error(403, "directory listing is disabled")
            path = index

        if not os.path.isfile(path):
            return self._error(404, "not found")

        try:
            size = os.path.getsize(path)
        except OSError:
            return self._error(404, "not found")

        rng = self._parse_range(size)
        if rng == "unsatisfiable":
            self.send_response(416)
            self.send_header("Content-Range", "bytes */%d" % size)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        content_type = self._content_type(path)
        cache_control = self._cache_control(path)

        if rng is None:
            start, end, status = 0, size - 1, 200
        else:
            start, end, status = rng[0], rng[1], 206

        length = end - start + 1
        if length <= 0:
            # 0 字节文件
            self._send_common(
                200,
                [("Content-Type", content_type),
                 ("Cache-Control", cache_control),
                 ("Accept-Ranges", "bytes")],
                b"",
            )
            return

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        # electron-updater 靠这个头判断能否做差量下载 —— 必须存在。
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", cache_control)
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.end_headers()

        if self.command == "HEAD":
            return

        remaining = length
        with open(path, "rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    # 客户端提前断开（关窗口 / 取消更新）是常态，不必刷日志。
                    return
                remaining -= len(chunk)

    # ---------------------------------------------------------------- 入口

    def do_GET(self):
        self._serve()

    def do_HEAD(self):
        self._serve()

    def log_message(self, fmt, *args):
        if self.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(
        description="Static HTTP server for the DeskTop update channel.",
    )
    parser.add_argument("--root", required=True, help="要对外提供的目录")
    parser.add_argument("--bind", default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--port", type=int, default=9090, help="监听端口（默认 9090）")
    parser.add_argument("--quiet", action="store_true", help="不记录每个请求")
    args = parser.parse_args()

    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        sys.stderr.write("root directory does not exist: %s\n" % root)
        return 2

    ReleaseHandler.root = root
    ReleaseHandler.verbose = not args.quiet

    ThreadingHTTPServer.daemon_threads = True
    httpd = ThreadingHTTPServer((args.bind, args.port), ReleaseHandler)
    sys.stderr.write("serving %s on http://%s:%d/\n" % (root, args.bind, args.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
