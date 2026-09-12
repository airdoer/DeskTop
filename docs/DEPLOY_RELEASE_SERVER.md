# DeskTop 发布服务器部署手册

> **读者**：在 `172.28.193.12` 上执行安装的服务端 agent
> **编写日期**：2026-09-12
> **目标产物**：一个监听 `0.0.0.0:9090` 的静态 HTTP 服务，把 `/data/chenzhixu/DeskTop-release/` 对外提供，
> 使 `http://172.28.193.12:9090/win/latest.yml` 可被内网客户端轮询。
>
> 本文中标注「实测」的信息均来自 2026-09-12 在该服务器上的实际命令输出，非推断。

## 部署状态（2026-09-12 19:15）

**已完成并通过外部网络验收。** 服务端 agent 于 19:15:22 完成安装：

| 项目 | 实测值 |
|---|---|
| 服务 | `desktop-release.service`，`enabled` + `active` |
| 进程 | `python3 …/serve-release.py --root … --bind 0.0.0.0 --port 9090`，`User=chenzhixu` |
| 监听 | `0.0.0.0:9090` |
| 从开发机（内网外部）全量下载 | HTTP 200，102,994,632 B，约 4.6 MB/s |
| 端到端 sha512 | 与 `latest.yml` 声明值**完全一致** |

验收命令见 §4.5 与附录 A。后续新增版本只需在开发机跑 `shell\publish.bat`，服务端无需改动。

---

## 1. 一句话结论

**不要用 `apt-get install nginx` —— 这台服务器没有外网，装不上。**
改用本文**方案 A**：随包提供的 `serve-release.py`（仅标准库，Python 3.9 兼容）+ systemd 单元。
一条命令完成安装与自检：

```bash
sudo /data/chenzhixu/DeskTop-release/deploy/install-release-server.sh
```

---

## 2. 现状（实测）

### 2.1 服务器环境

| 项目 | 实测值 |
|---|---|
| 主机名 | `amnisstudio-chenzhixu-02.dev.kwaidc.com` |
| 系统 | Debian GNU/Linux 11 (bullseye) |
| init | systemd 247 |
| SSH 用户 | `chenzhixu`，passwordless `sudo` 可用 |
| Python | 3.9.2，位于 `/usr/bin/python3` |
| 已具备工具 | `curl` `openssl` `awk` `ss` `systemctl` `install`（均在 `/usr/bin/`） |
| 端口 9090 | **已被本方案占用**（`desktop-release.service` 监听 `0.0.0.0:9090`） |
| 端口 8080 | **已被服务器上其它服务占用 —— 因此本方案改用 9090**（原计划是 8080） |
| 当前监听端口 | 22, 1992, 1999, 5000, 6604, 6615, 6616, 6666, 6668, 6903, 6904, 6908, 8008, 8877, 11001, 11002, 12008, 13000, 19999, 27119–27130, 27777 |
| 入站防火墙 | **无**（`iptables -P INPUT ACCEPT`；无 `ufw`、无 `nft`） |
| `/data` 空间 | 98G 总量，**31G 可用**（已用 67%） |
| Docker | 已安装（存在 `docker0` / `br-*` 网桥），但**未缓存 nginx 镜像** |

### 2.2 ⚠️ 关键约束：服务器无外网

实测 `sudo apt-get update` 全部超时：

```
Failed to fetch http://deb.debian.org/debian/dists/bullseye/InRelease
  Cannot initiate the connection to deb.debian.org:80 (199.232.162.132),
  connection timed out
```

无 apt 代理配置，`/var/cache/apt/archives/` 里也没有 nginx 相关 `.deb`。
`apt-cache policy nginx` 能显示候选版本 `1.18.0-6.1+deb11u5`，那只是**本地包索引**，
`.deb` 本体依然需要下载 —— 所以 `apt-get install nginx` 会在下载阶段失败。

**如果服务端 agent 有自己的 apt 代理 / 内网镜像**，那么方案 B（nginx）可直接用，无需绕路；
否则请用方案 A。

### 2.3 已上传的发布产物（校验通过）

位置：`/data/chenzhixu/DeskTop-release/win/`

