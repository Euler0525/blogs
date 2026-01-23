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
    subgraph core ["核心模块"]
        direction LR
        ngx_core ["ngx_core"]
        ngx_errlog ["ngx_errlog"]
        ngx_conf ["ngx_conf"]
        ngx_events ["ngx_events"]
        ngx_event ["ngx_event"]
        ngx_epoll ["ngx_epoll"]
        ngx_regex ["ngx_regex"]
    end

    subgraph modules [" "]
        direction LR
        subgraph third ["第三方模块"]
            direction TB
            Rds_json_nginx ["Rds-json-nginx"]
            Lua_nginx ["Lua-nginx"]
            Others4 ["Others"]
        end
        subgraph mail ["邮件服务模块"]
            direction TB
            Ngx_mail_core ["Ngx_mail_core"]
            Ngx_mail_pop3 ["Ngx_mail_pop3"]
            Others3 ["Others"]
        end
        subgraph http_opt ["可选 HTTP 模块"]
            direction TB
            Ngx_http_gzip ["Ngx_http_gzip"]
            Ngx_http_ssl ["Ngx_http_ssl"]
            Others2 ["Others"]
        end
        subgraph http_std ["标准 HTTP 模块"]
            direction TB
            Ngx_http_core ["Ngx_http_core"]
            Ngx_http_charset ["Ngx_http_charset"]
            Others1 ["Others"]
        end
    end

    core ~~~ modules
{% endmermaid %}

<center> <small> Nginx 模块设计图 </small> </center>

### 基础架构

#### 事件模型

```c
/**
 * 伪代码摘自 https://tengine.taobao.org/book/chapter_02.html
 */
while (true) {
    // 1. 处理即时任务（Posted Events）
    for t in run_tasks:
        t.handler();

    // 2. 定时器管理（Timer Wheel）
    update_time(&now);
    timeout = ETERNITY;
    for t in wait_tasks: /* sorted already */
        if (t.time <= now) {
            t.timeout_handler();
        } else {
            timeout = t.time - now;
            break;
        }

    // 3. I/O 多路复用（核心阻塞点）
    nevents = poll_function(events, timeout);

    // 4. 事件分发与任务转化
    for i in nevents:
        task t;
        if (events[i].type == READ) {
            t.handler = read_handler;
        } else { /* events[i].type == WRITE */
            t.handler = write_handler;
        }
        run_tasks_add(t);
}
```

Worker 进程启动后，进入死循环，对应 `ngx_process_cycle` 中的事件循环部分。

1. 首先处理即时任务，在执行 I/O 等待之前，先处理当前已经就绪的、不需要等待的 I/O 任务，对应 Nginx 的投递事件 `Posted Events`；
2. 定时器管理：检查是否有超时任务需要执行，并计算下一次 I/O 等待的最长时间，对应 Nginx 中的定时器队列 `Timer Queue`；
3. I/O 多路复用：调用操作系统内核提供的 I/O 多路复用接口，等待事件发生，对应 Linux 的 `epoll_wait()`；Work 进程在这里进入睡眠状态，不占用 CPU。**网络 I/O 事件发生** 或 **定时器超时** 被 **唤醒**；
4. 事件分发与任务转化：将内核通知的 I/O 事件，转化为应用层的可执行任务，放入下一轮的 `run_tasks` 队列，对应 Nginx 的事件回调注册 `Event Callback Registration`；遍历所有就绪的事件，判断可读或可写类型，构造对应的处理函数，然后加到队列中，下一轮循环开始时执行；

#### 事件循环

```c
/**
 * 伪代码摘自 https://tengine.taobao.org/book/chapter_02.html
 */

// 背压机制, 当连接池快用完时, 暂停接受新连接, 优先处理现有请求
ngx_accept_disabled = ngx_cycle->connection_n / 8 - ngx_cycle->free_connection_n;

////////////////////////////////////////////////////////////////////////////////
// ngx_event.c ngx_process_events_and_timers
if (ngx_accept_disabled > 0) {
    ngx_accept_disabled--;
} else {
    // Accept 锁解决惊群效应, 多个 Worker 进程同时抢接受新连接, 最终只有一个成功, 导致 CPU 浪费
    if (ngx_trylock_accept_mutex(cycle) == NGX_ERROR) {
        return;
    }

    if (ngx_accept_mutex_held) {
        flags |= NGX_POST_EVENTS;
    } else {
        // 定时器调整, 实现负载均衡与公平性
        if (timer == NGX_TIMER_INFINITE || timer > ngx_accept_mutex_delay) {
            timer = ngx_accept_mutex_delay;
        }
    }
}
```

这段程序的主要作用是 **控制新连接的接受速率**、**协调多 Worker 进程间的负载均衡**。

```shell
Nginx Worker 事件循环
│
├── 1. 检查连接池水位 (ngx_accept_disabled)
│   ├── 空闲连接 < 12.5% ? ──> 暂停 accept (背压)
│   └── 空闲连接充足 ──> 继续
│
├── 2. 竞争 Accept 锁 (ngx_trylock_accept_mutex)
│   ├── 抢到锁 ? ──> 标记 NGX_POST_EVENTS (延迟 accept)
│   └── 没抢到 ? ──> 本次循环只处理 I/O，不接受新连接
│
├── 3. 调整 epoll_wait 超时 (timer)
│   ├── 没抢到锁 ? ──> 强制 timer = 500ms (快速醒来再抢)
│   └── 抢到锁 ? ──> 使用正常 timer
│
├── 4. 调用 epoll_wait(timer)
│   └── 等待 I/O 事件或超时唤醒
│
└── 5. 处理事件 (I/O 或 Posted Accept)
```

