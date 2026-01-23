---
title: HPC 学习笔记
tags:
  - HPC
  - Arm
  - Fat-Tree
  - MPI
categories: 计算机系统
mathjax: true
abbrlink: c618e484
date: 2026-06-13 16:13:48
---

## 灵晟

> - 术语表
>
> | 中文名称 |                英文名称                | 解释 |
> | :--: | :--------------------------------: | :--- |
> | 灵晟 | LineShine | 中国国产 E 级 $10^{18}$ 超级计算机系统 |
> | 鲲鹏 | Kunpeng | 处理器 |
> | 灵衢 | Unified Bus | 面向超节点的互联协议 |
>

灵晟系统由 20,480 个计算节点构成，每个节点搭载 2 颗基于 ARM 架构的 CPU，每个 CPU 包含 304 个核心，全系统总计 40,960 颗处理器、超过 245 万个 CPU 核心。节点之间通过灵渠高速网络互连，采用双平面多轨 Fat-Tree 拓扑结构，每个节点 $1.6 Tb/s$ 的带宽。

### 网络架构

#### Fat-Tree 拓扑结构

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/it/p63-alfares_05.webp" alt="p63-alfares_05" width="80%;" />

<center> <small> Fat-Tree 拓扑结构 </small> </center>

Fat-Tree 一共分为三层：Core、Aggregation 和 Edge。对于一个 $k$ 元 Fat-Tree：

每台交换机都有 $k$ 个端口，即出入度和为 $k$；Core 有 $k^2/4$ 台交换机；一共有 $k$ 个 Pod，每个 Pod 有 $k$ 台交换机组成，其中 Aggregation 和 Edge 各 $k/2$；Edge 的每台交换机最多直连 $k/2$ 台服务器；任意两个 Pod 之间存在 $k$ 条路径。

则 $k$ 元 Fat-Tree 最多可容纳 $k^3/4$ 台服务器；

对于一个 $k$ 元的 Fat-Tree，`10.x.y.z/24` 中 `x` 的取值范围为 $[0,k)$，代表第 $x$ 个 Pod；在一个 Pod 内，`y` 代表交换机的编号；

相较于传统的树形结构，Fat-Tree 结构越靠近上层，交换路径越多，服务器之间有多条可选路径，数据流量分散，因此网络能承载更多的流量，减少拥塞。与公路网类比：

```shell
传统树型结构：
小区道路 → 城市道路 → 一条高速入口
Fat-Tree：
小区道路 → 多条城市道路 → 多个高速入口
```

#### 双平面多轨

多轨指的是每个服务器有多张网卡，对应多条独立的网络通道。在高性能计算场景中，大量机器同时交换数据，避免堵在同一个网口。

双平面指的是每个服务器的多个网卡，部分接入 Fat-Tree 平面 A，另一部分接入 Fat-Tree 平面 B（可以考虑将数据隔离，比如平面 A 负责训练数据同步，平面 B 负责存储访问；或者平面 A 负责一部分 CPU 通信，平面 B 负责另一部分 CPU 通信）

### 鲲鹏

#### 功能框架

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/it/hpc_functional_framework.webp" alt="hpc_functional_framework" width="80%;" />

<center> <small> HCP 功能框架 </small> </center>

#### 鲲鹏 920 专业版

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/it/architecture_overview_of_lx2_processor.webp" alt="architecture_overview_of_lx2_processor" width="80%" />

<center> <small> 处理器架构 </small> </center>

- 单颗处理器支持 304 个物理核心（CPU core），支持多 NUMA 架构。
- 每个 CPU core 内集成私有的 32KB L1 I-Cache，32KB L1 D-Cache 以及 768KB L2 Cache。
- 38 个 CPU cores 形成一个 CPU Cluster，即一个 NUMA；4 个 CPU Cluster 组成一个 Super CPU Cluster（SCCL），即 152 个 CPU Cores；
- 通过多 DIE 合封技术，一个 SCCL 封装为一个 DIE，单颗处理器最多可合封装 2 个 DIE，即 2 个 SCCL（8 个 CPU Cluster 或 8 个 NUMA）

### 灵衢

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/it/unified_bus.webp" alt="unified_bus" width="80%;" />

<center> <small> 灵衢超节点计算系统架构 </small> </center>

灵衢硬件体系的核心是 UBPU（UB Processing Unit），所有支持 UB 协议栈的功能单元都属于 UBPU，通过 UB Link 点对点互联，构成统一的互联域。每个 UBPU 中包含四个功能模块

|     组件      |      全称       | 核心功能                                                     |
| :-----------: | :-------------: | :----------------------------------------------------------- |
| UB Controller |    UB 控制器    | 执行完整 UB 协议栈，提供软硬件交互接口，是 UBPU 的控制核心；负责事务处理、报文封装解析 |
|     UMMU      | UB 内存管理单元 | 实现全局内存地址翻译、访问权限校验、Token ID 管理；是跨节点内存访问、内存池化的硬件基础 |
|   UB Switch   |   UB 交换单元   | UBPU 内置交换能力（专用 Switch 型 UBPU 为全功能交换），支持报文在端口间直接转发，无需软件中转，支撑大规模组网与多路径负载均衡 |
|    UB Link    |   UB 互联链路   | UBPU 间的点对点物理连接，承载 UB 报文传输                    |

## 参考资料

[Glenn's Digital Garden | LineShine (NSCC-SZ)](https://glennklockwood.com/garden/systems/lineshine)

[搜狐 | 245 万个 CPU 核心，中国超算“灵晟”突破 2EFlops！](https://m.sohu.com/a/1024030449_128469?scm=10001.325_13-325_13.0.0-0-0-0-0.5_1334)

[国防科技大学学报 JNUDT | 高性能互连网络拓扑研究综述](http://journal.nudt.edu.cn/gfkjdxxb/article/html/20260216)

[arXiv | Insights into DeepSeek-V3: Scaling Challenges and Reflections on Hardware for AI Architectures](https://arxiv.org/abs/2505.09343)

[SIGCOMM | A scalable, commodity data center network architecture](http://ccr.sigcomm.org/online/files/p63-alfares.pdf)

---

[鲲鹏社区 | 鲲鹏高性能计算解决方案](https://www.hikunpeng.com/solutions/hpc)

[鲲鹏社区 | 鲲鹏 HPC 成长地图](https://www.hikunpeng.com/document/detail/zh/kunpenghpcs/overview/index.html)

---

[超节点技术体系白皮书 | 华为超节点](https://deeplink-org.github.io/superpod-whitepaper/01-architecture/02-huawei/#hccs-ub)

[灵衢社区](https://www.unifiedbus.com)

---

[上海交通大学 Xflops 超算队 | HPC 入门指南](https://xflops.sjtu.edu.cn/hpc-start-guide/)

## 附录

### Windows MPI 环境配置

#### Python 版本

```powershell
pip install mpi4py
```

#### C 版本

- [点击此处](https://github.com/microsoft/Microsoft-MPI/releases) 下载 MPI 依赖库，并配置环境变量

```powershell
MSMPI_INC=C:\Software\Microsoft_SDKs\MPI\Include\
MSMPI_LIB32=C:\Software\Microsoft_SDKs\MPI\Lib\x86\
MSMPI_LIB64=C:\Software\Microsoft_SDKs\MPI\Lib\x64\

# Path
C:\Software\Microsoft_MPI\Bin\
```