| 文件 | 字节数 | sha256 |
|---|---:|---|
| `DeskTop_2.3.0.exe` | 102,994,632 | `e02601b6f8c431f9e31ecda82f624b0c29fd671166ec60d826bf150d0ddd5476` |
| `DeskTop_2.3.0.exe.blockmap` | 108,861 | `8137d402806c77bed13e2bb24a7f181597609e24d5816601a73174052854b3bf` |
| `latest.yml` | 331 | `eea5ddd27801da3349a8371aa1cac225d57393d579957529f03c7671dbee8f40` |

三个文件的 sha256 与开发机本地构建产物**逐字节一致**（已比对）。

> **这是 2.3.0 的第二版产物**：初版内嵌的更新地址是 `…:8080/win`，因端口改用 9090
> 而重新构建并覆盖上传（当时无存量用户，故直接覆盖同版本号）。因此本节的指纹与
> 2.3.0 初版**不同**，属预期。详见第 9 节第 1 条。

`latest.yml` 内容：

```yaml
version: 2.3.0
files:
  - url: DeskTop_2.3.0.exe
    sha512: d/bBKulz5TeJFyFKqmPH2yAswU/qUyser6fo/xzYIxnrbTIUdZLJVfdWx3/ImSCPI3mho8S192dmPwviwfuPQw==
    size: 102994632
path: DeskTop_2.3.0.exe
sha512: d/bBKulz5TeJFyFKqmPH2yAswU/qUyser6fo/xzYIxnrbTIUdZLJVfdWx3/ImSCPI3mho8S192dmPwviwfuPQw==
releaseDate: '2026-09-12T11:04:43.264Z'
```

---

## 3. 为什么必须是「支持 Range 的静态服务」

这不是性能优化，而是**功能正确性**要求：

1. **Range / 206 决定差量下载**。客户端用 `electron-updater` 的 blockmap 机制，
   只下载新旧安装包之间变化的块。它先探测 `Accept-Ranges: bytes`；
   若服务端不声明，`checkIsRangesSupported()` 判定失败并 `fallback to full download`
   —— 每次更新拉完整 **98 MB**，而不是通常几百 KB 的差量。
2. **`latest.yml` 绝不能被缓存**。客户端靠轮询它感知新版本。若它被缓存或返回 `304`，
   就会出现「上传成功但没人更新」这一自建更新通道最典型的故障。
3. **需要托管**。裸进程会随 SSH 会话一起死，机器重启也不会自启。

> `python3 -m http.server` 三个都不满足：stdlib 的 `SimpleHTTPRequestHandler`
> **从未实现过 Range**（既无 `Accept-Ranges` 也无 `206`），也不提供缓存头控制，
> 且没有进程托管。所以不能拿它顶替。

---

## 4. 方案 A（推荐，立即可用）

### 4.1 交付物

`/data/chenzhixu/DeskTop-release/deploy/` 下：

| 文件 | 作用 |
|---|---|
| `serve-release.py` | 静态服务本体，仅用标准库，Python 3.9 兼容 |
| `desktop-release.service` | systemd 单元（含沙箱加固） |
| `install-release-server.sh` | 安装 + 自检脚本（幂等） |
| `nginx-desktop-release.conf` | 方案 B 用的 nginx 站点配置 |

### 4.2 一键安装

```bash
cd /data/chenzhixu/DeskTop-release/deploy
sudo ./install-release-server.sh
```

脚本会依次完成：检查 python3 → 检查端口 9090 占用 → 安装 `serve-release.py`
到 `deploy/` → 安装 systemd 单元 → `daemon-reload` → `enable --now` → 跑完整自检。

**幂等**：重复执行即升级，不会删除 `win/` 下的发布产物。
上面这个**就地运行**的写法（`SRC_DIR == DEPLOY_DIR`）已受支持 —— 脚本会先比较源与目标
是否为同一文件，相同则跳过复制，不会撞上 GNU `install` 的
`'...' and '...' are the same file`（该情况实测 exit=1，在有 `set -e` 的脚本里会中断安装）。

预期输出（末段）：

```
=== 自检通过 ===
  版本清单 : http://127.0.0.1:9090/win/latest.yml  (version 2.3.0)
  内网地址 : http://172.28.193.12:9090/win/latest.yml
```

### 4.3 手工安装（等价于脚本，供审计）

