---
title: FRP 服务部署流程
description: 实现利用公网 Linux 服务器访问位于内网的 Linux 机器，并以公钥认证登陆内网 SSH（本文省略 SSH 服务的部署流程）
tags:
  - FRP
  - 内网穿透
  - SSH
categories: 工具
abbrlink: ea8330c6
date: 2026-10-25 14:44:58
---

## 网络拓扑

{% mermaid %}
flowchart LR
    A("客户端<br/>私钥：id_ed25519_frp")
    B("公网 Linux · frps<br/>TCP 6000：SSH 代理入口<br/>TCP 7000：FRP 隧道监听")
    C("内网 Linux · frpc")
    D("内网 sshd<br/>127.0.0.1:22")

    A -->|"SSH 公钥认证<br/>PUBLIC_SERVER_IP:6000"| B
    B -->|"通过 FRP 隧道转发 SSH 流量"| C
    C -->|"TCP 127.0.0.1:22"| D
    C -.->|"主动连接 frps:7000<br/>建立 TLS 加密隧道"| B

    style A fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    style B fill:#fef3c7,stroke:#d97706,color:#78350f
    style C fill:#dcfce7,stroke:#16a34a,color:#14532d
    style D fill:#f3e8ff,stroke:#9333ea,color:#581c87
{% endmermaid %}

注：图中端口仅为示例，不建议使用默认端口。frp 是用于运行服务的受限 Linux 系统账户，不能用来 SSH 登陆

- 7000：`frpc` 到 `frps` 的连接端口，使用 FRP token 认证；
- 6000：访问公网 SSH 的代理端口；
- 22：内网机器 SSH 监听端口；

```shell
❯ frps --version
0.71.1
❯ frpc --version
0.71.1
```

## 部署流程

提前生成 SSH 密钥对，私钥存在于本机，公钥安装在内网机器的 `authorized_keys`；

### 公网服务器

公网服务器配置如下

```shell
OS: Ubuntu 24.04 noble
Kernel: x86_64 Linux 6.8.0-117-generic
Shell: zsh 5.9
Disk: 68G
CPU: AMD EPYC 7K62 48-Core @ 2x 2.595GHz
GPU: Cirrus Logic GD 5446
RAM: 3915MiB
```

执行下面指令安装和配置 `frps`

```shell
sudo apt update
VERSION=0.71.1
ARCH=linux_amd64
curl -fL -o /tmp/frp.tar.gz "https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_${ARCH}.tar.gz"
tar -xzf /tmp/frp.tar.gz -C /tmp
sudo install -m 0755 "/tmp/frp_${VERSION}_${ARCH}/frps" /usr/local/bin/frps
frps --version  # 0.71.1
```

创建受限服务账户和配置目录，并生成专属 token

```shell
getent passwd frp >/dev/null || sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin frp
sudo install -d -m 0750 -o root -g frp /etc/frp
openssl rand -hex 32  # 保留生成的 64 位 十六进制字符串到临时安全位置，避免泄露
```

修改配置文件 `sudo vim /etc/frp/`

```shell
bindAddr = "0.0.0.0"
bindPort = 7000

allowPorts = [{ single = 6000 }]

auth.method = "token"
auth.token = "<FRP_TOKEN>"  # 替换为刚才生成的 token
auth.additionalScopes = ["HeartBeats", "NewWorkConns"]

transport.tls.force = true

log.to = "console"
log.level = "info"
```

然后设置权限并校验

```shell
sudo chown root:frp /etc/frp/frps.toml
sudo chmod 640 /etc/frp/frps.toml
sudo /usr/local/bin/frps verify -c /etc/frp/frps.toml
```

创建 systemd 服务并启动 `sudo vim /etc/systemd/system/frps.service`

```toml
[Unit]
Description=FRP Server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=frp
Group=frp
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

配置服务启动

```shell
sudo systemctl daemon-reload
sudo systemctl enable --now frps
sudo systemctl status frps --no-pager
sudo ss -lntp '( sport = :7000 )'
```

预期 `frps` 正常运行，TCP 7000 由 `frps` 监听。此时 TCP 6000 可能还未监听，需要等内网 `frpc` 注册代理之后才会出现。

下面配置防火墙与云安全

```shell
sudo ufw status verbose
sudo ufw allow 7000/tcp
sudo ufw allow from <EGRESS_IP> to any port 6000 proto tcp  # 推荐外部 SSH 代理端口只运行可信固定 IP
sudo ufw allow 6000/tcp                                     # 若公网出口 IP 不固定，则执行此命令
```

### 内网机器

内网机器安装 SSH 服务并且只启用公钥认证，安装并配置 `frpc`（与公网服务器安装步骤基本相同，但只安装 `frpc`）

```shell
VERSION=0.71.1
ARCH=linux_amd64
curl -fL -o /tmp/frp.tar.gz "https://github.com/fatedier/frp/releases/download/v${VERSION}/frp_${VERSION}_${ARCH}.tar.gz"
tar -xzf /tmp/frp.tar.gz -C /tmp
sudo install -m 0755 "/tmp/frp_${VERSION}_${ARCH}/frpc" /usr/local/bin/frps
/usr/local/bin/frpc --version
```

创建受限账号与配置文件

```shell
getent passwd frp >/dev/null || sudo useradd --system --user-group \
  --no-create-home --shell /usr/sbin/nologin frp
