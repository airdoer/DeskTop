#!/usr/bin/env bash
#
# install-release-server.sh — 在发布服务器上部署 DeskTop 更新通道（方案 A）
#
#   sudo ./install-release-server.sh          安装 / 升级并自检
#        ./install-release-server.sh check    只跑自检，不改动系统（无需 root）
#
# 设计约束：
#   * 幂等 —— 可重复执行，用于升级 serve-release.py 或改配置。
#   * 不做任何删除操作，不触碰 win/ 里的发布产物。
#   * 不依赖外网：本服务器无法访问 deb.debian.org，所以不走 apt 安装 nginx。
#
# 前置：本脚本需与 serve-release.py、desktop-release.service 同目录。

set -euo pipefail

RELEASE_ROOT="/data/chenzhixu/DeskTop-release"
ARTIFACT_DIR="$RELEASE_ROOT/win"
DEPLOY_DIR="$RELEASE_ROOT/deploy"
SERVICE_NAME="desktop-release"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PORT="9090"
BASE_URL="http://127.0.0.1:${PORT}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '%s\n' "$*"; }
ok()   { printf '  [OK]   %s\n' "$*"; }
warn() { printf '  [WARN] %s\n' "$*"; }
die()  { printf '\n[ERROR] %s\n\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 自检

# 从 latest.yml 里取出 sha512（base64），用于端到端校验"服务出去的字节"
# 与"清单里声明的字节"完全一致。这是唯一能证明整条链路没被截断/改写的检查。
manifest_sha512() {
    awk '/^sha512:/ {print $2; exit}' "$ARTIFACT_DIR/latest.yml"
}

manifest_version() {
    awk '/^version:/ {print $2; exit}' "$ARTIFACT_DIR/latest.yml"
}

check_http() {
    log ""
    log "=== 自检：HTTP 通道 ==="

    command -v curl >/dev/null 2>&1 || die "curl 未安装，无法自检"

    # 1) 清单可取、且明确禁止缓存
    local headers
    headers="$(curl -fsSI "${BASE_URL}/win/latest.yml" 2>/dev/null || true)"
    if [ -z "$headers" ]; then
        die "GET ${BASE_URL}/win/latest.yml 失败 —— 服务没起来，或没监听 0.0.0.0:${PORT}"
    fi
    printf '%s' "$headers" | grep -qi '^HTTP/.* 200' || die "latest.yml 未返回 200"
    ok "latest.yml 返回 200"
    if printf '%s' "$headers" | grep -qi 'cache-control:.*no-store'; then
        ok "latest.yml 带 Cache-Control: no-store"
    else
        warn "latest.yml 没有 no-store —— 客户端可能缓存住旧版本清单"
    fi

    # 2) 安装包必须声明支持 Range，否则 electron-updater 会退化为全量下载
    local exe
    exe="$(awk '/^path:/ {print $2; exit}' "$ARTIFACT_DIR/latest.yml")"
    [ -n "$exe" ] || die "latest.yml 里没有 path 字段"

    local exe_headers
    exe_headers="$(curl -fsSI "${BASE_URL}/win/${exe}" 2>/dev/null || true)"
    if printf '%s' "$exe_headers" | grep -qi 'accept-ranges: *bytes'; then
        ok "${exe} 声明 Accept-Ranges: bytes（差量下载可用）"
    else
        die "${exe} 没有 Accept-Ranges —— 每次更新都会退化为下载完整安装包"
    fi

    # 3) 真的能返回 206 + 正确的字节数
    local probe
    probe="$(curl -fsS -r 0-1023 -o /dev/null \
             -w '%{http_code} %{size_download}' "${BASE_URL}/win/${exe}" 2>/dev/null || true)"
    if [ "$probe" = "206 1024" ]; then
        ok "Range 请求返回 206 且字节数正确（1024）"
    else
        die "Range 请求异常：期望 '206 1024'，实际 '${probe}'"
    fi

    # 4) 端到端校验：HTTP 实际吐出的字节的 sha512 == latest.yml 声明值
    local declared actual
    declared="$(manifest_sha512)"
    if [ -z "$declared" ]; then
        warn "latest.yml 里没有 sha512，跳过端到端校验"
    elif ! command -v openssl >/dev/null 2>&1; then
        warn "openssl 未安装，跳过端到端校验"
    else
        actual="$(curl -fsS "${BASE_URL}/win/${exe}" \
                  | openssl dgst -sha512 -binary | openssl base64 -A)"
        if [ "$declared" = "$actual" ]; then
            ok "端到端 sha512 一致：${actual}"
        else
            die "sha512 不一致！\n         声明 = ${declared}\n         实际 = ${actual}"
        fi
    fi

    # 5) 未发布的版本必须 404（防止老客户端拿到不存在的包）
    local missing
    missing="$(curl -sS -o /dev/null -w '%{http_code}' \
               "${BASE_URL}/win/DeskTop_0.0.0.exe" 2>/dev/null || true)"
    [ "$missing" = "404" ] && ok "不存在的版本返回 404" || warn "不存在的版本返回 ${missing}（期望 404）"

    log ""
    log "=== 自检通过 ==="
    log "  版本清单 : ${BASE_URL}/win/latest.yml  (version $(manifest_version))"
    log "  内网地址 : http://172.28.193.12:${PORT}/win/latest.yml"
}

# ---------------------------------------------------------------- 安装

do_install() {
    [ "$(id -u)" -eq 0 ] || die "需要 root：sudo $0"

    log "=== 安装 DeskTop 更新通道 ==="

    command -v python3 >/dev/null 2>&1 || die "python3 未安装"
    ok "python3 $(python3 -V 2>&1 | awk '{print $2}')"

    [ -f "$SRC_DIR/serve-release.py" ] || die "缺少 $SRC_DIR/serve-release.py"
    [ -f "$SRC_DIR/desktop-release.service" ] || die "缺少 $SRC_DIR/desktop-release.service"

    # 端口占用检查：只放过"本服务自己"已经占着的情况（幂等升级）
    if ss -tln 2>/dev/null | grep -qE "[:.]${PORT}\b"; then
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            ok "端口 ${PORT} 由本服务占用，按升级处理"
        else
            ss -tlnp 2>/dev/null | grep -E "[:.]${PORT}\b" || true
            die "端口 ${PORT} 已被其它进程占用 —— 先腾出来，或改 PORT 并同步改 systemd unit 与 electron-builder.json 的 publish.url"
        fi
    else
        ok "端口 ${PORT} 空闲"
    fi

    mkdir -p "$DEPLOY_DIR" "$ARTIFACT_DIR"

    # 源与目标可能是同一个文件：就地运行正是本文档推荐的用法
    # （cd /data/chenzhixu/DeskTop-release/deploy && sudo ./install-release-server.sh），
    # 此时 SRC_DIR == DEPLOY_DIR。GNU install 对同一文件会报
    #   install: 'x' and 'x' are the same file
    # 并以 1 退出（已用 coreutils 8.32 实测），在 set -e 下会中断整个安装 ——
    # 而且是在装 systemd 单元之前就中断。故先比较再决定是否复制。
    # 用 readlink -f 而不是直接比字符串：可覆盖 DEPLOY_DIR 是指向 SRC_DIR 的软链等情况。
    if [ "$(readlink -f "$SRC_DIR/serve-release.py")" != "$(readlink -f "$DEPLOY_DIR/serve-release.py")" ]; then
        install -m 0755 "$SRC_DIR/serve-release.py" "$DEPLOY_DIR/serve-release.py"
        ok "已安装 $DEPLOY_DIR/serve-release.py"
    else
        # 同一文件：无需复制，但模式仍要强制，保证与 install 分支结果一致
        # （否则调用者 umask/权限不同时会留下非 0755 的文件）。
        chmod 0755 "$DEPLOY_DIR/serve-release.py"
        ok "已就位（源与目标同一文件，跳过复制）$DEPLOY_DIR/serve-release.py"
    fi

    install -m 0644 "$SRC_DIR/desktop-release.service" "$SERVICE_PATH"
    ok "已安装 $SERVICE_PATH"

    # 发布产物是否就位（缺 latest.yml 时服务能起但客户端拿不到版本）
    if [ -f "$ARTIFACT_DIR/latest.yml" ]; then
        ok "发布产物就位（version $(manifest_version)）"
    else
        warn "$ARTIFACT_DIR/latest.yml 不存在 —— 服务能启动，但客户端拿不到版本清单"
    fi

    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME" >/dev/null
    ok "服务已 enable --now"

    sleep 1
    systemctl is-active --quiet "$SERVICE_NAME" || {
        systemctl status "$SERVICE_NAME" --no-pager -l || true
        die "服务启动失败，见上面的 journalctl 输出"
    }
    ok "服务运行中"

    check_http
}

# ---------------------------------------------------------------- 入口

case "${1:-install}" in
    check) check_http ;;
    install|"") do_install ;;
    *) die "未知参数 '$1'（可用：install | check）" ;;
esac
