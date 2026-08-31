---
title: NVIDIA GPU 多卡服务器故障排查
description: NVIDIA GPU 训练性能下降、NCCL Hang、GPU 掉卡、NVLink 性能异常、单机或多机通信异常等问题的排故方法。
tags:
  - NVIDIA
  - GPU
categories: 工具
mathjax: true
abbrlink: 95efd7e1
date: 2026-09-03 09:57:19
---

本文用于指导 NVIDIA GPU 多卡服务器在出现训练性能下降、NCCL Hang、GPU 掉卡、NVLink 性能异常、单机或多机通信异常等问题时进行系统化排查。

GPU 多卡服务器的故障通常涉及多个层级，包括 GPU 硬件、PCIe、NUMA、NVLink、GPU P2P、NCCL、InfiniBand / RDMA、GPU Direct RDMA、容器环境以及训练框架。实际排障时，最常见的误区是尚未确认底层状态就直接修改 NCCL 或训练框架参数。

专业排障应遵循一个基本原则：**先证明底层正常，再向上排查。**

排障路径如下：

```text
GPU 状态
  ↓
PCIe / NUMA 拓扑
  ↓
NVLink / GPU P2P
  ↓
NCCL 单机通信
  ↓
IB / RDMA 网络
  ↓
GPU Direct RDMA
  ↓
NCCL 多机通信
  ↓
训练框架与应用性能
```

单条命令通常无法直接确定故障位置。有效的方法是通过多层测试建立证据链，逐步缩小问题范围。

---

## GPU 基础状态与硬件健康检查

排障的第一步是确认操作系统是否正确识别所有 GPU，以及 GPU 当前是否存在明显的硬件、驱动或运行状态异常。

首先执行：

```bash
nvidia-smi
nvidia-smi -L
```

`nvidia-smi` 适合快速确认 GPU 数量、利用率、显存占用、温度、功耗和当前运行进程，`nvidia-smi -L` 则可快速确认系统识别到的 GPU 数量和设备列表。

对于多卡训练，需要特别关注不同 GPU 之间的利用率差异。例如在 8 卡训练任务中，如果只有 GPU0 利用率接近 100%，其余 GPU 长时间保持 0%，应优先检查 `CUDA_VISIBLE_DEVICES`、`torchrun`、MPI 或 rank 配置，而不是直接判断为 NVLink 故障。

需要进一步检查 GPU 健康状态时，可以执行：

```bash
nvidia-smi -q -d MEMORY,ECC,TEMPERATURE,POWER,PERFORMANCE
```

重点关注显存、ECC、温度、功耗以及 Performance State。

需要持续观察 GPU 状态时，可使用 `nvidia-smi dmon`；需要确认具体进程占用情况时，可使用 `nvidia-smi pmon`。

### 检查 Xid 与掉卡错误

如果服务器出现 GPU 掉卡、CUDA Error、进程异常退出或设备突然不可见，应立即检查内核日志：

```bash
dmesg -T | grep -i -E 'NVRM|Xid|SXid'
journalctl -k | grep -i -E 'NVRM|Xid'
```

如果日志中出现类似 `GPU has fallen off the bus` 或明显的 Xid 错误，问题通常已经进入驱动、PCIe 或硬件层。此时不应继续围绕 PyTorch 或 NCCL 参数进行大量尝试。

对于严重故障，可执行：

```bash
sudo nvidia-bug-report.sh
```

该工具可收集 NVIDIA 驱动、PCIe、GPU 和系统日志，为后续分析提供完整信息。

---

## PCIe、NUMA 与 GPU 拓扑检查

多 GPU 通信性能与物理拓扑高度相关。在确认 GPU 基础状态正常后，应继续检查 GPU、CPU、NUMA、PCIe Switch 以及网络设备之间的拓扑关系。

首先执行：

```bash
nvidia-smi topo -m
```

典型输出如下：

```text
        GPU0 GPU1 GPU2 GPU3
GPU0     X   NV4  SYS  SYS
GPU1    NV4   X   SYS  SYS
GPU2    SYS  SYS   X   NV4
GPU3    SYS  SYS  NV4   X
```

常见拓扑标记含义如下：

