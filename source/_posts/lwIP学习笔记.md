---
title: lwIP 学习笔记
description: '记录 lwIP 协议栈学习过程，重点整理动态堆内存、内存池等内存管理机制以及相关参考资料。'
tags:
  - 内存管理
categories: 嵌入式
mathjax: true
abbrlink: 7e1144e5
date: 2026-06-29 17:04:03
---

## 内存管理

lwIP 的内存管理主要提供两种方式：

1. **动态堆分配 (`mem`)**：类似标准库的 `malloc/free`，用于分配大小不固定的内存（如应用层发送的数据载荷）。
2. **内存池分配 (`memp`)**：用于分配固定大小的对象（如协议控制块 PCB、pbuf 头等），**分配速度极快且不会产生内存碎片**。

> 在嵌入式系统中，动态堆容易产生碎片且分配时间不确定。因此，lwIP 内部协议栈的控制结构几乎全部采用 **内存池 (`memp`)** 管理，而将 **动态堆 (`mem`)** 留给用户数据或特殊场景使用。

### 动态堆内存管理

利用宏定义配置，该模块支持三种内存分配方式：

- **lwIP 内置堆分配器（默认）**：基于双向链表和数组索引实现；
- **`MEM_LIBC_MALLOC`**：使用标准 C 库的 `malloc/free/calloc`（需操作系统支持堆管理）；
- **`MEM_CUSTOM_ALLOCATOR`**：使用用户自定义的分配器宏；

```c
#define MEM_CUSTOM_FREE                 free
#define MEM_CUSTOM_MALLOC               malloc
#define MEM_CUSTOM_CALLOC               calloc
```

如果启用默认的 lwIP 内置堆，其核心是一个双向链表

```c
/**
 * The heap is made up as a list of structs of this type.
 * This does not have to be aligned since for getting its size,
 * we only use the macro SIZEOF_STRUCT_MEM, which automatically aligns.
 */
struct mem {
    /** index (-> ram [next]) of the next struct */
    mem_size_t next;
    /** index (-> ram [prev]) of the previous struct */
    mem_size_t prev;
    /** 1: this area is used; 0: this area is unused */
    u8_t used;
#if MEM_OVERFLOW_CHECK
    /** this keeps track of the user allocation size for guard checks */
    mem_size_t user_size;
#endif
};
```

|    字段     | 含义                           |
| :---------: | :----------------------------- |
|   `next`    | 下一个内存块在 heap 中的偏移   |
|   `prev`    | 上一个内存块在 heap 中的偏移   |
|   `used`    | 当前块是否已使用               |
| `user_size` | 用户实际申请大小，用于溢出检测 |

链表中不使用指针，而是使用数组索引，方便通过数组直接定位任意节点。整个堆是一块连续的大数组 `ram_heap[]`

```c
/** If you want to relocate the heap to external memory, simply define
 * LWIP_RAM_HEAP_POINTER as a void-pointer to that location.
 * If so, make sure the memory at that location is big enough (see below on
 * how that space is calculated). */
#ifndef LWIP_RAM_HEAP_POINTER
/** the heap. we need one struct mem at the end and some room for alignment */
LWIP_DECLARE_MEMORY_ALIGNED(ram_heap, MEM_SIZE_ALIGNED + (2U * SIZEOF_STRUCT_MEM));
#define LWIP_RAM_HEAP_POINTER ram_heap
#endif /* LWIP_RAM_HEAP_POINTER */
```

#### 初始化

初始化阶段 `mem_init` 执行以下操作，

1. 检查 `struct mem` 大小是否满足 `MEM_ALIGNMENT` 对齐
2. 对齐 heap 起始地址
3. 初始化第一个空闲块
4. 初始化末尾 **哨兵块**
5. 设置 `lfree` 指向起始空闲块
6. 初始化内存统计
7. 创建互斥锁，保护多线程并发访问

|   变量    | 含义                               |
| :-------: | :--------------------------------- |
|   `ram`   | heap 起始地址，对齐后的地址        |
| `ram_end` | heap 末尾的哨兵块                  |
|  `lfree`  | 当前最低地址的空闲块，用于加速搜索 |

初始化完成后，堆结构如图所示

```shell
ram
 |
 v
 +--------------------------+------------------+
 | struct mem, used = 0     | free memory      |
 +--------------------------+------------------+
                                     |
                                     v
                            +------------------+
                            | ram_end sentinel |
                            +------------------+
```

#### 内存分配与释放

