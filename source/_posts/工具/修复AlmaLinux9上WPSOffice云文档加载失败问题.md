---
title: 修复 AlmaLinux 9 上 WPS Office 云文档加载失败问题
description: 修复 AlmaLinux 9 上 WPS Office 云文档加载失败问题
tags:
  - CA证书
  - WPS
  - Alamainux
categories: 工具
abbrlink: db63fd6c
date: 2026-10-20 21:16:39
---

## 复现环境

- 操作系统

```shell
         'c:.
        lkkkx, ..       ..   ,cc,           -------------------
        okkkk:ckkx'  .lxkkx.okkkkd          OS: AlmaLinux 9.8 (Olive Jaguar) x86_64
        .:llcokkx'  :kkkxkko:xkkd,          Host: 83DF (Legion Y9000P IRX9)
      .xkkkkdood:  ;kx,  .lkxlll;           Kernel: Linux 5.14.0-687.58.1.el9_8.x86_64
       xkkx.       xk'     xkkkkk:
       'xkx.       xd      .....,.          Packages: 8 (flatpak), 1508 (rpm)
      .. :xkl'     :c      ..''..           Shell: zsh 5.8
    .dkx'  .:ldl:'. '  ':lollldkkxo;        Display (CSW1643): 2560x1600 in 16", 240 Hz [Built-in]
  .''lkkko'                     ckkkx.      DE: GNOME 40.10
'xkkkd:kkd.       ..  ;'        :kkxo.      WM: Mutter (X11)
,xkkkd;kk'      ,d;    ld.   ':dkd::cc,     WM Theme: Adwaita
 .,,.;xkko'.';lxo.      dx,  :kkk'xkkkkc    Theme: Adwaita [GTK2/3/4]
     'dkkkkkxo:.        ;kx  .kkk:;xkkd.    Icons: Adwaita [GTK2/3/4]
       .....   .;dk:.   lkk.  :;,           Font: Cantarell (11pt) [GTK2/3/4]
             :kkkkkkkdoxkkx                 Cursor: Adwaita (24px)
              ,c,,;;;:xkkd.                 Terminal: GNOME Terminal 3.40.3
                ;kkkkl...                   Terminal Font: Maple Mono NF CN (20pt)
                ;kkkkl                      CPU: Intel(R) Core(TM) i9-14900HX (16+16) @ 5.80 GHz
                 ,od;                       GPU 1: NVIDIA GeForce RTX 4060 Max-Q / Mobile [Discrete]
                                            GPU 2: Intel Raptor Lake-S UHD Graphics @ 1.65 GHz [Integrated]
                                            Memory: 6.34 GiB / 30.82 GiB (21%)
                                            Swap: 0 B / 32.00 GiB (0%)
                                            Disk (/): 361.08 GiB / 897.56 GiB (40%) - xfs
                                            Locale: en_US.UTF-8
```

- WPS Office

```shell
wps-office-12.1.2.29183.AK.preread.sw.Personal-1-806792.x86_64.rpm: RPM v3.0 bin i386/x86_64 wps-office-12.1.2.29183.AK.preread.sw-1
SHA256: 23292233dd3d2cc8b731e4cb27aadc478285b49eb7afb8a36bd5583fe65a9ffa
```

## 定位原因

```shell
sudo dnf install ./wps-office-12.1.2.29183.AK.preread.sw.Personal-1-806792.x86_64.rpm
```

在这台机器上，WPS Office 软件可以启动，也能打开本地文档，但 **我的云文档** 一直显示 **加载失败**，云空间容量也显示异常。同一账号在 `https://www.kdocs.cn` 网页版中可以正常使用。

（经过附录中列出的诸多尝试）最终确认问题是 WPS 自带网络库查找的 CA 证书文件路径与 AlmaLinux 9.8 提供的路径不同。WPS 自带的 `/opt/kingsoft/wps-office/office6/libcurl.so.4.8.0` 包含默认 CA 文件路径 `/etc/ssl/certs/ca-certificates.crt`。在故障发生时，对 WPS 进行系统调用跟踪，可以看到它反复尝试打开该文件，但得到 `ENOENT`

```shell
openat(AT_FDCWD, "/etc/ssl/certs/ca-certificates.crt", O_RDONLY) = -1 ENOENT (No such file or directory)
```

经过下面指令的验证

```shell
strings -a /opt/kingsoft/wps-office/office6/libcurl.so.4.8.0 | grep -F '/etc/ssl/certs/ca-certificates.crt'
readlink -f /etc/ssl/certs
readlink -f /etc/pki/tls/certs/ca-bundle.crt
```

系统 CA 证书实际位于 `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem`，并通过 `/etc/pki/tls/certs/ca-bundle.crt` 提供；`/etc/ssl/certs` 本身指向 `/etc/pki/tls/certs`。因此软件故障时 WPS 要找的 `ca-certificates.crt` 文件并不存在。