```bash
# 假设部署包原始副本已放在 /tmp/desktop-deploy/（从开发机 scp 上来的那份）
SRC=/tmp/desktop-deploy
DST=/data/chenzhixu/DeskTop-release/deploy

sudo install -d -o chenzhixu -g chenzhixu "$DST"

# ⚠️ 若 SRC 与 DST 其实是同一个目录（就地运行），下面这条 install 会报
#      install: '...' and '...' are the same file
#    并以 1 退出；脚本里有 set -e 的场合会直接中断安装。故先比较再决定。
#    （GNU coreutils 8.32 实测确认：同一文件时 exit=1。）
if [ "$(readlink -f "$SRC/serve-release.py")" != "$(readlink -f "$DST/serve-release.py")" ]; then
    sudo install -m 0755 "$SRC/serve-release.py" "$DST/serve-release.py"
else
    sudo chmod 0755 "$DST/serve-release.py"
fi

sudo install -m 0644 "$SRC/desktop-release.service" \
                    /etc/systemd/system/desktop-release.service

sudo systemctl daemon-reload
sudo systemctl enable --now desktop-release
```

### 4.4 自检（任何时候可单独跑，无需 root）

```bash
/data/chenzhixu/DeskTop-release/deploy/install-release-server.sh check
```

自检覆盖 5 项，任一失败即退出非零：

| # | 检查 | 期望 |
|---|---|---|
| 1 | `latest.yml` 可获取 | HTTP 200，且带 `Cache-Control: no-store` |
| 2 | 安装包声明 Range | 响应头含 `Accept-Ranges: bytes` |
| 3 | Range 真实可用 | `Range: bytes=0-1023` → `206` 且正好 1024 字节 |
| 4 | **端到端 sha512** | HTTP 实际吐出的字节的 sha512 == `latest.yml` 声明值 |
| 5 | 不存在的版本 | HTTP 404 |

第 4 项是唯一能证明「整条链路没有被截断或改写」的检查，务必通过。

### 4.5 验收标准（服务端 agent 交付定义）

同时满足即视为完成：

```bash
# 本机
curl -sSI http://127.0.0.1:9090/win/latest.yml | head -1        # → HTTP/1.1 200 OK
curl -sS -r 0-1023 -o /dev/null -w '%{http_code} %{size_download}\n' \
     http://127.0.0.1:9090/win/DeskTop_2.3.0.exe                # → 206 1024
systemctl is-enabled desktop-release && systemctl is-active desktop-release
```

```bash
# 内网另一台机器
curl -sSI http://172.28.193.12:9090/win/latest.yml | head -1     # → HTTP/1.1 200 OK
```

---

## 5. 方案 B（可选）：nginx

**仅在能拿到 nginx 包时使用**（服务器自身有 apt 代理/内网镜像，或你从外部把 `.deb` 带进来）。
nginx 1.18 的静态模块天然支持 Range，能力上完全够用，运维上也更标准。

### 5.1 若服务器有可用镜像

```bash
sudo apt-get update && sudo apt-get install -y nginx
```

### 5.2 若只能从外部带 `.deb` 进来

在**任何一台能访问 Debian 镜像的 Linux 机器**上执行：

```bash
apt-get install --print-uris -y nginx 2>/dev/null \
  | grep -oE "'https?://[^']+\.deb'" | tr -d "'" > urls.txt

mkdir -p nginx-debs && cd nginx-debs
xargs -n1 -a ../urls.txt wget -q
tar czf ../nginx-debs.tar.gz ./*.deb
```

把 `nginx-debs.tar.gz` 传到服务器后：

```bash
tar xzf nginx-debs.tar.gz -C /tmp/nginx-debs
cd /tmp/nginx-debs
# 用 apt 而不是 dpkg -i：apt 会就地解析这些本地 .deb 之间的依赖关系
sudo apt-get install -y ./*.deb
```

### 5.3 站点配置

