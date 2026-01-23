---
title: FreeRTOS堆内存管理
tags:
  - 内存
  - 堆栈
  - FreeRTOS
categories: 嵌入式
mathjax: true
abbrlink: 31ef8db8
date: 2026-02-25 20:35:25
---

## 内存分配

> [FreeRTOS-Kernel/portable/MemMang](https://github.com/FreeRTOS/FreeRTOS-Kernel/tree/main/portable/MemMang)

这一部分主要关注的是 FreeRTOS 在申请内存时，调度器挂起到恢复调度器之间的代码。

```c
vTaskSuspendAll();
{
    // 核心代码
}
( void ) xTaskResumeAll();
```

### heap_1.c

> heap_1 仅支持分配内存块，但是不支持释放。

在 [heap_1.c](https://github.com/FreeRTOS/FreeRTOS-Kernel/blob/main/portable/MemMang/heap_1.c) 中，下面这段程序的目的是确保 `pucAlignedHeap` 指向的地址是 `portBYTE_ALIGNMENT` 的倍数（例如 8 字节对齐），`pucAlignedHeap` 作为申请空间的逻辑起点，在首次调用 `pvPortMalloc` 时计算，之后固定不变！

```c
/* Ensure the heap starts on a correctly aligned boundary. */
pucAlignedHeap = ( uint8_t * )
(
    ( 
        (portPOINTER_SIZE_TYPE) &(ucHeap[ portBYTE_ALIGNMENT - 1]) 
    )
    & 
    (
        ~((portPOINTER_SIZE_TYPE) portBYTE_ALIGNMENT_MASK) 
    ) 
);
```

其中

- `portPOINTER_SIZE_TYPE` 表示一个与指针宽度相同的无符号整数类型，例如 32 位系统中表示 `uint32_t`，用于避免溢出或精度丢失；
- `ucHeap` 是一个大数组，是内存池的原始存储区域；
- `portBYTE_ALIGNMENT` 表示目标对齐字节数，例如 8 字节对齐；
- `portBYTE_ALIGNMENT_MASK` 定义为 `portBYTE_ALIGNMENT - 1`，用于位运算；

这段程序实现的是 **向上对齐**，计算公式为

$$
AlignedAddr = (BaseAddr + Alignment - 1) \& \sim (Alignment - 1)
$$

由于 $\& \sim (Alignment - 1)$ 的操作时消除低位，本质上是向下取整，则被按位与的地址只会变小或不变。而我们需要得到的是一个在 $BaseAddr$ 后面的地址，并且为了保证即使 $BaseAddr$ 刚好错过对齐点一个字节，加上偏移量之后也能跨过下一个对齐点，所以偏移量要能够覆盖所有未对齐情况的最大必要偏移量，即 $Alignment-1$。

```shell
地址空间：  0     8    16    24    32
          |-----|-----|-----|-----|
                  ^    ^
                  |    |
                  17   24
e.g. 17       & ~7 = 16, 地址回退
     (17 + 7) & ~7 = 24, 地址对齐
     16       & ~7 = 16, 原本地址对齐, 不浪费
```

---

内存布局如下图所示

```shell
pucAlignedHeap ──► [██████] [................]
                   ↑             ↑
                   │             └─ xNextFreeByte (下一个可分配位置)
                   └─ 已分配区域
```

在得到分配内存的逻辑起点之后，执行分配操作，即指针偏移

```shell
物理内存:  ucHeap[configTOTAL_HEAP_SIZE]
              │
              ▼ 对齐调整
逻辑起点:  pucAlignedHeap
              │ 
              ▼ 偏移量  xNextFreeByte
分配位置:  pucAlignedHeap + xNextFreeByte ─►  = pvReturn(函数pvPortMalloc返回值)
              │
              ▼ 分配后更新
新水位线:  xNextFreeByte += xWantedSize
```

### heap_2.c

> 相较于 heap_1，它允许释放先前分配的块。但是不合并相邻的空闲块，长期运行会导致内存碎片化。

下面这段代码使用 `xBlockSize` 的最高位(MSB) 作为分配状态标志位。如果单独分配一个布尔变量作为标志位，结构体大小增加，即每个内存块多占空间，并且破坏了内存对齐，引入填充字节会浪费更多空间。

```c
/* Define the linked list structure.  This is used to link free blocks in order
 * of their size. */
typedef struct A_BLOCK_LINK
{
    struct A_BLOCK_LINK * pxNextFreeBlock; /*<< The next free block in the list. */
    size_t xBlockSize;                     /*<< The size of the free block. */
} BlockLink_t;

/* MSB of the xBlockSize member of an BlockLink_t structure is used to track
 * the allocation status of a block.  When MSB of the xBlockSize member of
 * an BlockLink_t structure is set then the block belongs to the application.
 * When the bit is free the block is still part of the free heap space. 
 */
#define heapBLOCK_ALLOCATED_BITMASK
        (((size_t)1) << ((sizeof(size_t) * heapBITS_PER_BYTE) - 1))
#define heapBLOCK_SIZE_IS_VALID( xBlockSize )
        (((xBlockSize) & heapBLOCK_ALLOCATED_BITMASK) == 0)
#define heapBLOCK_IS_ALLOCATED( pxBlock )
        (((pxBlock->xBlockSize) & heapBLOCK_ALLOCATED_BITMASK) != 0)
#define heapALLOCATE_BLOCK( pxBlock )  
        ((pxBlock->xBlockSize) |= heapBLOCK_ALLOCATED_BITMASK)
#define heapFREE_BLOCK( pxBlock )
        ((pxBlock->xBlockSize) &= ~heapBLOCK_ALLOCATED_BITMASK)
```

以 32 位系统为例，掩码 `heapBLOCK_ALLOCATED_BITMASK` 为 `0x8000_0000`

```c
(((size_t)1) << ((sizeof(size_t) * heapBITS_PER_BYTE) - 1))
```

`heapBLOCK_SIZE_IS_VALID` 用于检测大小是否合法，确保申请的空间大小不会超过 31 位地址所包含的空间（即不会覆盖标志位）

#### 堆初始化 prvHeapInit

1. 对齐堆起始地址

2. 初始化哨兵节点 `xStart` 指向第一个空闲块
3. 初始化哨兵节点 `xEnd` 标记链表末尾
4. 创建第一个空闲块占用整个堆空间

经过初始化后，内存布局如下图所示

```shell
[ucHeap 起始]
├─ BlockLink_t (第一个空闲块头)
│  ├─ pxNextFreeBlock → &xEnd
│  └─ xBlockSize = 整个堆大小
├─ 用户可用内存区域 ...
└─ [ucHeap 末尾]
```

#### 内存分配 pvPortMalloc

计算分配空间大小并内存对齐，经过一系列检查之后，开始遍历空闲链表寻找合适内存块

```c
/* Blocks are stored in byte order - traverse the list from the start
 * (smallest) block until one of adequate size is found.
 */
pxPreviousBlock = &xStart;
pxBlock = xStart.pxNextFreeBlock;

while((pxBlock->xBlockSize < xWantedSize) && (pxBlock->pxNextFreeBlock != NULL)) {
    pxPreviousBlock = pxBlock;
    pxBlock = pxBlock->pxNextFreeBlock;
}
```

因为空闲块链表按大小排序，遍历从头部最小块开始，直到 **能容纳请求大小的最小块**，然后将其从空闲链表中移除。如果剩余空间大于最小块大小，需要分割，将剩余空间插回到空闲链表。

#### 内存释放 vPortFree

确认时已分配块，并且不在空闲链表中，然后清除分配标记并插入空闲链表。

### heap_3.c

> 简单封装了 `malloc()` 和 `free()` 函数。

### heap_4.c

> 相较于 `heap_2.c` 合并了相邻的空闲块，可以避免碎片化；并且补充了安全机制。

```c
/*
 * Inserts a block of memory that is being freed into the correct position in
 * the list of free memory blocks.  The block being freed will be merged with
 * the block in front it and/or the block behind it if the memory blocks are
 * adjacent to each other.
 */
static void prvInsertBlockIntoFreeList( BlockLink_t * pxBlockToInsert ) PRIVILEGED_FUNCTION;
```

在释放某个内存块后，`prvInsertBlockIntoFreeList` 函数按地址顺序插入空闲链表，与 `heap_2.c` 不同的是，该插入函数会分别尝试与前一个块和后一个块合并，从而减少内存碎片。

---

下面是 `heap_4.c` 中关 Canary 机制的代码。在初始化时生成随机的 canary 值，后续存储指针时做一次异或“加密”，读取指针时做一次异或“解密”。

```c
/* 
 * Setting configENABLE_HEAP_PROTECTOR to 1 enables heap block pointers
 * protection using an application supplied canary value to catch heap
 * corruption should a heap buffer overflow occur.
 */
#if (configENABLE_HEAP_PROTECTOR == 1)

/**
 * @brief Application provided function to get a random value to be used as canary.
 *
 * @param pxHeapCanary [out] Output parameter to return the canary value.
 */
    extern void vApplicationGetRandomHeapCanary(portPOINTER_SIZE_TYPE * pxHeapCanary);

/* Canary value for protecting internal heap pointers. */
    PRIVILEGED_DATA static portPOINTER_SIZE_TYPE xHeapCanary;

/* Macro to load/store BlockLink_t pointers to memory. By XORing the
 * pointers with a random canary value, heap overflows will result
 * in randomly unpredictable pointer values which will be caught by
 * heapVALIDATE_BLOCK_POINTER assert.
 */
    #define heapPROTECT_BLOCK_POINTER(pxBlock)
            ((BlockLink_t *) (((portPOINTER_SIZE_TYPE)(pxBlock)) ^ xHeapCanary))
#else
    #define heapPROTECT_BLOCK_POINTER(pxBlock) (pxBlock)
#endif /* configENABLE_HEAP_PROTECTOR */

/* Assert that a heap block pointer is within the heap bounds. */
#define heapVALIDATE_BLOCK_POINTER(pxBlock) 
        configASSERT(((uint8_t *) (pxBlock) >= &(ucHeap[0])) 
     && ((uint8_t *)(pxBlock) <= &(ucHeap[configTOTAL_HEAP_SIZE - 1])))


static void prvHeapInit( void ) /* PRIVILEGED_FUNCTION */
{
    // ...
    #if ( configENABLE_HEAP_PROTECTOR == 1 )
    {
        vApplicationGetRandomHeapCanary( &( xHeapCanary ) );
    }
    #endif
    // ...
}
```

### heap_5.c

> 相较于 `heap_4` 突破了单一连续内存的限制。

`heap_5` 通过每个区域末尾的 `pxEnd` 作为区域边界标记，同时用 `pxNextFreeBlock` 串联所有区域形成 **全局空闲链表**。应用前必须调用`vPortDefineHeapRegions()`函数！

## 参考资料

[FreeRTOS 堆内存管理](https://www.freertos.org/zh-cn-cmn-s/Documentation/02-Kernel/02-Kernel-features/09-Memory-management/01-Memory-management)