| 标记 | 含义 |
|---|---|
| `NV#` | GPU 之间通过 NVLink 连接 |
| `PIX` | 通信经过一个 PCIe Switch |
| `PXB` | 通信经过多个 PCIe Switch |
| `PHB` | 通信经过 PCIe Host Bridge |
| `NODE` | 设备位于同一个 NUMA Node |
| `SYS` | 通信需要跨 NUMA 或 CPU Socket |

例如，`GPU0 ↔ GPU1 = NV4` 表示两张 GPU 之间存在 NVLink；`GPU0 ↔ GPU2 = SYS` 表示两张 GPU 之间的通信路径需要跨越更远的系统拓扑。

需要注意，`SYS` 本身并不代表故障，只表示通信距离更远。

如果希望忽略 NVLink，只观察 PCIe 路径，可以使用：

```bash
nvidia-smi topo -mp
```

NUMA 信息可以通过 `numactl -H` 查看。如果系统安装了 hwloc，也可以使用 `lstopo` 查看 CPU、NUMA、GPU、PCIe Switch 和网卡之间的关系。

对于多机 GPU Direct RDMA 环境，这一步尤其重要，因为 GPU 与 IB 网卡之间的 PCIe 和 NUMA 位置会直接影响后续通信路径判断。

### 检查 PCIe 是否发生降速

GPU 能够被系统正常识别，并不意味着 PCIe 一定工作在合理的链路状态。

首先获取 GPU 对应的 PCI 地址：

```bash
nvidia-smi --query-gpu=index,pci.bus_id --format=csv
```

假设某张 GPU 的 PCI 地址为 `31:00.0`，继续执行：

```bash
sudo lspci -s 31:00.0 -vv
```

重点检查 `LnkCap` 与 `LnkSta`。

正常情况下可能看到：

```text
LnkCap: Speed 32GT/s, Width x16
LnkSta: Speed 32GT/s, Width x16
```

如果出现：

```text
LnkCap: Speed 32GT/s, Width x16
LnkSta: Speed 16GT/s, Width x8
```

说明硬件支持更高的 PCIe 速率和宽度，但当前实际链路工作在较低状态。此时应进一步检查 BIOS、PCIe Riser、PCIe Switch、主板插槽或 GPU 安装状态。

需要注意，GPU 空闲时 PCIe 可能自动降低当前速率以节省功耗，因此不能只根据空闲状态下的一次 `LnkSta` 输出直接判断故障，最好结合负载状态进行确认。

---

## NVLink 与 GPU P2P 检查

确认 PCIe 和 NUMA 拓扑后，应继续验证 GPU 之间的实际通信能力。

首先检查 NVLink 状态：

```bash
nvidia-smi nvlink -s
nvidia-smi nvlink -e
```

`nvidia-smi nvlink -s` 主要用于确认各条 NVLink 当前是否处于 Active 状态，`nvidia-smi nvlink -e` 则用于观察链路是否存在错误计数。

这里必须注意一个重要原则：

**NVLink 显示 Active，并不代表 GPU 之间的实际通信性能一定正常。**

因此还需要进一步检查 GPU P2P。

可以执行：

```bash
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
nvidia-smi topo -p2p n
```

分别检查 P2P Read、P2P Write 以及 NVLink P2P Capability。

这些命令主要验证拓扑和能力。如果需要判断真实的数据传输性能，应进一步运行 CUDA Samples 中的 `p2pBandwidthLatencyTest`，或者使用 NVIDIA 的 `nvbandwidth`：

```bash
./p2pBandwidthLatencyTest
./nvbandwidth
```

`p2pBandwidthLatencyTest` 会实际测量 GPU 之间的 P2P 连通性、带宽和延迟。

如果出现以下组合：

```text
nvidia-smi topo -m      NVLink 拓扑正常
nvidia-smi nvlink -s    链路 Active
P2P 实测带宽            明显偏低
```

则问题范围已经可以缩小到 NVLink Error、PCIe、ACS/IOMMU、驱动或 GPU 硬件层，而不应优先怀疑 NCCL 或 PyTorch。

---

## NCCL 单机通信检查

只有在 GPU P2P 已经确认正常之后，才应继续进入 NCCL 层。

最常用的测试工具是 `nccl-tests`。例如测试单机 8 卡 AllReduce：