`ngx_cycle->connection_n` 表示启动时预分配的连接池总大小，`ngx_cycle->free_connection_n` 表示空闲的可用连接数，如果空闲数超过总数的 $\dfrac{1}{8}$，正常接受新连接，否则暂停接受新连接，并且持续暂停多次循环，留给 Nginx 足够时间处理积压的请求；

---

`ngx_trylock_accept_mutex` 尝试获得一个全局锁，成功则 `ngx_trylock_accept_mutex` 为 1，当前 Worker 获得唯一接受新连接的权限，否则放弃本次机会，只处理已有连接的 I/O；如果拿到锁，设置 `NGX_POST_EVENTS` 标志，通知事件处理模块将 `accept` 放入延迟队列，等处理完已经就绪的 I/O 事件后，在接受新连接；确保同一时刻只有一个 Worker 进程调用 `accept()`，避免多进程竞争，减少上下文切换和系统调用开销。

> 优先处理当前已经就绪的 I/O 事件（如读取已建立连接的数据），处理完后再 `accept` 新连接。这有助于更快释放连接资源，配合上面的背压机制。

---

一个 Worker 没有拿到锁，它不会接受新连接，如果它进入 `epoll_wait` 并且休眠很久，其实其它拿到锁的 Worker 处理完了，自己还在休眠，无法竞争下一轮锁，这会导致负载不均，于是程序重新配置定时器，强制唤醒，超过 `ngx_accept_mutex_delay` 时间后再次尝试 `ngx_trylock_accept_mutex`，通过限制最大休眠时间，确保所有 Worker 都能有机会频繁地竞争锁，均匀分担新连接的压力。

### 数据结构

> Nginx 实现了一些自定义的数据结构并提供 API，核心思路包括：
>
> - **内存池化**：避免碎片，简化生命周期管理；
> - **嵌入式设计**：队列、树节点嵌入业务结构，避免额外指针跳转；
> - **零拷贝**：Buffer 设计支持直接发送文件描述符；
> - **空间换时间**：哈希表预计算，数组连续内存，最大化 CPU 缓存命中率；

```shell
ngx_cycle_t (全局)
  │
  ├─ ngx_pool_t (全局池)
  │
  └─ ngx_connection_t[] (连接数组)
       │
       └─ ngx_http_request_t (请求对象，每个连接一个)
            │
            ├─ pool: ngx_pool_t* (请求池)
            ├─ uri: ngx_str_t (请求 URI)
            ├─ headers_in: ngx_list_t (请求头链表)
            ├─ out: ngx_chain_t* (响应输出链)
            │      ├─ buf: ngx_buf_t (响应头)
            │      └─ next → buf: ngx_buf_t (响应体)
            └─ timer: ngx_rbtree_node_t (嵌入红黑树节点)
```

- [内存池 `ngx_pool_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_string.h)：每个 HTTP 请求 `ngx_http_request_t` 都有一个 `pool`，请求过程中产生的临时变量都从 `pool` 分配，请求结束 `ngx_destroy_pool` 清理；

- [字符串 `ngx_str_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_string.h)：显式记录字符串长度；

- [动态数组 `ngx_array_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_array.h)：从 `pool` 中分配，无需手动释放；地址连续，CPU 缓存友好；

- [链表 `ngx_list_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_list.h)：数组的链表，分段连续。用于存储数量不确定、需要频繁追加的元素，例如请求头宇响应头（数量不确定且需要逐个解析）；

- [队列 `ngx_queue_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_queue.h)：嵌入式双向链表，只包含指针；

- [缓冲区 `ngx_buf_t, ngx_chain_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_buf.h)：实现零拷贝和过滤器链；

- [红黑树 `ngx_rbtree_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_rbtree.h)：用于查找和排序，例如定时器、DNS 缓存；

- [哈希表 `ngx_hash_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_hash.h)

|      数据结构      |  对应标准库   |              Nginx 优化              |
| :------------: | :-----------: | :----------------------------------: |
|  `ngx_pool_t`  | `malloc/free` |  **防泄漏**、减少系统调用、批量释放  |
|  `ngx_str_t`   |    `char*`    |      **O(1) 长度**、二进制安全       |
| `ngx_array_t`  | `std::vector` |  **基于 Pool**、连续内存、缓存友好   |
|  `ngx_list_t`  |  `std::list`  |    **分段连续**、兼顾灵活性与性能    |
| `ngx_queue_t`  |   双向链表    |  **嵌入式**、可反推结构体、通用性强  |
|  `ngx_buf_t`   |    Buffer     | **零拷贝支持** (`in_file`)、散聚 I/O |
| `ngx_rbtree_t` |  `std::map`   |      **嵌入式**、定时器专用优化      |
|  `ngx_hash_t`  |   `HashMap`   |   **静态预计算**、查找速度极致优化   |

## 参考资料

- [Nginx 文档](https://nginx.ac.cn/en/docs/index.html)

- [Nginx 教程](https://nginx.mosong.cc/)

- [Nginx 开发从入门到精通](https://tengine.taobao.org/book/)
