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

### 部署版

```shell
cd /usr/local/src
wget https://nginx.org/download/nginx-1.28.2.tar.gz
tar -zxvf nginx-1.28.2.tar.gz
cd nginx-1.28.2/
./configure
make
make install
ln -s /usr/local/nginx/sbin/nginx /usr/local/bin/  # 全局可执行
```

配置文件位于 `/usr/local/nginx/conf/nginx.conf`

### 调试版

```shell
cd /usr/local/src
wget https://nginx.org/download/nginx-1.28.2.tar.gz
tar -zxvf nginx-1.28.2.tar.gz
cd nginx-1.28.2/
chmod +x build-debug.sh
./build-debug.sh  # 脚本内容如下(置于 nginx-1.28.2/目录下)
mkdir -p /tmp/nginx-debug/logs
chmod 777 /tmp/nginx-debug/logs

ulimit -c unlimited
echo "core.%p.%u.%s.%e.%t" | sudo tee /proc/sys/kernel/core_pattern
```

```shell
#!/bin/bash

make clean

./configure \
    --prefix=/tmp/nginx-debug \
    --with-debug \
    --with-cc-opt="-g -O0" \
    --with-ld-opt="-g" \
    --with-http_ssl_module \
    --with-http_v2_module \
    --with-stream \
    --with-stream_ssl_module

make -j$(nproc)
make install

echo "Nginx debug build complete: /tmp/nginx-debug"
```

然后修改配置文件 `/tmp/nginx-debug/conf/nginx.conf`

