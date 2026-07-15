---
title: Xilinx Embedded Software 学习笔记
description: '整理 Xilinx SoC 裸机与 RTOS 软件示例，重点分析内存测试流程、Zynq DRAM 读写测试及眼图测试方法。'
tags:
  - Xilinx
categories: 嵌入式
abbrlink: 7622f45b
date: 2026-05-21 20:06:48
---

`sw_app` 目录中的程序由 Vitis/XSCT 工具进行构建和管理，包含适用于 Xilinx SoC 平台的裸核和 RTOS 示例。

通用目录结构如下

```shell
<app_name>/
  data/
    <app_name>.tcl       # HSI/Vitis metadata: supported processors, OS, hw requirements
    <app_name>.yaml      # Machine-readable metadata: dependencies, supported targets
    <app_name>.mss       # (some apps) Software stack description
  src/
    CMakeLists.txt       # Build definition (CMake-based, driven by XSCT)
    *.c / *.h / *.S      # Source code
    lscript.ld           # Linker script (most apps)
    UserConfig.cmake     # User build customization hooks
    platform_config.h.in # (some apps) Template for platform-specific config
```

## Memory Tests

这一部分程序的作用是测试所有可读写内存区域，包括 OCM，BRAM 等。

```shell
.
├── data
│   ├── memory_tests.tcl
│   └── memory_tests.yaml     # 本程序运行的最低内存要求: OCM >= 64KB 或 BRAM >= 8KB
└── src
    ├── CMakeLists.txt
    ├── memory_config.h
    ├── memory_config_g.c.in
    ├── memorytest.c
    ├── platform.c
    ├── platform.h
    └── platform_config.h
```

- `memory_config.h` 程序中定义了结构体，与 `lscripts.ld` 中的 `Available Memory Regions` 表头对应。

```c
struct memory_range_s {
	char8 *name;   // 内存区域的名称
	char8 *ip;     // 内存控制 IP 名称
	UINTPTR base;  // 基地址
	u64 size;      // 区域大小（字节）
};
```

- `memory_config_g.c` 文件根据模板文件 `memory_config_g.c.in` 构建，具体作用是替换占位符 `@MEMNODES@` 为具体可读写的内存区域，作为数组 `memory_ranges` 的逐个元素；替换占位符 `@NUM_MEM_RANGES@` 为内存区域的数量。

- `platform.c` 程序中包含平台初始化与清理函数，初始化时仅启用 I-Cache，针对 ARM 处理器会禁用 D-Cache 数据缓存，因为内存测试必须让数据写到外部存储器。

