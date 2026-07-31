---
title: HPC 学习笔记
description: '整理 HPC 学习中的 C/C++ 编译器生态、Fat-Tree 与双平面多轨网络，以及鲲鹏、灵衢平台和 Windows MPI 环境配置。'
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

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/it/hpc_ecosystem.png" alt="hpc_ecosystem" width="100%;" />

<center> <small> HPC 技术全景图 (图片由 GPT-5.6 Sol 生成) </small> </center>

## C/C++ 生态

```shell
编译器
├─ GCC
│  ├─ gcc：C 驱动
│  └─ g++：C++ 驱动，默认链接 libstdc++
├─ LLVM
│  └─ Clang
│     ├─ clang：C 驱动
│     ├─ clang++：C++ 驱动
│     └─ clang-cl：兼容 MSVC 命令行和 ABI
└─ MSVC
   └─ cl.exe：Microsoft C/C++ 编译器

Windows 环境
├─ Visual Studio：IDE + MSVC + MSBuild + Debugger
├─ MinGW-w64：让 GCC/Clang 构建原生 Windows 程序
├─ MSYS2：Shell + Pacman + 多套 MinGW/Clang 工具链
└─ Cygwin：POSIX 兼容层，程序通常依赖 cygwin1.dll

构建工具
├─ CMake：生成构建系统
├─ Make：执行 Makefile
├─ Ninja：高速构建执行器
├─ MSBuild：Visual Studio 构建系统
└─ Meson：现代构建配置系统
```

一套完整的 C/C++ 构建环境通常包含

{% mermaid %}
graph LR
A(源代码)
-- 预处理器 -->
B(编译器前端：
解析 C/C++、类型检查)
-->
C(编译器后端：
优化并生成汇编/机器码)
-->
D(汇编器目标文件 .o/.obj)-- 链接器
-->
E(可执行文件或动态/静态库)
{% endmermaid %}

还需要：

- **C 标准库**：glibc、musl、UCRT 等
- **C++ 标准库**：libstdc++、libc++、MSVC STL
- **运行时库**：异常处理、RTTI、栈保护、线程支持等
- **调试器**：GDB、LLDB、Visual Studio Debugger
- **构建系统**：Make、Ninja、MSBuild、CMake、Meson
- **包管理器**：vcpkg、Conan、系统包管理器
- **开发环境或 Shell**：Visual Studio、MSYS2、Cygwin 等

### GCC

GCC(GNU Compiler Collection) 是一个编译器集合，支持 C/C++等语言。搭配

- GNU assembler：`as`
- GNU linker：`ld`
- GNU Debugger：`gdb`
- GNU Make：`make`
- C++ 标准库：`libstdc++`

例如在 Linux 系统上常见的组合为 `GCC + GNU Binutils + glibc + libstdc++ + GDB`

`gcc` 与 `g++` 的区别在于 `g++` 默认按 C++程序处理，可以自动链接 `libstdc++`，而使用 `gcc` 编译 C++程序时需要手动链接 `gcc main.cpp -lstdc++ -o main`

优点：

- Linux 和嵌入式领域普及
- 支持平台和 CPU 架构多
- 优化成熟
- 诊断、Sanitizer、LTO、OpenMP 等支持完整
- 与 GNU/Linux 生态结合紧密

不足：

- 某些诊断信息和开发工具体验过去不如 Clang，近年已经改善
- Windows 原生开发不是它最自然的环境，通常需要 MinGW-w64 或 Cygwin

### Clang 与 LLVM

- LLVM：编译器基础设施，包括中间表示、优化器、代码生成器等
- Clang：基于 LLVM 的 C、C++、Objective-C 编译器前端

|      工具      | 作用                 |
| :------------: | :------------------- |
|    `clang`     | 通常用于 C           |
|   `clang++`    | 通常用于 C++         |
|     `lld`      | LLVM 链接器          |
|     `lldb`     | LLVM 调试器          |
| `clang-format` | 代码格式化           |
|  `clang-tidy`  | 静态检查和代码现代化 |
|    `clangd`    | 编辑器语言服务器     |
|   `llvm-ar`    | 静态库管理           |
| `llvm-objdump` | 查看目标文件和反汇编 |

优点：

- 错误提示通常清晰
- `clangd`、`clang-tidy`、`clang-format` 工具链优秀
- macOS/iOS 官方工具链核心
- 与 LLVM 优化、分析生态结合紧密
- 可兼容 GCC 或 MSVC 风格的命令行与 ABI

不足：

- 在部分平台，仍需依赖系统提供的标准库、链接器和 SDK
- 某些特殊架构或 GCC 扩展支持可能不如 GCC
- 安装了 Clang 不代表完整工具链、系统头文件和 SDK 都已具备

### MSVC

MSVC 是 Microsoft Visual C++ 工具链，主要用于 Windows。在 `Developer PowerShell/ Command Prompt for Visual Studio` 中使用

|          工具          | 作用                          |
| :--------------------: | :---------------------------- |
|        `cl.exe`        | C/C++ 编译器驱动              |
|       `link.exe`       | 链接器                        |
|       `lib.exe`        | 静态库管理                    |
|      `nmake.exe`       | 构建工具                      |
|        MSBuild         | Visual Studio 项目构建系统    |
| Visual Studio Debugger | 调试器                        |
|        MSVC STL        | C++ 标准库实现                |
|      Windows SDK       | Win32/UWP 等 API 的头文件和库 |

优点：

- Windows 原生开发最主流
- 与 Windows SDK、Visual Studio、调试器结合最好
- 对 PDB、SEH、COM、C++/CLI 等 Microsoft 技术支持完善
- C++ 标准支持已经相当完整
- 可通过 Visual Studio Installer 单独安装 Build Tools

不足：

- 主要面向 Windows
- 命令行参数与 GCC/Clang 风格差异明显
- 某些 GNU 扩展不支持
- `cl.exe` 对 `.c` 文件的 C 标准支持与 GCC/Clang 不完全相同

### MinGW-w64

MinGW(Minimalist GNU for Windows)可以让 GCC 生成在 Windows 系统运行的原生程序，通常调用

- Windows API
- Windows C 运行库
- MinGW 自身提供的适配与运行时组件

与 MSVC 的生态不相同

| 项目               | MinGW-w64 GCC              | MSVC                   |
| :----------------- | :------------------------- | :--------------------- |
| 编译器             | GCC                        | `cl.exe`               |
| C++ 标准库         | 通常 libstdc++             | MSVC STL               |
| 调试信息           | 通常 DWARF，也可有其他格式 | PDB/CodeView           |
| 调试器             | GDB                        | Visual Studio Debugger |
| 命令行风格         | GNU                        | Microsoft              |
| Windows SDK 适配   | MinGW-w64 头文件/导入库    | 官方 Windows SDK       |

### MSYS2

MSYS2 是 Windows 上的开发环境，提供：

- 类 Unix Shell, UCRT64
- Pacman 包管理器
- GNU 工具
- MinGW-w64 GCC
- Clang/LLVM
- CMake、Ninja、GDB 等工具和库

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

### CUDA 环境配置

参考 [AlmaLinux 安装流程](https://euler0525.github.io/blogs/posts/1dc8999e/#cuda)


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
