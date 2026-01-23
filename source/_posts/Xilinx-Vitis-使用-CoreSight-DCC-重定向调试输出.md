---
title: Xilinx Vitis 使用 CoreSight DCC 重定向调试输出
tags:
  - Xilinx
  - ARM Coresight
  - UART
categories: 工具
mathjax: true
abbrlink: e8e8088c
date: 2026-04-17 15:53:39
---

> 硬件平台：Zynq-7000
>
> 软件工具：Xilinx Vitis Classic 2024.1

## 原理

在使用 Xilinx Vitis 软件调试时，如果存在 UART 引脚被占用的情况，可以将 BSP Settigns 中的 `stdin` 和 `stdout` 修改为 `ps_coresight_comp_0`，将输入输出重定向到 ARM 的 CoreSight 调试/跟踪组件，此时日志与调试不再依赖 UART，而是通过 JTAG 调试接口直接上传到 Vitis XSCT 中。

```shell
┌─────────────────┐  JTAG   ┌─────────┐
│   ARM Cortex-A9 │◄──────► │  XSCT   │
│  ┌───────────┐  │         │ Console │
│  │ DCC Reg   │  │         └─────────┘
│  └───────────┘  │
│       ▲         │
│       │         │
│  0xF8800000     │
└─────────────────┘
```

修改配置前后 BSP 程序对比如下（正文中仅展示关键区别，详见附录）

```diff
// xparameters.h
- #define STDIN_BASEADDRESS 0xE0000000
- #define STDOUT_BASEADDRESS 0xE0000000
+ #define STDIN_BASEADDRESS 0xF8800000
+ #define STDOUT_BASEADDRESS 0xF8800000

// inbyte.c / outbyte.c
- #include "xuartps_hw.h"
+ #include "xcoresightpsdcc.h"

- return XUartPs_RecvByte(STDIN_BASEADDRESS);
+ return XCoresightPs_DccRecvByte(STDIN_BASEADDRESS);

- XUartPs_SendByte(STDOUT_BASEADDRESS, c);
+ XCoresightPs_DccSendByte(STDOUT_BASEADDRESS, c);
```

> 点击 👇 查看上述函数实现源代码
>
> [XUartPs_SendByte, XUartPs_RecvByte](https://github.com/Xilinx/embeddedsw/blob/master/XilinxProcessorIPLib/drivers/uartps/src/xuartps_hw.c)
>
> [XCoresightPs_DccSendByte, XCoresightPs_DccRecvByte](https://github.com/Xilinx/embeddedsw/blob/master/XilinxProcessorIPLib/drivers/coresightps_dcc/src/xcoresightpsdcc.c)

追踪其源代码实现可以发现

- `XUartPs_SendByte`：利用 [PS 端的 UART IP](https://euler0525.github.io/wiki/xilinx/zynq/#block-design)，数据写入 TX_FIFO ，然后由硬件按照既定波特率将 FIFO 数据串行输出到 TX 引脚，发送速率小于波特率，FIFO 有空闲，不会陷入阻塞；
- `XCoresightPs_DccSendByte`：基于 ARM 架构的 **Debug Communication Channel (DCC)**，数据写入一个 32 位寄存器，然后调试器实时捕获 DCC 数据并显示在 XSCT 控制台。如果没有调试器连接，DCC 寄存器上一 32 位数据不会被取出，CPU 无法写入下一字节。

⚠️ 注意：`XCoresightPs_DccSendByte` 函数会调用 `XCoresightPs_DccGetStatus` 函数轮询 DCC 状态位，如果未读取到状态，将返回默认状态值 `0`，导致发送函数将陷入无限等待（没有超时保护，这合理嘛？），程序阻塞，无法继续运行！

因此为了确保程序脱离调试器仍可以运行，固化前需要切换到 `ps_uart_0` 配置！

## 总结

两种调试方案对比如下表

|            |      UART 方案       |      Coresight DCC 方案      |
| :--------: | :------------------: | :--------------------------: |
| 驱动头文件 |    `xuartps_hw.h`    |     `xcoresightpsdcc.h`      |
|   基地址   |     `0xE0000000`     |         `0xF8800000`         |
|  发送函数  | `XUartPs_SendByte()` | `XCoresightPs_DccSendByte()` |
|  接收函数  | `XUartPs_RecvByte()` | `XCoresightPs_DccRecvByte()` |
|  传输介质  |    物理 UART 引脚    |        JTAG 调试接口         |
|  是否阻塞  |      FIFO 缓冲       |    ⚠️ **无超时，严格阻塞**    |
| 脱离调试器 |      可独立运行      |      ⚠️ **强依赖调试器**      |

## 参考资料

[Xilinx Processor IP Lib](https://github.com/Xilinx/embeddedsw/tree/master/XilinxProcessorIPLib/drivers)

## 附录

### 配置修改前后 BSP 程序对比

```diff
// <platform>/ps7_cortexa9_0/freertos10_xilinx_domain/bsp/ps7_cortexa9_0/include/xparameters.h
- #define STDIN_BASEADDRESS 0xE0000000
- #define STDOUT_BASEADDRESS 0xE0000000
+#define STDIN_BASEADDRESS 0xF8800000
+#define STDOUT_BASEADDRESS 0xF8800000

// <platform>/ps7_cortexa9_0/freertos10_xilinx_domain/bsp/ps7_cortexa9_0/libsrc/freertos10_xilinx_v1_15/src/inbyte.c
 #include "xparameters.h"
-#include "xuartps_hw.h"
+#include "xcoresightpsdcc.h"

 #ifdef __cplusplus
 extern "C" {
 #endif
 char inbyte(void);
 #ifdef __cplusplus
 }
 #endif 

 char inbyte(void) {
-    return XUartPs_RecvByte(STDIN_BASEADDRESS);
+    return XCoresightPs_DccRecvByte(STDIN_BASEADDRESS);
 }

// <platform>/ps7_cortexa9_0/freertos10_xilinx_domain/bsp/ps7_cortexa9_0/libsrc/freertos10_xilinx_v1_15/src/outbyte.c
 #include "xparameters.h"
-#include "xuartps_hw.h"
+#include "xcoresightpsdcc.h"

 #ifdef __cplusplus
 extern "C" {
 #endif
 void outbyte(char c); 

 #ifdef __cplusplus
 }
 #endif 

 void outbyte(char c) {
-    XUartPs_SendByte(STDOUT_BASEADDRESS, c);
+    XCoresightPs_DccSendByte(STDOUT_BASEADDRESS, c);
 }
```