```bash
sudo install -m 0644 /data/chenzhixu/DeskTop-release/deploy/nginx-desktop-release.conf \
                    /etc/nginx/conf.d/desktop-release.conf
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

配置要点（详见文件内注释）：

- `location = /win/latest.yml` → `Cache-Control: no-store`、`etag off`、`if_modified_since off`、`gzip off`
- `location /win/` → 长缓存 7 天；**不关闭 Range**；`gzip off`（gzip 会改成 chunked 并丢掉 Range 语义）
- `autoindex off`（不对外暴露"服务器上有哪些版本"）

### 5.4 ⚠️ 与方案 A 互斥

两者都监听 9090。切到 nginx 前先停掉 Python 服务，反之亦然：

```bash
sudo systemctl disable --now desktop-release     # 切到 nginx
sudo systemctl disable --now nginx               # 切回 Python 服务
```

**不需要重建客户端**：两种方案对外都是同一个 URL、同一份目录、同样的 Range 语义。

---

## 6. 目录与权限

```
/data                        drwxr-xr-x  root:root          ← 755，www-data 可穿越
└── chenzhixu                drwxrwxrwx  chenzhixu:chenzhixu ← 777
    └── DeskTop-release      drwxr-xr-x  chenzhixu:chenzhixu
        ├── win/             drwxr-xr-x  chenzhixu:chenzhixu ← 发布产物，644
        └── deploy/          drwxr-xr-x  chenzhixu:chenzhixu ← 部署脚本
```

- 方案 A 以 `User=chenzhixu` 运行，天然可读，无需改权限。
- 方案 B 的 nginx worker 以 `www-data` 运行，需要每一级祖先目录有 `o+x`。
  当前链路（755/777/755/755）已满足，文件为 644 —— **无需任何 `chmod`**。
- 不要把 `DeskTop-release` 放在 `/data/chenzhixu/DeskTop` 下：该目录 owner 是 `root`，
  `chenzhixu` 不可写，上传会 `Permission denied`。

---

## 7. 日常运维

### 7.1 发布新版本（在开发机，无需登录服务器）

```bat
shell\publish.bat
```

它会：`vite build` → electron-builder 打 NSIS 包 → scp 上传 → 保留最新 5 个版本。
**上传顺序是刻意设计的**：`.exe` 与 `.blockmap` 先上，`latest.yml` **最后**上，
避免客户端轮询到一个安装包还没到位的版本。

### 7.2 手工上传（等价）

```bash
scp DeskTop_<版本>.exe DeskTop_<版本>.exe.blockmap \
    chenzhixu@172.28.193.12:/data/chenzhixu/DeskTop-release/win/
# latest.yml 必须最后传
scp latest.yml chenzhixu@172.28.193.12:/data/chenzhixu/DeskTop-release/win/
```

上传后跑一次自检确认端到端 sha512 一致：

```bash
/data/chenzhixu/DeskTop-release/deploy/install-release-server.sh check
```

### 7.3 版本清理

`publish.bat` 已自动只保留最新 5 个版本。手工清理：

```bash
cd /data/chenzhixu/DeskTop-release/win
ls -1t DeskTop_*.exe | tail -n +6 | while read f; do rm -f "$f" "$f.blockmap"; done
```

⚠️ **不要删 `latest.yml`**，也不要用 `rm -f DeskTop_*.exe` 之类通配批量删除 ——
会连带删掉当前版本。务必先 `ls -1t` 看清楚再动手。

### 7.4 客户端侧缓存

`latest.yml` 已配 `no-store`，正常情况下客户端每次都能看到最新版本。
若客户端仍不更新，先查版本号是否**严格递增**：`electron-updater` 只比较版本号，
重新上传同一个 `2.3.0` 不会触发任何更新。

---

## 8. 故障排查

| 现象 | 根因与处置 |
|---|---|
| `curl` 本机 200，内网其它机器超时 | 入站防火墙实测为 `ACCEPT`，故优先查**上层云安全组 / 网段 ACL**；再确认服务监听在 `0.0.0.0` 而非 `127.0.0.1` |
| `latest.yml` 拿到旧版本 | 缓存没禁掉。方案 A 检查 `Cache-Control` 响应头；方案 B 检查 `etag off` / `if_modified_since off` 是否生效 |
| 更新时总是下载完整 98 MB | `Accept-Ranges` 缺失。跑自检第 2、3 项；方案 B 额外确认没有 gzip / 反向代理改写了响应 |
| 客户端报 sha512 校验失败 | 传输被截断或文件被替换。跑自检第 4 项；对比 `sha256sum` 与本文 2.3 节的表 |
| 服务起不来 | `journalctl -u desktop-release -n 50 --no-pager` |
| `install-release-server.sh` 报端口被占 | `ss -tlnp \| grep 9090` 看是谁。**不要随手改端口** —— 端口同时写在 `electron-builder.json` 的 `publish.url`、`scripts/publish.mjs` 的 `UPDATE_URL`、systemd 单元和 nginx 配置里，只改一处会让打包 Preflight 直接失败（详见第 9 节第 1 条） |

---

## 9. 已知限制

1. **端口与 URL 一旦发布就不可更改**。
   `http://172.28.193.12:9090/win` 在构建时被写入客户端安装目录的
   `resources/app-update.yml`。已安装的客户端只会轮询这个地址 ——
   改端口/路径必须重新构建并让所有客户端重装。**部署时请勿擅自变更。**

   > **本方案已经历一次这样的变更**：最初定的端口是 8080，后因该端口在服务器上
   > 已被其它服务占用而改用 **9090**。因为当时还没有任何存量用户，处理方式是
   > 同步改掉 5 处配置（`electron-builder.json` / `scripts/publish.mjs` /
   > `desktop-release.service` / `nginx-desktop-release.conf` /
   > `install-release-server.sh`）后**重新构建并重新上传了 2.3.0**，
   > 未走"让客户端重装"那条路。以后若还要改，请按同样口径整体改齐，
   > 并确认已发布的安装包已同步重建。

