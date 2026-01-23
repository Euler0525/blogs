---
title: Nginx学习笔记
tags:
  - 前端
categories: 网络
mathjax: true
abbrlink: f5398568
date: 2026-02-13 14:51:46
---

运行环境

```shell
OS: Ubuntu 24.04 noble
Kernel: x86_64 Linux 6.8.0-90-generic
Shell: zsh 5.9
Disk: 13G / 68G (19%)
CPU: AMD EPYC 7K62 48-Core @ 2x 2.595GHz
GPU: Cirrus Logic GD 5446
RAM: 804MiB / 3915MiB
```

## 安装

```shell
cd /usr/local/src
wget https://nginx.org/download/nginx-1.29.5.tar.gz
tar -zxvf nginx-1.29.5.tar.gz
mv nginx-1.29.5 nginx
cd nginx
./configure
make
make install
ln -s /usr/local/nginx/sbin/nginx /usr/local/bin/  # 全局可执行
```

配置文件位于 `/usr/local/nginx/conf/nginx.conf`

## 基本指令

- 启动、停止和重新加载配置

```shell
nginx -s <signal>
```

其中 `signal` 包括

- `stop` — 快速关闭
- `quit` — 优雅关闭，也可以使用 `kill -s QUIT <PID>` 指令关闭 Nginx 服务

> 主进程的 ID 号位于 `/usr/local/nginx/logs/nginx.pid`

- `reload` — 重新加载配置文件：一旦主进程收到重新加载配置的信号，它会检查新配置文件的语法有效性并尝试应用其中提供的配置。如果成功，主进程将启动新的工作进程，并向旧的工作进程发送消息，请求它们关闭。否则，主进程将回滚更改，并继续使用旧配置。旧的工作进程收到关闭命令后，将停止接受新连接，并继续处理当前请求，直到所有此类请求都得到处理。之后，旧的工作进程退出。

> 重新加载配置后，错误日志位于 `/usr/local/nginx/logs/error.log`

- `reopen` — 重新打开日志文件

## 基本配置

### 静态服务

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    server {
        listen  80;
        server_name  localhost;

        location / {
            root   data/www;
            index  index.html;
        }

        location ^~ /images/ {
            root  data;
            index  index.html;
        }
    }
}
```

### 代理服务

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    # 用户访问的主入口，充当了反向代理服务器
    server {
        listen  80;
        server_name  localhost;

        # 当用户访问根路径时，Nginx 会将请求透明地转发给本机 8080 端口处理。
        location / {
            proxy_pass http://localhost:8080;
        }

        # 以图片格式（gif/jpg/png）结尾的请求，Nginx 不会去请求 8080 端口，而是直接去服务器本地的 data 目录下查找文件并返回
        location ~ \.(gif|jpg|png)$ {
            root  data;
        }
    }

    # 充当后端静态资源服务器
    server {
        # 监听 8080 端口，接收来自 80 端口转发过来的请求
        listen 8080;
        root data/up1/www/;

        location / {
        }
    }
}
```

## 源代码解读

> [nginx/nginx](https://github.com/nginx/nginx)

```shell
.
├── core   # 基础库与基础框架
├── event  # 事件模块
├── http   # 实现 HTTP 具体协议
├── mail
├── misc
├── os
└── stream
```

{% mermaid %}
graph LR
    subgraph core["核心模块"]
        direction LR
        ngx_core["ngx_core"]
        ngx_errlog["ngx_errlog"]
        ngx_conf["ngx_conf"]
        ngx_events["ngx_events"]
        ngx_event["ngx_event"]
        ngx_epoll["ngx_epoll"]
        ngx_regex["ngx_regex"]
    end

    subgraph modules[" "]
        direction LR
        subgraph third["第三方模块"]
            direction TB
            Rds_json_nginx["Rds-json-nginx"]
            Lua_nginx["Lua-nginx"]
            Others4["Others"]
        end
        subgraph mail["邮件服务模块"]
            direction TB
            Ngx_mail_core["Ngx_mail_core"]
            Ngx_mail_pop3["Ngx_mail_pop3"]
            Others3["Others"]
        end
        subgraph http_opt["可选 HTTP 模块"]
            direction TB
            Ngx_http_gzip["Ngx_http_gzip"]
            Ngx_http_ssl["Ngx_http_ssl"]
            Others2["Others"]
        end   
        subgraph http_std["标准 HTTP 模块"]
            direction TB
            Ngx_http_core["Ngx_http_core"]
            Ngx_http_charset["Ngx_http_charset"]
            Others1["Others"]
        end
    end
    
    core ~~~ modules
{% endmermaid %}

<center> <small> Nginx 模块设计图 </small> </center>

## 参考资料

- [Nginx 文档](https://nginx.ac.cn/en/docs/index.html)

- [Nginx 教程](https://nginx.mosong.cc/)