```bash
./build/all_reduce_perf \
    -b 8 \
    -e 1G \
    -f 2 \
    -g 8
```

其中：

- `-b` 表示起始消息大小；
- `-e` 表示最大消息大小；
- `-f` 表示每次测试消息大小的增长倍数；
- `-g` 表示参与测试的 GPU 数量。

测试结果中需要重点观察 `algbw` 和 `busbw`。

`algbw` 更接近算法层面的通信带宽，`busbw` 更适合比较不同服务器、不同拓扑或不同配置下的底层通信性能。

如果同型号、同配置服务器中，某台机器的 `busbw` 明显低于其他正常节点，应继续检查 NVLink、P2P、PCIe 和 NCCL topology，而不是直接将问题归因于训练框架。

### 分析 NCCL 实际通信路径

如果需要确认 NCCL 实际选择了什么通信路径，可以启用调试日志：

```bash
export NCCL_DEBUG=INFO
export NCCL_DEBUG_SUBSYS=INIT,GRAPH,P2P,NET
```

运行测试后重点观察日志中的 `P2P`、`NET/IB`、`NET/Socket` 和 `GRAPH`。

例如在多节点 InfiniBand 环境中，如果原本预期使用 IB / RDMA，但 NCCL 日志中主要出现 `NET/Socket`，说明 NCCL 没有使用预期的高速网络路径。此时应继续检查网卡、RDMA、网络接口选择以及 GPU Direct，而不是优先分析 GPU 算力。

排障时还可以使用“禁用法”进行对照测试。

禁用 GPU P2P：

```bash
export NCCL_P2P_DISABLE=1
```

如果禁用后 NCCL 性能从较高水平明显下降，说明原来的 GPU P2P 路径确实发挥了作用；如果禁用前后性能几乎没有变化，则应怀疑 NCCL 原本就没有正常使用 GPU P2P。

验证 InfiniBand 时可以执行：

```bash
export NCCL_IB_DISABLE=1
```

如果禁用 IB 后性能明显下降，通常说明原来的 IB Transport 正常发挥作用。

这些环境变量适合用于临时排障和对照实验，不建议在没有明确原因的情况下长期写入生产环境。

---

## InfiniBand 与 RDMA 网络检查

如果单机 NCCL 正常，而多机通信异常，应将排障重点转向网络层。

首先检查 InfiniBand 链路：

```bash
ibstat
```

正常状态下通常应看到 `State: Active` 和 `Physical state: LinkUp`。

进一步可以执行：

```bash
ibv_devices
ibv_devinfo
rdma link
ibdev2netdev
```

其中，`ibdev2netdev` 可以查看 Mellanox HCA 与 Linux 网络接口之间的映射关系，例如：

```text
mlx5_0 port 1 ==> ib0 (Up)
mlx5_1 port 1 ==> ib1 (Up)
```

这有助于确认 NCCL 使用的 `mlx5_0` 实际对应哪个系统网络接口。

### 验证 RDMA 实际带宽

IB 链路显示 Active 并不能证明网络实际性能正常。

真正验证 RDMA 数据路径时，应使用 `ib_write_bw`。

服务端执行：

```bash
ib_write_bw -d mlx5_0
```

客户端执行：

```bash
ib_write_bw -d mlx5_0 <服务器IP>
```

如果 `ib_write_bw` 本身就很慢，应优先检查 NIC、IB / RoCE、交换机、线缆、路由、PFC/ECN、NUMA 和 PCIe，而不是继续围绕 NCCL 排查。

如果 `ib_write_bw` 正常，但多机 `nccl-tests` 很慢，则应重点检查 GPU Direct RDMA、GPU-NIC Affinity、NCCL Transport 和 ACS/IOMMU。

---

## GPU Direct RDMA 与 ACS 检查

在 NVIDIA GPU 与 Mellanox 网络环境中，可以检查 `nvidia_peermem` 模块：

```bash
lsmod | grep nvidia_peermem
```

需要时可以加载：

```bash
sudo modprobe nvidia-peermem
```

但不能仅凭是否存在 `nvidia_peermem` 来判断 GPU Direct RDMA 是否可用。现代环境也可能使用 DMA-BUF，因此最终仍应结合 NCCL 日志和实际通信带宽进行判断。