sudo install -d -m 0750 -o root -g frp /etc/frp
sudo vim /etc/frp/frpc.toml
```

写入配置文件

```toml
serverAddr = "<PUBLIC_SERVER_IP>"  # 替换为公网服务器 IP 地址
serverPort = 7000

auth.method = "token"
auth.token = "<FRP_TOKEN>"  # 替换为在公网服务器中生成的 token
auth.additionalScopes = ["HeartBeats", "NewWorkConns"]

transport.protocol = "tcp"
transport.tls.enable = true

log.to = "console"
log.level = "info"

[[proxies]]
name = "ssh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
```

权限与校验

```shell
sudo chown root:frp /etc/frp/frpc.toml
sudo chmod 640 /etc/frp/frpc.toml
sudo /usr/local/bin/frpc verify -c /etc/frp/frpc.toml
```

创建 systemd 服务 `sudo vim /etc/systemd/system/frpc.service`

```ini
[Unit]
Description=FRP Client Service
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=frp
Group=frp
ExecStart=/usr/local/bin/frpc -c /etc/frp/frpc.toml
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

配置服务启动

```shell
sudo systemctl daemon-reload
sudo systemctl enable --now frpc
sudo systemctl status frpc --no-pager
sudo journalctl -u frpc -n 30 --no-pager
# login to server success
# proxy added: [ssh]
# [ssh] start proxy success
```

## 验证

### 内网机器

确认 sshd 服务

```shell
sudo ss -lntp '( sport = :22 )'
timeout 5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/22; IFS= read -r line <&3; printf "%s\n" "$line"'
# State         Recv-Q        Send-Q                Local Address: Port                 Peer Address: Port        # Process
# LISTEN        0             128                         0.0.0.0:22                      0.0.0.0:*            users:(("sshd", pid = 338, fd = 6))
# LISTEN        0             128                            [::]:22                         [::]:*            users:(("sshd",pid=338,fd=7))
# SSH-2.0-OpenSSH_10.4p1 Debian-5
```

### 公网服务器

确认 frps 服务（在 frpc 注册之后出现对 6000 端口的监听）

```shell
sudo ss -lntp '( sport = :7000 or sport = :6000 )'
# State   Recv-Q  Send-Q   Local Address: Port   Peer Address: Port  Process
# LISTEN  0       4096                 *: 7000              *:*      users:(("frps", pid = 988511, fd = 4))
# LISTEN  0       4096                 *: 6000              *:*      users:(("frps", pid = 988511, fd = 8))
```

验证 FRP 转发到 SSH

```shell
timeout 10 bash -c '
exec 3<>/dev/tcp/127.0.0.1/6000
IFS= read -r line <&3
printf "%s\n" "$line"
'
# SSH-2.0-OpenSSH_10.4p1 Debian-5
```

---

配置完成后，使用本机尝试 SSH 登录内网机器 `sh -p 6000 <username>@<remote_ip>`

## 参考资料

[frp | 配置文件](https://gofrp.org/zh-cn/docs/features/common/configure/)


## 附录

常用实时日志

```shell
# 公网服务器
sudo journalctl -u frps -f
# 内网机器
sudo journalctl -u frpc -f
sudo journalctl -u ssh -f
```

多台内网机器独立配置 `frpc` 可共用一个 `frps:7000`，但是代理名称和公网端口不能冲突，形如

| 内网机器 |     `name`      | `localPort` | `remotePort` | Windows 连接                           |
| :------: | :-------------: | :---------: | ------------ | -------------------------------------- |
|    A     | `ssh-machine-a` |   `2200`    | `6000`       | `ssh -p 6000 userA@<PUBLIC_SERVER_IP>` |
|    B     | `ssh-machine-b` |   `2201`    | `6001`       | `ssh -p 6001 userB@<PUBLIC_SERVER_IP>` |
|    C     | `ssh-machine-c` |   `2202`    | `6002`       | `ssh -p 6002 userC@<PUBLIC_SERVER_IP>` |

并且增加其它机器后，需要同步修改 `frps.toml` 文件 `allowPorts = [{ start = 6000, end = 6002 }]`，更新防火墙策略。