- `memorytest.c` 程序中包含 `main()` 函数和测试逻辑：遍历所有 `n_memory_ranges` 逐个调用测试函数 `test_memory_range`。

    1. 打印本次测试的内存区域名称、控制器 IP 名、基地址和区域大小

    2. 将内存按照 $4KB$ 分块，[`Xil_TestMem32`](https://github.com/Xilinx/embeddedsw/blob/master/lib/bsp/standalone/src/common/xil_testmem.c) 逐块做 32 位读写测试（可选：16 位或 8 位压力测试）

*注：测试程序中使用 print 打印，而不是 printf，因为 printf 会在堆上动态分配内存，而此时 heap = 0.*

---

- `memory_tests.tcl` 脚本

|               函数               | 作用                                                                    |
| :------------------------------: | :--------------------------------------------------------------------- |
|         `swapp_get_name`         | 返回应用名称 `Memory Tests`                                             |
|     `swapp_get_description`      | 返回描述信息                                                            |
|     `swapp_is_supported_hw`      | 检查硬件兼容性：必须有 UART 外设，必须有足够大的 BRAM/OCM                  |
|     `swapp_is_supported_sw`      | 检查软件兼容性：必须是 standalone OS，必须设置 stdout                     |
|         `swapp_generate`         | 生成 `platform_config.h`（UART 配置）和 `memory_config_g.c`（内存范围表） |
|  `swapp_get_linker_constraints`  | 返回链接约束：代码/数据存放位置，堆大小为 0                                |
| `swapp_get_supported_processors` | 返回支持的处理器列表                                                     |
|     `swapp_get_supported_os`     | 返回 `standalone`                                                       |

另外，`generate_memory_config` 函数的作用包括

- 遍历所有数据内存范围，排除以下区域：
    - 只读内存
    - 与安全状态不匹配的内存
    - 程序代码/数据所在的内存（避免测试时覆盖自身）
    - Flash 存储器（通过 EMC IP 类型检测）
    - DDR 控制器本身（ps7_ddrc）、QSPI、NAND、NOR 等非易失性存储
    - TCM（紧耦合内存）、OCM、PMU RAM 等片上特殊内存
    - AArch32 模式下地址超过 32 位的区域

- MicroBlaze 特殊处理：基地址为 0 的内存跳过前 0x50 字节（向量表区域）。

最终生成合法的内存范围数组。

> [`Xil_TestMem32`](https://github.com/Xilinx/embeddedsw/blob/master/lib/bsp/standalone/src/common/xil_testmem.c) 测试
>
> 函数根据 `Subtest` 参数最多可以执行 5 种测试，分别为
>
> - 向内存连续写入累加数然后从头读取，检查读出的值与预期递增的值是否一致，用于检测基本的读写功能；
> - 写入的数据只有 1 个 bit 是 1, 其余是 0，例如 `0x0000_0001, 0x0000_0002,...`，一直左移循环 32 次，用于检测数据线之间是否存在邻位干扰、短路或断路；
> - 写入的数据只有 1 个 bit 是 0, 其余是 1，同样用于检测数据线，确保高低电平转换没有故障；
> - 将当前内存的地址取反后的值写入该地址，读取时，再次计算地址的取反值进行对比，用于检测地址线与地址译码逻辑；
> - 将整个内存块填满 `0xDEADBEEF`，然后回读校验，快速完成大面积的完整性校验，用于验证内存控制器配置；
>

## Zynq DRAM tests

该测试程序在 OCM 上运行，通过 UART 交互操作，用于测试 PS DDR，用户可以选择以下三种测试模式

- Memory test

- Read eye measurement

- Write eye measurement

```shell
.
├── data
│   ├── zynq_dram_test.tcl
│   └── zynq_dram_test.yaml
└── src
    ├── CMakeLists.txt
    ├── ZYNQ_DRAM_DIAGNOSTICS_TEST.docx
    ├── lscript.ld
    ├── test01.c
    ├── testDefines.h
    └── translation_table.s
```

- `translation_table.s`：ARM MMU 页表（Section 描述符）

|       地址范围         | 大小  |               属性                |           用途             |
| :-------------------: | :---: | :-------------------------------: | :-----------------------: |
| 0x00000000–0x3FFFFFFF |  1GB  | Inner/Outer Write-Back, Cacheable |       DDR（可缓存）        |
| 0x40000000–0x7FFFFFFF |  1GB  |         Shareable Device          |       FPGA Slave 0        |
| 0x80000000–0xBFFFFFFF |  1GB  |         Shareable Device          |       FPGA Slave 1        |
| 0xC0000000–0xDFFFFFFF | 512MB |         Translation Fault         |           保留            |
| 0xE0000000–0xE1FFFFFF | 32MB  |         Shareable Device          | IO 外设（UART/USB/SPI 等） |
| 0xE2000000–0xE3FFFFFF | 32MB  |         Shareable Device          |            NOR            |
| 0xE4000000–0xE5FFFFFF | 32MB  |             Cacheable             |           SRAM            |
| 0xE6000000–0xF7FFFFFF | 288MB |         Translation Fault         |           保留            |
| 0xF8000000–0xF8FFFFFF | 16MB  |         Shareable Device          |       AMBA APB 外设       |
| 0xF9000000–0xFBFFFFFF | 48MB  |         Translation Fault         |           保留            |
| 0xFC000000–0xFFEFFFFF | ~63MB |             Cacheable             |         QSPI XIP          |
| 0xFFF00000–0xFFFFFFFF |  1MB  |       Shareable, Cacheable        |     OCM（高地址映射）      |

- `testDefines.h`：定义了 Zynq-7000 SoC 的所有主要外设基地址和偏移量：

    - L2 Cache Controller：0xF8F02000 基地址的各控制/状态寄存器偏移

    - SCU (Snoop Control Unit)：0xFEF00000 基地址

    - 全局定时器：0xF8F00200 区域

    - 系统级寄存器：OCM、DMAC、DDR、TTC、SWDT、EFUSE 等基地址

    - IO 外设：UART、USB、I2C、SPI、CAN、GPIO、ETH、QSPI、SDIO 等基地址

    - Fabric 接口：0x40000000 和 0x80000000 基地址

    - CoreSight 调试： 0xF8800000 区域的 DAPROM、ETB、TPIU、PTM 等

    - SLCR 寄存器偏移：PLL 控制、时钟控制、复位控制、TrustZone、DDR 控制、MIO 引脚配置（0–53 号引脚）
- `lscript.ld`：定义了两个内存区域：
    - `ps7_ram_0`（0x00000000，192KB）放置 `.text`、`.rodata`、`.data`、`.bss`、`.mmu_tbl`、堆（默认 8KB ）

    - `ps7_ram_1`（0xFFFF0000，65024B）放置所有栈：主栈（24KB）、IRQ
    栈（24KB）、Supervisor（2KB）、Abort（1KB）、FIQ（1KB）等

该程序用于测试 DDR，为了不干扰程序运行，上述内容全部放置在 OCM 中。

---

`test01.c` 作为测试主程序，具体具有以下功能

- 寄存器访问宏：不经过任何驱动抽象，直接访问内存地址

```shell
// Macros
#define REG_READ(addr) \
	({int val;int a=addr; __asm volatile ("ldr   %0,[%1]\n" : "=r"(val) : "r"(a)); val;})

#define REG_WRITE(addr, val) \
	({int v = val; int a = addr; __asm volatile ("str  %1,[%0]\n" :: "r"(a),"r"(v)); v;})
```

- DDR 控制器与 IO Buffer 初始化

```shell
ddrc_reg_values[160]      存储 DDR Controller 的寄存器配置，地址范围 0xF8006000–0xF80062B4
ddriob_reg_values[30]     存储 DDR IO Buffer 的寄存器配置，地址范围 0xF8000B40–0xF8000B70
ddrc_init()               按上述表依次写入所有 DDRC 寄存器
ddrc_get() / ddriob_get() 从硬件读回当前寄存器值，存入表中
```

- Cache 管理例程

```shell
L1DCacheInvalidate() 按 set/way 逐行失效 L1 数据 cache
L1DCacheFlush()      按 set/way 逐行清写 L1 数据 cache
L2CacheInvalidate()  通过 L2CC 的 invalidate way 寄存器失效 L2
L2CacheFlush()       通过 L2CC 的 clean+invalidate way 寄存器清写 L2
DCacheInvalidate()   组合调用：先 flush L1 + L2，确保 DRAM 中数据一致性
```

这些函数在写完 DRAM 后、读回验证前被调用，避免 Cache 中的脏数据掩盖真实的 DRAM 错误。

### 内存测试核心流程

通用流程为 **写入 DDR → Cache 刷写/失效 → 读回比较 → 统计错误**

```shell
  ┌──────────────────────────────────────────────────────────┐
  │                    memtest_all() 调度器                  │
  │  sel 位掩码选择 1~15 种子测试，依次执行                    │
  ├──────────────────────────────────────────────────────────┤
  │                                                          │
  │  ┌─── 子测试循环 (mode 0~14) ──────────────────────────┐  │
  │  │                                                    │  │
  │  │  1. 写入阶段                                        │  │
  │  │     根据 mode 生成测试数据（固定值/地址/LFSR/模式表） │  │
  │  │     逐字写入 DDR: REG_WRITE(addr, data)             │  │
  │  │                                                    │  │
  │  │  2. 刷 Cache                                       │  │
  │  │     DCacheInvalidate()                             │  │
  │  │     = L1 Flush + L2 Flush                          │  │
  │  │     强制脏数据从 Cache 写入物理 DRAM                 │  │
  │  │                                                    │  │
  │  │  3. 读取阶段                                        │  │
  │  │     重新生成期望数据                                 │  │
  │  │     逐字读回: data = REG_READ(addr)                 │  │
  │  │                                                    │  │
  │  │  4. 比较与统计                                      │  │
  │  │     data != ref → 错误                             │  │
  │  │     按4个字节通道独立计数 (byte0/1/2/3)              │  │
  │  │     记录前80个错误的 (地址, 写值, 读值)               │  │
  │  │     所有通道错误>1000 → 提前终止                     │  │
  │  │                                                    │  │
  │  └────────────────────────────────────────────────────┘  │
  │                                                          │
  │  汇总：errcnt[4] + werr + epp + test_time                │
  │  通过 UART 打印                                          │
  └─────────────────────────────────────────────────────────┘
```

- **Mode 0**：`Data = Address`（地址线测试，查短路/断路）
- **Mode 1-4**：全 `0`、全 `F`、`0xAAAA...`、`0x5555...`（测试固定电平保持能力）
- **Mode 5-8**：棋盘格 pattern（测试相邻位干扰、串扰）
- **Mode 9-10**：128-word 复杂翻转 pattern（模拟最恶劣的 SSN 同步开关噪声）
- **Mode 11-14**：`LFSR` 伪随机序列（模拟真实业务的数据随机性）

### 眼图测试

- **写眼图扫描 (`measure_write_eye`)**： 修改 `R046` (wr_data_offset) 和 `R05F` (wr_data_slave_ratio)。 从中心点向两边步进，每修改一次延迟，就运行一次 `memtest`。当错误数 `errcnt` 从 $0$ 变成 $> 0$ 时，就找到了眼图的 **左边界 (mineye)** 和 **右边界 (maxeye)**。

- **读眼图扫描 (`measure_read_eye`)**： 关闭 DDRC 的自动读训练功能，手动修改 `R050` (rd_dqs_slave_ratio) 和 `R05A` (fifo_we_slave_ratio)，同样通过报错边界来描绘读眼图。

- **眼图质量评估 (`find_best_eye`)**： 计算 4 个 Byte Lane 的眼图宽度总和与方差，挑选出最宽、最对称的最佳延迟中心点。

## 参考资料

[GitHub | Xilinx/embeddedsw](https://github.com/Xilinx/embeddedsw/tree/master/lib/sw_apps)

[DeepWiki | Xilinx/embeddedsw](https://deepwiki.com/Xilinx/embeddedsw)