另一个需要注意的问题是 PCIe ACS。

可以执行：

```bash
sudo lspci -vvv | grep ACSCtl
```

如果 ACS 配置导致 GPU 到 NIC 的 P2P 流量绕行 CPU Root Complex，可能造成明显性能下降，甚至引发通信异常。

但是，不应仅因为发现 `ACSCtl` 就直接照搬网上的 `setpci` 命令进行修改。虚拟化环境、裸机以及不同服务器平台对 ACS 的要求并不相同，需要结合具体架构判断。

---

## 容器、CUDA 与 PyTorch 环境检查

如果 NCCL 在容器中初始化失败、出现 Hang，或者裸机与容器表现明显不同，还需要检查容器运行环境。

首先检查共享内存：

```bash
df -h /dev/shm
ulimit -l
```

Docker 默认共享内存可能较小，而多 GPU、多 Rank 的 NCCL 任务可能需要更多共享内存。因此容器环境中的 NCCL 问题并不一定来自 GPU 或网络本身。

### CUDA 环境

可以执行：

```bash
nvcc --version
which nvcc
readlink -f /usr/local/cuda
```

需要特别区分 `nvidia-smi` 中显示的 `CUDA Version` 与 `nvcc --version`。

`nvidia-smi` 中的 CUDA Version 更接近当前 NVIDIA Driver 支持的 CUDA 能力，`nvcc --version` 才表示本机当前安装或正在使用的 CUDA Toolkit。

### PyTorch GPU 可见性

可以通过以下代码确认 PyTorch 实际看到的 GPU：

```python
import torch

print("torch:", torch.__version__)
print("torch cuda:", torch.version.cuda)
print("cuda available:", torch.cuda.is_available())
print("gpu count:", torch.cuda.device_count())

for i in range(torch.cuda.device_count()):
    print(i, torch.cuda.get_device_name(i))
```

如果 `nvidia-smi` 能看到 8 张 GPU，而 `torch.cuda.device_count()` 只能看到 1 张，应优先检查 `CUDA_VISIBLE_DEVICES` 和运行环境，而不是继续排查 NVLink。

---

## DCGM 与应用性能分析

对于 ECC、Xid、P2P Error、随机掉卡等问题，可以进一步使用 NVIDIA DCGM 进行硬件诊断。

快速诊断：

```bash
dcgmi diag -r 1
```

更深入诊断：

```bash
dcgmi diag -r 3
```

如果重点怀疑 PCIe：

```bash
dcgmi diag --run pcie
```

DCGM 更适合验证 GPU Hardware、Memory、PCIe、P2P 和 Compute 层面的健康状态。

如果 GPU、P2P、NCCL 和网络均正常，但训练性能仍然明显偏低，应进入应用性能分析阶段。

可以使用 Nsight Systems：

```bash
nsys profile \
    -t cuda,nvtx,osrt \
    -o train_report \
    python train.py
```

Nsight Systems 适合分析整个程序的时间线，可以观察 CPU、CUDA Kernel、Memcpy、NCCL 和 GPU Idle。

如果发现 GPU 长时间处于 Idle，问题可能来自 DataLoader、CPU、存储或数据预处理，而不是 GPU 本身。

如果需要进一步分析某个 CUDA Kernel 为什么执行缓慢，则可以使用 Nsight Compute，即 `ncu`。

两者的定位可以简单理解为：

- `nsys` 用于分析整个程序“哪里慢”；
- `ncu` 用于分析单个 CUDA Kernel“为什么慢”。

---

## 现场信息采集命令

第一次接手异常 GPU 节点时，建议先统一收集基础信息，再进行主动性能测试。

```bash
# GPU
nvidia-smi
nvidia-smi -L
nvidia-smi -q -d MEMORY,ECC,TEMPERATURE,POWER,PERFORMANCE

# Topology
nvidia-smi topo -m
nvidia-smi topo -mp
nvidia-smi topo -p2p r
nvidia-smi topo -p2p w
nvidia-smi topo -p2p n

# NVLink
nvidia-smi nvlink -s
nvidia-smi nvlink -e

# PCIe / NUMA
lspci | grep -i NVIDIA
lspci -tv
numactl -H

# Kernel Error
dmesg -T | grep -i -E 'NVRM|Xid|SXid'

# CUDA
nvcc --version
which nvcc

# RDMA / IB
ibstat
ibv_devinfo
rdma link
ibdev2netdev

# GPUDirect
lsmod | grep nvidia_peermem

# Container
df -h /dev/shm
ulimit -l
```