```json
error_log  /tmp/nginx-debug/logs/error.log  debug;

daemon off;
worker_processes  1;

# master_process on;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    access_log  /tmp/nginx-debug/logs/access.log;

    server {
        listen  8080;
        server_name  localhost;

        location / {
            root   html;
            index  index.html index.htm;
        }

        location /test {
            return 200 "Debug Test OK\n";
        }
    }
}
```

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
        } else { /* events [i].type == WRITE */
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
>
> *注：这一部分仅介绍数据结构，相关 API 函数调用 gdb 调试学习……*

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

#### 内存池

传统的 `malloc/free` 设计内核态切换，频繁调用性能差，且需要逐个手动释放；HTTP 请求处理过程中需要频繁分配和释放小内存，会产生内存碎片……

[内存池 `ngx_pool_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_string.h)：每个 HTTP 请求 `ngx_http_request_t` 都有一个 `pool`，请求过程中产生的临时变量都从 `pool` 分配，请求结束由 `ngx_destroy_pool` 统一清理；自动处理内存对齐，提高 CPU 访问效率。

```c
/* src/core/ngx_palloc.h */
struct ngx_pool_s {
    ngx_pool_data_t       d;        // 存储当前内存块的可用内存信息
    size_t                max;      // 区分大小内存块的阈值, 从池内小块内存块分配还是 malloc 分配
    ngx_pool_t           *current;  // 当前可分配的内存块, 避免遍历
    ngx_chain_t          *chain;    // 空闲缓冲区链表
    ngx_pool_large_t     *large;    // 指向大块内存块链表, 通过 malloc 分配的内存块位于该链表
    ngx_pool_cleanup_t   *cleanup;  // 指向清理函数链表
    ngx_log_t            *log;      // 用于记录内存分配过程中的错误信息
};

typedef struct {
    u_char               *last;    // 当前内存块已分配的末尾, 下一个可用地址
    u_char               *end;     // 当前内存块的结束地址, [last, end)为当前内存块可用范围
    ngx_pool_t           *next;    // 指向链表中的下一个内存块
    ngx_uint_t            failed;  // 内存分配失败次数, 超过阈值时更换 current 指针指向链表的下一个块
} ngx_pool_data_t;

typedef struct ngx_pool_large_s  ngx_pool_large_t;

struct ngx_pool_large_s {         // 对于超过 max 阈值的使用 malloc 分配, 通过该结构链接到大块链表
    ngx_pool_large_t     *next;   // 下一个大块内存
    void                 *alloc;  // 指向 malloc 分配的内存地址
};

typedef struct ngx_pool_cleanup_s  ngx_pool_cleanup_t;

struct ngx_pool_cleanup_s {
    ngx_pool_cleanup_pt   handler;  // 内存清理函数
    void                 *data;
    ngx_pool_cleanup_t   *next;
};


+------------------------+
| ngx_pool_t             |
| +------------------+   |
| | ngx_pool_data_t  |   |
| | last             |   |
| | end              |   |------> 内存块1 [start, last)已分配，[last, end)可用
| | next ------------+---+------> 内存块2
| | failed           |   |
| +------------------+   |
| max                    |
| current ---------------+------> 指向当前可分配的第一个内存块
| large -----------------+--+
| cleanup ---------------+--+----> 清理函数1 -> 清理函数2 -> ...
| log                    |  |
+------------------------+  |
                            |
                            v
                     +------------------+
                     | ngx_pool_large_t |
                     | next --+         |
                     | alloc--+---------+--> 大块内存1
                     +--------+---------+
                              |
                              v
                     +------------------+
                     | ngx_pool_large_t |
                     | next             |
                     | alloc------------+--> 大块内存2
                     +------------------+
```

与 ptmalloc 相比，Nginx 内存池将 **按对象分配/释放** 转变为 **按生命周期分配/批量释放**。HTTP 请求时典型的分配密集，释放集中的场景，请求开始时，Header, URL, Context, Buffer 集中分配；请求结束时，所有临时数据都不再需要，请求结束，池销毁，自动回收。

其劣势在于不适合长期运行的内存（仍需手动管理）；如果频繁分配和释放小内存块，内存池会持续占用直到销毁（使用 `ngx_reset_pool` 复用）；新内存块与第一块大小相同，过大会导致浪费，过小会频繁创建新块增加管理开销。

其值得学习的点在于 **小块内存池内分配 + 大块内存单独管理**，**清理函数机制将资源释放与内存池生命周期绑定，比单纯依赖编码规范更可靠**。

#### 字符串

[字符串 `ngx_str_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_string.h)：显式记录字符串长度；



#### 数组

[数组 `ngx_array_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_array.h)：从 `pool` 中分配，无需手动释放；地址连续，CPU 缓存友好；

```c
typedef struct {
    void        *elts;    // 数组起始地址
    ngx_uint_t   nelts;   // 已使用容量(数组元素个数)
    size_t       size;    // 每个元素大小
    ngx_uint_t   nalloc;  // 分配总容量(数组元素个数)
    ngx_pool_t  *pool;    // 内存池
} ngx_array_t;
```

#### 链表

[链表 `ngx_list_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_list.h)：数组的链表，分段连续。用于存储数量不确定、需要频繁追加的元素，例如请求头宇响应头（数量不确定且需要逐个解析）；

#### 队列

[队列 `ngx_queue_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_queue.h)：循环双向链表，只包含指针；

使用快慢指针找到循环链表的中间位置；归并排序。

#### 缓冲区

[缓冲区 `ngx_buf_t, ngx_chain_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_buf.h)：实现零拷贝和过滤器链；

```c
struct ngx_buf_s {
    u_char          *pos;           // 待处理数据开始标记
    u_char          *last;          // 待处理数据结尾标记
    off_t            file_pos;      // 待处理文件开始标记
    off_t            file_last;     // 待处理文件结尾标记

    u_char          *start;         /* start of buffer */
    u_char          *end;           /* end of buffer */
    ngx_buf_tag_t    tag;           // 缓冲区标记地址
    ngx_file_t      *file;          // 引用的文件
    ngx_buf_t       *shadow;


    /* the buf's content could be changed */
    unsigned         temporary:1;

    /*
     * the buf's content is in a memory cache or in a read only memory
     * and must not be changed
     */
    unsigned         memory:1;

    /* the buf's content is mmap()ed and must not be changed */
    unsigned         mmap:1;

    unsigned         recycled:1;
    unsigned         in_file:1;
    unsigned         flush:1;
    unsigned         sync:1;
    unsigned         last_buf:1;
    unsigned         last_in_chain:1;

    unsigned         last_shadow:1;
    unsigned         temp_file:1;

    /* STUB */ int   num;
};

typedef struct ngx_chain_s       ngx_chain_t;

struct ngx_chain_s {
    ngx_buf_t    *buf;   // 如果一次需要的缓冲区内存很大, 可以将缓冲区串起来
    ngx_chain_t  *next;
};
```

该结构仅用来描述数据位置，而不会拷贝数据。

分配链表节点时，使用二级指针高效串联链表，[点击此处](https://euler0525.github.io/wiki/programming/c/#_2) 查看。

#### 红黑树

[红黑树 `ngx_rbtree_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_rbtree.h)：用于查找和排序，例如定时器、DNS 缓存；

#### 哈希表

[哈希表 `ngx_hash_t`](https://github.com/nginx/nginx/blob/master/src/core/ngx_hash.h)

> [Using goto for Exception Handling in C](https://www.geeksforgeeks.org/c/using-goto-for-exception-handling-in-c/)
>
> While generally discouraged in modern programming due to readability and maintainability concerns, goto can be a clean solution for error handling in specific scenarios.

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

### 主流程

#### 启动流程

|    选项     |     对应全局变量     | 含义                           |
| :---------: | :------------------: | :----------------------------- |
| `-?`, `-h`  |   `ngx_show_help`    | 显示帮助信息                   |
|    `-v`     |  `ngx_show_version`  | 显示 Nginx 版本                |
|    `-V`     | `ngx_show_configure` | 显示版本及编译配置参数         |
|    `-t`     |  `ngx_test_config`   | 测试配置文件语法，不启动       |
|    `-T`     |  `ngx_dump_config`   | 测试并打印解析后的配置         |
|    `-q`     |   `ngx_quiet_mode`   | 安静模式，测试时不输出成功信息 |
| `-p <path>` |     `ngx_prefix`     | 指定 Nginx 安装前缀路径        |
| `-c <file>` |   `ngx_conf_file`    | 指定配置文件路径               |
| `-g <cmds>` |  `ngx_conf_params`   | 在配置文件前添加全局指令       |
| `-e <file>` |   `ngx_error_log`    | 指定错误日志文件路径           |
| `-s <sig>`  |     `ngx_signal`     | 向运行中的 Nginx 发送信号      |

```shell
开始 (main)
  │
  ├─> 基础初始化 (调试、错误字符串)
  ├─> 解析命令行参数 (get_options)
  ├─> 检查版本/帮助 (如有则退出)
  │
  ├─> 初始化日志 (log_init)
  ├─> 创建临时 Cycle (init_cycle) 和内存池
  ├─> 处理路径与 OS 初始化 (os_init)
  ├─> 模块预初始化 (preinit_modules)
  │
  ├─> 加载配置文件 (ngx_init_cycle) <── 核心步骤
  │     └─> 解析 nginx.conf
  │     └─> 初始化所有模块
  │
  ├─> 检查特殊模式
  │     ├─> 配置测试 (-t) ? → 打印结果 → 退出
  │     └─> 信号控制 (-s) ? → 发送信号 → 退出
  │
  ├─> 切换为正式 Cycle (ngx_cycle = cycle)
  ├─> 初始化信号处理 (init_signals)
  ├─> 守护进程化 (daemon) [fork 子进程，父进程退出]
  ├─> 创建 PID 文件
  ├─> 重定向 stderr 到日志
  │
  └─> 进入主循环
        ├─> 单进程模式 (single_process_cycle)
        └─> 多进程模式 (master_process_cycle) [启动 Worker]
```

`init_cycle` 是为了加载配置而存在的临时容器；`cycle` 是配置加载完成后生成的正式运行时容器。`ngx_init_cycle` 内部会销毁 `init_cycle` 的资源并创建新的 `cycle`；

Nginx 在变成守护进程（后台运行）之前，必须先完成配置文件的加载和校验。这保证了如果配置有误，管理员能在终端看到错误，而不是进程在后台启动失败却无从知晓；

具体的业务逻辑（如 HTTP 处理、事件驱动、负载均衡等）都分散在各个模块的初始化回调中，通过 `ngx_init_cycle` 统一调度；

#### 平滑重启

Nginx 允许在不中断服务的情况下升级版本，实现流程如下图所示

{% mermaid %}

sequenceDiagram
    participant Admin as 管理员
    participant OldMaster as 旧 Master
    participant OldWorker as 旧 Worker
    participant NewMaster as 新 Master
    participant NewWorker as 新 Worker
    Admin->> OldMaster: 发送 SIGUSR2 信号
    OldMaster->> OldMaster: 重命名 pid 文件
    OldMaster->> NewMaster: fork + exec 新二进制
    Note over NewMaster: 继承监听套接字
    NewMaster->> NewMaster: 解析配置
    NewMaster->> NewWorker: 启动新 Worker
    Admin->> OldMaster: 发送 SIGQUIT 信号
    OldMaster->> OldWorker: 发送 SIGQUIT
    OldWorker->> OldWorker: 完成请求后退出
    Note over OldMaster: 等待所有旧 Worker 退出
    OldMaster->> OldMaster: 退出

{% endmermaid %}

当执行 `nginx -s reload` 时，命令行参数 `-s` 被解析为信号处理模式。

核心代码包括 **信号处理表**、**Master 进程信号处理**、**Master 进程主循环处理**

```c
// src/os/unix/ngx_process.c
ngx_signal_t  signals[] = {
    { ngx_signal_value(NGX_RECONFIGURE_SIGNAL),
      "SIG" ngx_value(NGX_RECONFIGURE_SIGNAL),
      "reload",
      ngx_signal_handler },
    // ...
    { ngx_signal_value(NGX_CHANGEBIN_SIGNAL),
      "SIG" ngx_value(NGX_CHANGEBIN_SIGNAL),
      "",
      ngx_signal_handler },
    // ...
};


// src/os/unix/ngx_process.c
case ngx_signal_value(NGX_CHANGEBIN_SIGNAL):
    if (ngx_getppid() == ngx_parent || ngx_new_binary > 0) {

        /*
         * Ignore the signal in the new binary if its parent is
         * not changed, i.e. the old binary's process is still
         * running.  Or ignore the signal in the old binary's
         * process if the new binary's process is already running.
         */

        action = ", ignoring";
        ignore = 1;
        break;
    }

    ngx_change_binary = 1;
    action = ", changing binary";
    break;


// src/os/unix/ngx_process_cycle.c
if (ngx_change_binary) {
    ngx_change_binary = 0;
    ngx_log_error(NGX_LOG_NOTICE, cycle->log, 0, "changing binary");
    ngx_new_binary = ngx_exec_new_binary(cycle, ngx_argv);
}
```

启动新的二进制进程是平滑升级的核心函数，关键步骤包括

1. **传递监听套接字**：通过环境变量 `NGINX_VAR` 将所有监听套接字的文件描述符传递给新进程
2. **PID 文件重命名**：将 `nginx.pid` 重命名为 `nginx.pid.oldbin`
3. **执行新二进制** 文件：通过 `fork + exec` 启动新版本

核心代码如下

```c
// src/core/nginx.c
p = ngx_cpymem(var, NGINX_VAR "=", sizeof(NGINX_VAR));

ls = cycle->listening.elts;
for (i = 0; i < cycle->listening.nelts; i++) {
    if (ls[i].ignore) {
        continue;
    }
    p = ngx_sprintf(p, "%ud;", ls[i].fd);
}

// ...

ngx_rename_file(ccf->pid.data, ccf->oldpid.data);

// ...

pid = ngx_execute(cycle, &ctx);
```

然后新进程继承套接字

```c
// src/core/nginx.c
static ngx_int_t
ngx_add_inherited_sockets(ngx_cycle_t *cycle)
{
	// ...

    inherited = (u_char *) getenv(NGINX_VAR);  // 从环境变量获取继承的套接字

    if (inherited == NULL) {
        return NGX_OK;
    }

    // ...

	// 解析并添加继承的套接字
    for (p = inherited, v = p; *p; p++) {
        if (*p == ':' || *p == ';') {
            s = ngx_atoi(v, p - v);

            // ...

            ls->fd = (ngx_socket_t) s;
            ls->inherited = 1;
        }
    }

	// ...

    ngx_inherited = 1;

    return ngx_set_inherited_sockets(cycle);
}
```

对于 `nginx -s reload` 配置重载，流程略有不同

{% mermaid %}

flowchart TD
    A[nginx -s reload] --> B[发送 SIGHUP 信号]
    B --> C[Master 进程接收]
    C --> D[ngx_reconfigure = 1]
    D --> E[重新解析配置文件]
    E --> F[启动新 Worker 进程]
    F --> G[向旧 Worker 发送 SIGQUIT]
    G --> H[旧 Worker 优雅关闭]

{% endmermaid %}

核心代码包括

```c
// src/os/unix/ngx_process_cycle.c
if (ngx_reconfigure) {
    ngx_reconfigure = 0;

    if (ngx_new_binary) {
        ngx_start_worker_processes(cycle, ccf->worker_processes,
                                   NGX_PROCESS_RESPAWN);
        ngx_start_cache_manager_processes(cycle, 0);
        ngx_noaccepting = 0;

        continue;
    }

    ngx_log_error(NGX_LOG_NOTICE, cycle->log, 0, "reconfiguring");

    cycle = ngx_init_cycle(cycle);
    if (cycle == NULL) {
        cycle = (ngx_cycle_t *) ngx_cycle;
        continue;
    }

    ngx_cycle = cycle;
    ccf = (ngx_core_conf_t *) ngx_get_conf(cycle->conf_ctx,
                                           ngx_core_module);
    ngx_start_worker_processes(cycle, ccf->worker_processes,
                               NGX_PROCESS_JUST_RESPAWN);
    ngx_start_cache_manager_processes(cycle, 1);

    /* allow new processes to start */
    ngx_msleep(100);

    live = 1;
    ngx_signal_worker_processes(cycle,
                                ngx_signal_value(NGX_SHUTDOWN_SIGNAL));
}
```

## 参考资料

- [Nginx 文档](https://nginx.ac.cn/en/docs/index.html)

- [Nginx 教程](https://nginx.mosong.cc/)

- [Nginx 开发从入门到精通](https://tengine.taobao.org/book/)

- [Nginx 源码分析](https://blog.csdn.net/initphp/category_9265172.html)

- [深入剖析 Nginx 内存池：从设计原理到源码实现](https://zhuanlan.zhihu.com/p/1939418325768713968)
