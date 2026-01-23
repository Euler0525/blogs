---
title: JESD204B学习笔记
tags:
  - 串行接口
  - 接口协议
  - ADC
  - 德州仪器
categories: 接口
abbrlink: ec19dc81
date: 2026-04-13 16:36:40
---

## 简介

JESD204B 是在 FPGA 与 ADC 之间的串行接口，串行数据速率可达 $12.5Gbps$。相对于 LVDS，JESD204B 可以提供更高的带宽，更小的布局面积，更少的管脚以及更低的功耗。

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jeds204b_overview.webp" alt="JESD204B Link Data Flow and Protocol Layer Diagram" width="80%" />

<center> <small> JESD204B Link Data Flow and Protocol Layer Diagram (Subclass 1) </small> </center>

### 子类

根据是否以及如何实现时间参考对齐（作为确定性链路延迟的要求），将 JESD204B 分为三个子类

|                   |      Subclass 0       |            Subclass 1            |       Subclass 2       |
| :---------------: | :-------------------: | :------------------------------: | :--------------------: |
| 是否支持确定延迟  |          否           |                是                |     是（速度受限）     |
| 如何实现确定延迟  |          N/A          |              SYSREF              |         SYNC~          |
| 是否向后兼容 204A |          是           |                否                |           否           |
|  时钟和同步信号   | Device Clock<br>SYNC~ | Device Clock<br/>SYSREF<br>SYNC~ | Device Clock<br/>SYNC~ |
| SYNC~是否时序严格 |          否           |                否                |           是           |

### 时序

- **Frame Clock**：传输层的数据帧与帧时钟对齐，所有发送和接收设备的帧时钟周期必须相同；
- **Local Multi-Frame Clock (LMFC)**：多帧由 K 个帧组成，LMFC 与多帧边界对齐，作为低频参考解决多个设备间的帧时钟相位模糊问题，所有发送和接收设备的 LMFC 周期必须相同；
- **Device Clock**：设备的帧、采样、LMFC 时钟所源自的系统时钟（来源于外部，例如 AD9528）。
- **Sample Clock**：数据转换器的内部转换时钟，由设备时钟通过乘法器或除法器派生，与帧时钟的关系取决于数据打包到帧的方式。
- **SYSREF**：在 Subclass 1 实现中用于生成 LMFC 时钟的时序相位参考（外部施加），必须与设备时钟源同步，上升沿转换决定 LMFC 对齐。
- **SYNC**：单向信号（从接收器到发送器）低电平有效，常称为 SYNC~或 SYNCb，主要用于设备同步请求和错误报告，在 Subclass 2 设备中对齐 LMFC 相位，可选择将 SYNC 分配给多个设备。

### 协议栈

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_protocol_stack.webp" alt="JESD204B Protocol Stack" width="80%" />

<center> <small> JESD204B Protocol Stack </small> </center>

#### 应用层 Application Layer

以 RX 链路为例，应用层接收前端 ADC 采样数据，有序输出到传输层。

#### 传输层 Transport Layer & Scrambling

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_data_structure.webp" alt="JESD 204B Data Structure" width="80%" />

<center> <small> JESD204B Transport Layer Data Mapping </small> </center>

将 ADC 采集数据映射为非扰码的字节，再组成包含多个字节的帧，必要时为样本添加可选控制位，区分设备/链路/通道等的可能组合，相关重要参数包括

- L：每个转换器设备的通道数，图中 4 条 Lane，$L=4$；

- M：每个设备的 ADC 转换器数，假设每个通道都是 I/Q 传输，$M=2\times4 = 8$；

- F：每通道每帧的字节数，8 个 Octet，$F=8$；

- S：每个转换器每帧时钟周期的样本数

- CS：每个转换样本的控制位数；

- CF：每帧中的控制位数