完成静态信息检查后，再进行实际数据路径测试：

```bash
# GPU ↔ GPU
./p2pBandwidthLatencyTest
./nvbandwidth

# GPU Hardware / PCIe
dcgmi diag -r 1
dcgmi diag --run pcie

# NCCL
./all_reduce_perf -b 8 -e 1G -f 2 -g 8

# RDMA
ib_write_bw
```

---

## 故障快速定位

实际排障时，应根据多项测试结果进行组合判断，而不是依赖某一条命令。

| 测试现象 | 重点排查方向 |
|---|---|
| `nvidia-smi` 无法识别全部 GPU，或出现 Xid / 掉卡 | 驱动、PCIe、GPU 硬件 |
| GPU 拓扑正常、NVLink Active，但 P2P 实测带宽明显偏低 | NVLink Error、PCIe、ACS/IOMMU、驱动、GPU 硬件 |
| P2P 实测正常，但单机 `nccl-tests` 明显偏慢 | NCCL topology、环境变量、SHM、CPU Affinity、容器环境 |
| 单机 NCCL 正常，多机 NCCL 很慢，同时 `ib_write_bw` 也很慢 | IB / RoCE、NIC、交换机、线缆、路由、PFC/ECN、NUMA、PCIe |
| `ib_write_bw` 正常、单机 NCCL 正常，但多机 NCCL 仍然很慢 | GPU Direct RDMA、GPU-NIC Affinity、NCCL NET Transport、ACS/IOMMU、NCCL 网络接口选择 |
| GPU、P2P、NCCL 和网络均正常，但训练仍然很慢 | DataLoader、CPU、存储、数据预处理或 CUDA Kernel |
| `nvidia-smi` 可见全部 GPU，但 PyTorch 只能看到部分 GPU | `CUDA_VISIBLE_DEVICES` 或运行环境 |

其中有几个判断尤其重要。

如果 `nvidia-smi topo -m` 正常、NVLink 为 Active、P2P 实测带宽正常，同时 `nccl-tests` 的 `busbw` 也正常，那么从 GPU、NVLink、CUDA P2P 到 NCCL 的单机通信链路基本可以认为健康。

如果 NVLink 拓扑正常且链路 Active，但 P2P 实测带宽明显偏低，问题应继续向 NVLink、PCIe、ACS/IOMMU、驱动和 GPU 硬件层收敛，而不是继续调整 NCCL。

如果单机 NCCL 正常、多机 NCCL 很慢，则先用 `ib_write_bw` 将基础 RDMA 网络与 NCCL / GPU Direct 问题分开。`ib_write_bw` 异常时优先处理网络；`ib_write_bw` 正常而多机 NCCL 异常时，再重点检查 GPU Direct RDMA、GPU-NIC Affinity 和 NCCL 网络路径。

---

## 排障原则总结

GPU 多卡服务器排障最重要的不是记住多少命令，而是建立清晰的分层验证思路。

推荐始终按照以下顺序判断：

```text
GPU 是否健康
  ↓
PCIe / NUMA 是否合理
  ↓
NVLink / P2P 是否正常
  ↓
NCCL 单机是否正常
  ↓
IB / RDMA 是否正常
  ↓
GPU Direct RDMA 是否正常
  ↓
NCCL 多机是否正常
  ↓
最后检查训练框架与应用
```

实际工作中，最值得重点掌握的三个主动测试工具是 `p2pBandwidthLatencyTest`、`nccl-tests` 和 `ib_write_bw`。

它们分别验证三个关键通信层级：

| 工具 | 验证对象 |
|---|---|
| `p2pBandwidthLatencyTest` | GPU ↔ GPU |
| `nccl-tests` | NCCL Collective |
| `ib_write_bw` | NIC ↔ NIC / RDMA |

通过这三类主动测试，可以将“多卡训练为什么慢”这一模糊问题逐步拆解为 GPU、PCIe / NVLink、NCCL 或网络中的具体层级问题。