- **分配 (`mem_malloc`)**：
    1. 将请求大小对齐到 `MEM_ALIGNMENT`。
    2. 若小于 `MIN_SIZE_ALIGNED`（默认 12 字节），则提升到最小尺寸。
    3. 从 `lfree` 开始遍历链表，寻找第一个足够大的空闲块（**首次适应算法**）。
    4. **分割**：如果空闲块足够大（能再放一个 `struct mem + MIN_SIZE_ALIGNED`），则切出所需大小，剩余部分成为新的空闲块；否则将整个空闲块分配（产生内部碎片）。
    5. 更新 `lfree` 指向下一个空闲块。
- **释放与合并 (`mem_free` & `plug_holes`)**：
    释放一个块后，调用 `plug_holes()` 尝试将其和前后相邻的空闲块 **合并**，以减少内存碎片。
- **收缩 (`mem_trim`)**：
    用于缩小已分配内存块的大小。如果缩小后释放的空间足够大，则将其切分并归还给空闲链表。

#### 其它函数

- 指针与数组偏移量转换

```c
static struct mem *ptr_to_mem(mem_size_t ptr) {
    return (struct mem *)(void *)&ram[ptr];
}

static mem_size_t mem_to_ptr(void *mem) {
    return (mem_size_t)((u8_t *)mem - ram);
}
```

### 内存池管理

上一节中的动态堆分配频繁地分配/释放内存会导致内存碎片，而且每个块需要 `struct mem` 头，开销较大；对于 lwIP 内部大量使用的固定大小对象，例如 `struct tcp_pcb, struct pbuf, struct udp_pcb` 等，内存池是更好的选择。

```c
#define LWIP_MEMPOOL(name, num, size, desc) LWIP_MEMPOOL_DECLARE(name, num, size, desc)
#include "lwip/priv/memp_std.h"
```

lwIP 在 `include/lwip/priv/memp_std.h` 中声明所有内部池，形如

```c
LWIP_MEMPOOL(TCP_PCB, MEMP_NUM_TCP_PCB, sizeof(struct tcp_pcb), "TCP_PCB")
```

内存池描述符数组用户保存所有内置内存池的描述符

```c
const struct memp_desc *const memp_pools[MEMP_MAX] = {
#define LWIP_MEMPOOL(name, num, size, desc) &memp_##name,
#include "lwip/priv/memp_std.h"
};
```

每个 `memp_desc` 包含

```c
/** Memory pool descriptor */
struct memp_desc {
#if defined(LWIP_DEBUG) || MEMP_OVERFLOW_CHECK || LWIP_STATS_DISPLAY
  /** Textual description */
  const char *desc;
#endif /* LWIP_DEBUG || MEMP_OVERFLOW_CHECK || LWIP_STATS_DISPLAY */
#if MEMP_STATS
  /** Statistics */
  struct stats_mem *stats;
#endif

  /** Element size */
  u16_t size;

#if !MEMP_MEM_MALLOC
  /** Number of elements */
  u16_t num;

  /** Base address */
  u8_t *base;

  /** First free element of each pool. Elements form a linked list. */
  struct memp **tab;
#endif /* MEMP_MEM_MALLOC */
};
```

#### 初始化

|        函数        | 作用                                     |
| :----------------: | :--------------------------------------- |
|  `memp_init_pool`  | 初始化一个指定内存池                     |
|    `memp_init`     | 初始化 lwIP 所有内置内存池               |

初始化单个内存池后

```shell
tab ──► [memp]──► [memp]──► [memp]──► [memp]──► NULL
         │         │         │         │
         ▼         ▼         ▼         ▼
       [数据区]  [数据区]  [数据区]  [数据区]
```

lwIP 启动时会调用 `memp_init`，`mem_init` 会遍历所有内存池，并逐个调用 `memp_init_pool`。

#### 内存分配

|        函数        | 作用                                     |
| :----------------: | :--------------------------------------- |
| `memp_malloc_pool` | 从自定义内存池申请一个元素               |
|   `memp_malloc`    | 从指定类型的 lwIP 内置内存池申请一个元素 |

调用内部函数 `memp = do_memp_malloc_pool(memp_pools[type]);`，从空闲链表头取出一个元素，然后将链表头移动到下一个元素，然后返回用户区地址。

#### 内存释放

|        函数        | 作用                                     |
| :----------------: | :--------------------------------------- |
|  `memp_free_pool`  | 释放元素到自定义内存池                   |
|    `memp_free`     | 释放元素到指定类型的 lwIP 内置内存池     |

## 参考资料

[GitHub｜lwip-tcpip/lwip/src/core](https://github.com/lwip-tcpip/lwip/tree/master/src/core)