## 修复方法

先确认本机目录结构与上述环境一致，且目标文件尚不存在。然后创建一条指向系统 CA 证书的符号链接

```bash
test "$(readlink -f /etc/ssl/certs)" = /etc/pki/tls/certs &&
test -r /etc/pki/tls/certs/ca-bundle.crt &&
test ! -e /etc/ssl/certs/ca-certificates.crt &&
test ! -L /etc/ssl/certs/ca-certificates.crt &&
sudo ln -s -- ca-bundle.crt /etc/ssl/certs/ca-certificates.crt
```

并且系统更新证书包后，WPS 仍会读取更新后的证书集合。下面验证链接指向及内容

```bash
readlink -f /etc/ssl/certs/ca-certificates.crt
cmp /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt
```

本次 `readlink -f` 输出 `/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem`，`cmp` 无输出且退出码为 `0`。完全退出 WPS 后，重新启动 WPS，**我的云文档** 列表与云空间容量均正常显示。

注：如果需要撤销并且确认该链接正是按上面的方法创建的，可运行 `sudo rm -- /etc/ssl/certs/ca-certificates.crt`

## 参考资料

[WPS Office | WPS Office for Linux](https://linux.wps.cn/)

[WPS 社区 | wps linux 报“空间已满”，无法正常使用](https://bbs.wps.cn/topic/46387)

[Packages for Linux and Unix | ca-certificates-2025.2.80_v9.0.305-91.el9.noarch](https://oraclelinux.pkgs.org/9/ol9-baseos-latest-x86_64/ca-certificates-2025.2.80_v9.0.305-91.el9.noarch.rpm.html)

## 附录

以下为未奏效的尝试，留作纪念

- 检查 `~/.local/share/Kingsoft` 的文件属主，以及 `~/Documents/WPS Cloud Files` 的权限和挂载状态，未发现能解释云文档加载失败的异常。
- 检查 `wpscloudsvr` 进程、主程序动态库依赖及 RPM 文件完整性，未发现云服务进程未启动、主程序缺库或安装文件损坏。
- 运行 WPS 内置的“配置和修复功能 → 检测并修复并重启，云文档仍然加载失败。
- 完全退出 WPS 后清理 CEF 等网页缓存再启动，云文档仍然加载失败。
- 退出客户端账号并用网页版相同账号重新登录，容量和云文档列表仍然异常。
- 测试 `qing.wps.cn`、`drive.wps.cn` 和 `qingcenter.wps.cn` 的连通性，虽发现 `qingcenter.wps.cn` 无法解析，但这条线索没有解决客户端故障。
- 检查云索引 SQLite 数据库的完整性和已有记录，没有发现数据库损坏能解释这次故障。
- 发现安装包内 `kpaintconfig/mui/linux/1.3.json` 有尾逗号并在隔离启动中提供修正副本，云文档仍然加载失败。
- 根据 CEF 图形进程崩溃记录在隔离配置中设置 `kcef\DisableGpu=true`，与修正 JSON 一同测试后云文档仍然加载失败。
- 首次用 `bwrap` 隔离测试时未正确映射 `/dev`，引入了 `/dev/null` 权限和 GPU 进程错误；补上设备映射后这些测试环境错误消失，但云文档故障仍在。
- 检查安装包中失效的 `libbz2.so` 链接和压缩插件的缺库情况，跟踪时该插件没有参与云文档列表加载，因此修它无法解释本次问题。

---

- 一键修复脚本（由 GPT-6-Sol High 生成，已验证）

```shell
#!/usr/bin/env bash
set -euo pipefail

certdir=/etc/ssl/certs
expected_dir=/etc/pki/tls/certs
source_cert=/etc/pki/tls/certs/ca-bundle.crt
compat_cert="$certdir/ca-certificates.crt"

if [[ "$(readlink -f "$certdir")" != "$expected_dir" ]]; then
  printf '证书目录结构与诊断时不同，停止修改。\n' >&2
  exit 1
fi

if [[ ! -r "$source_cert" ]]; then
  printf '系统 CA 证书不可读：%s\n' "$source_cert" >&2
  exit 1
fi

if [[ -e "$compat_cert" || -L "$compat_cert" ]]; then
  if [[ "$(readlink "$compat_cert")" == 'ca-bundle.crt' ]]; then
    printf '兼容链接已存在，无需重复修改。\n'
  else
    printf '目标路径已存在其他文件；为避免覆盖，停止修改：%s\n' "$compat_cert" >&2
    exit 1
  fi
else
  sudo ln -s -- ca-bundle.crt "$compat_cert"
  printf '已建立 WPS 所需的 CA 证书兼容链接。\n'
fi

cmp -s "$compat_cert" "$source_cert" || {
  printf '证书链接校验失败。\n' >&2
  exit 1
}

printf '校验通过。请完全退出 WPS 后，从原来的应用菜单启动并刷新云文档。\n'
```