> $$
> \mathrm{Lane\space Rate} = \dfrac{M\times N'\times f_s}{L}\times \dfrac{10}{8}
> $$
>
> 其中 $N' = \lceil (N + CS) / 8 \rceil \times 8$，$N$ 为 ADC 分辨率。

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_datalink.webp" alt="JESD 204B Transport Layer" width="80%" />

<center> <small> JESD204B Transport Layer </small> </center>

#### 链路层 DataLink Layer

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_sync.webp" alt="JESD 204B DataLink Layer" width="80%" />

<center> <small> JESD 204B DataLink Layer </small> </center>

- **码组同步（Code Group Syncchronization, CGS）**

如上图，RX 端发送 SYNCb 信号给 TX 端，TX 端连续发送 K28.5 实现比特同步，让 RX 端等接受到连续的 4 个 K 码时，认为完成比特同步，但是不同 Lane 的数据到达时间存在相位差；

- **通道初始化对齐（Initial Lane Alignment Sequence, ILAS）**

由于硬件上的细微差异(或温度差异)，可能导致每帧传输的时间不一致，需要对每一帧都做不同的延时处理。如上图所示，SYNC 信号拉高，然后发送 ILA 数据，利用 LMFC 本地时钟做边界对齐，利用缓冲区条件，保证每条 Lane 时延确定。

- **用户数据**：在持续监控下传输有效数据，并利用弹性缓冲区机制实现通道对齐和确定性延；

#### 物理层 Transport Layer

定义数据传输的电气和时序特性，为点对点、单向串行接口。

|   参数   |        LV-OIF-Sx15        |       LV-OIF-6G-SR        |      LV-OIF-11G-SR       |
| :------: | :-----------------------: | :-----------------------: | :----------------------: |
| 数据速率 | $312.5Mbps\sim 3.125Gbps$ | $312.5Mbps\sim 6.375Gbps$ | $312.5Mbps\sim 12.5Gbps$ |
| 差分电平 |    $500mV\sim 1000mV$     |     $400mV\sim 750mV$     |    $360mV\sim 770mV$     |
|  误码率  |      $\leq 10^{-12}$      |      $\leq 10^{-15}$      |     $\leq 10^{-15}$      |


## Xilinx JESD204B 方案

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_tx_core.webp" alt="JESD204 Transmitter Core" width="80%;" />

<center> <small> JESD204 Transmitter Core </small> </center>

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_rx_core.webp" alt="JESD204 Receiver Core" width="80%;" />

<center> <small> JESD204 Receiver Core </small> </center>

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_adc.webp" alt="JESD204B ADC Example" width="60%;" />

<center> <small> JESD204B ADC Example </small> </center>

JESD204B 的串行数据传输线速率范围在 $312.5Mbps\sim 12.5Gbps$，在实际应用中，串行线速率由 ADC 芯片决定。IP 核工作时钟为该线速率的 $1/40$。

- `core_clk`：串行数据传输线速率的 $1/40$；
- `ref_clk`：在 `JESD204_PHY` 核中的 GT 接口需要稳定的低抖动参考时钟；
- `s_axi_clk`：AXI4-Lite 接口协议的读写时钟；

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/electro/jesd204b_bd.webp" alt="JESD204B Block Design" width="90%;" />

如图所示，JESD204B 是单向传输协议，因此 JESD204 IP 核只能作为发送器或接收器，在 Block Design 中需要同时例化 TX 核与 RX 核。共享一个 JESD204_PHY 核。

配置默认使用前文提到的 Subclass 1，需要 sysref 信号来支持确定性延迟，该信号为单词脉冲或周期性脉冲（如果存在多片 ADC，所有 ADC 的 SYSREF 需要同源，并且等长走线）

## 调试步骤与问题排查

- 从 CGS 到 ILAS 之间最小的时间间隔是 `1 * Frame + 9 * Octest`，如果 SYNC 被拉高，但是 TX 侧没有开始发送 ILA 系列，则需要检查 TX 侧有没有收到 SYSREF，只有收到了 SYSREF 才能去使能 LMFC，如果没有发送 ILA，说明 TX 没有 ILA 产生，则此时会持续发送 K28.5。
- 如果 SYNC 信号始终拉低，检查 RX/TX 两边 Device Clock 是否正确


## 参考资料

[JESD204B Overview - Texas Instruments](https://www.ti.com/lit/ml/slap161/slap161.pdf)

[Comprehensive JESD204B Solution Accelerates and Simplifies Development (WP446)](https://docs.amd.com/v/u/en-US/wp446-jesd204b)

[JESD204 v7.2 LogiCORE IP Product Guide (PG066)](https://ez.analog.com/cfs-file/__key/telligent-evolution-components-attachments/00-423-01-00-00-19-60-57/pg066_2D00_jesd204.pdf)

[JESD204B 调试手册](https://www.ti.com.cn/cn/lit/an/zhca737/zhca737.pdf?ts=1633520840698&ref_url=https%253A%252F%252Fwww.ti.com.cn%252Fsitesearch%252Fcn%252Fdocs%252Funiversalsearch.tsp%253FlangPref%253Dzh-CN%2526searchTerm%253D204B%2526nr%253D150)

[JESD204 Interface Framework](https://analogdevicesinc.github.io/hdl/library/jesd204/index.html)

## 附录

### 8B/10B 编码
