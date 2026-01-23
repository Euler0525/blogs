---
title: SSH隧道端口转发访问服务器Jupyter
tags:
  - 服务器
  - SSH
  - Jupyter
categories: 工具
mathjax: true
abbrlink: e07a19dd
date: 2026-01-24 03:29:58
---

> 本文省略 Jupyter 安装流程，配置流程如下：
>
> ```shell
> jupyter notebook --generate-config
> vim .jupyter/jupyter_notebook_config.py
> ```
>
> 修改下面内容：
>
> ```python
> c.ServerApp.allow_remote_access = False
> c.ServerApp.ip = '127.0.0.1'
> c.ServerApp.notebook_dir = '<custom_path>'
> c.ServerApp.open_browser = False
> c.ServerApp.port = <custom_port>
> ```

经过上述配置后，Jupyter 只能在服务器本机的环回网卡开一个 TCP 监听端口 `<custom_port>`，只有服务器自己能访问，外界扫描不到端口，降低被爆破的风险。SSH 连接建立后，会形成一个加密的双向通道，全程加密并且能在通道中复用多路数据流，当然也包括端口转发。

服务器不开放公网端口，本地使用 SSH 建隧道，把服务器的 Jupyter 端口映射到本地，再用浏览器访问 `127.0.0.1:8888`，让原本无法访问的端口间接可达，具体做法如下：

- 在服务器启动 Jupyter（只监听本机，推荐使用 `token`，不设密码）

```shell
# 终端会输出?token =...,  需要记录
jupyter notebook --no-browser --ip=127.0.0.1 --port=<custom_port> --ServerApp.allow_remote_access=False
```

也可以使用 `systemd` 做服务，在后台长期运行 Jupyter：

```shell
# 确认 Jupyter 路径
which jupyter  # /opt/Miniconda/bin/jupyter

# 创建 user 级 systemd 服务文件
mkdir -p ~/.config/systemd/user
vim ~/.config/systemd/user/jupyter-notebook.service
```

修改 `.service` 文件（Jupyter 可执行文件路径必须使用绝对路径）

```ini
[Unit]
Description=Jupyter Notebook

[Service]
Type=simple
WorkingDirectory=%h
ExecStart=/opt/Miniconda/bin/jupyter notebook --no-browser --ip=127.0.0.1 --port=<custom_port> --ServerApp.allow_remote_access=False
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target

```

然后设为开机自启

```shell
systemctl --user daemon-reload
systemctl --user enable --now jupyter-notebook
sudo loginctl enable-linger <username>  # 无需用户登录即可运行
systemctl --user status jupyter-notebook
```

注：服务器防火墙不需要为 Jupyter 开放端口

- 本地执行下面指令，建立 SSH 隧道（推荐修改 SSH 的默认 22 端口，并且使用公私钥对登录 SSH）

```powershell
ssh -p<ssh_port> -N -L 8888:127.0.0.1:<custom_port> <username>@<server_ip>
```

这条指令在本地开一个监听端口 `8888`，任何连接到本地的 `8888` 的 TCP 连接，都会被 SSH 客户端塞进加密通道，到服务器后，SSH 服务端再去连接服务器视角下的 `127.0.0.1:<custom_port>`。在本地浏览器访问 `http://127.0.0.1:8888/?token=<token>` 打开 Jupyter，虽然访问的是本地端口，但是数据实际被转发到了服务器的 Jupyter 服务。

```ini
浏览器 -> 本机 127.0.0.1:8888
      -> SSH 客户端(本机) --加密隧道--> SSH 服务端(服务器)
      -> 服务器 127.0.0.1:<custom_port> -> Jupyter
```