2. **无代码签名**。未配置证书，因此：
   - 首次安装会触发 Windows SmartScreen「未知发布者」提示，需用户点「仍要运行」；
   - 更新包完整性由 `latest.yml` 的 sha512 保证（electron-updater 自动校验），
     但**没有**发布者签名校验。内网自用可接受，对外分发需补证书。

3. **HTTP 明文**。内网自用可接受；若要跨不可信网络，需加 TLS 并同步改
   `electron-builder.json` 的 `publish.url`（注意第 1 条的限制）。

4. **2.3.0 已发布**。当前 `latest.yml` 就是 `2.3.0`，
   因此**客户端装 2.3.0 后不会看到更新**。要验证更新链路，需要：
   把 `package.json` 的 `version` 提到 `2.3.1` → 重新 `publish.bat` →
   用已装 2.3.0 的机器确认弹出更新。

5. **更新器缓存目录名不理想**。`app-update.yml` 里是
   `updaterCacheDirName: electron-vite-react-updater`（派生自 `package.json` 的 `name`），
   所以更新包缓存落在 `%LOCALAPPDATA%\electron-vite-react-updater`。
   纯外观问题，不影响功能；如需修正，改 `package.json` 的 `name` 后重新发布。

6. **方案 A 是自研静态服务**，代码量约 220 行、已做字节级 Range 验证，
   但没有 nginx 那样久经考验。若后续服务器能接入镜像，建议切方案 B。

---

## 附录 A：验收命令清单（可直接粘贴）

```bash
BASE=http://127.0.0.1:9090

# 1) 清单：200 + no-store
curl -sSI $BASE/win/latest.yml | grep -iE 'HTTP/|cache-control'

# 2) 安装包：Accept-Ranges + 正确长度
curl -sSI $BASE/win/DeskTop_2.3.0.exe | grep -iE 'HTTP/|content-length|accept-ranges'

# 3) Range 真实可用
curl -sS -r 0-1023 -o /dev/null -w 'status=%{http_code} size=%{size_download}\n' \
     $BASE/win/DeskTop_2.3.0.exe

# 4) 端到端 sha512（期望 d/bBKulz5TeJFyFKqmPH2yAswU/qUyser6fo/xzYIxnrbTIUdZLJVfdWx3/ImSCPI3mho8S192dmPwviwfuPQw==）
curl -sS $BASE/win/DeskTop_2.3.0.exe | openssl dgst -sha512 -binary | openssl base64 -A; echo

# 5) 不存在的版本 → 404
curl -sS -o /dev/null -w '%{http_code}\n' $BASE/win/DeskTop_0.0.0.exe

# 6) 服务状态
systemctl is-enabled desktop-release; systemctl is-active desktop-release
```

## 附录 B：客户端侧验证

在任意一台已安装 DeskTop 的机器上：

```powershell
# 确认客户端实际轮询的地址
Get-Content "$env:LOCALAPPDATA\Programs\DeskTop\resources\app-update.yml"

# 确认服务端可达
curl.exe -sSI http://172.28.193.12:9090/win/latest.yml
```

客户端内：**设置 → 检查更新**。
`electron-updater` 只比较版本号，因此必须先把 `package.json` 的 `version` 提上去，
再重新发布，才会真正触发一次更新（见第 9 节第 4 条）。
