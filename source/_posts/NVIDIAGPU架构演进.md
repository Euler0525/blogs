---
title: NVIDIA GPU 架构演进
description: >-
  梳理 NVIDIA GPU 从固定图形流水线、CUDA 通用计算，到 Tensor Core、光线追踪及机架级 AI
  系统的演进历程，深入分析各代架构的关键突破、设计取舍与性能瓶颈，揭示其从“渲染像素”走向“生产智能”的技术脉络。
tags:
  - NVIDIA
  - GPU
categories: 计算机系统
mathjax: true
abbrlink: 3f5537f3
date: 2026-07-23 15:23:07
---

> 本文内容由 GPT-5.6 Sol 生成。

NVIDIA GPU 的演进，远不只是 CUDA Core 数量增加。而是优化对象从像素和三角形，逐步扩大到线程束、矩阵运算、多 GPU 通信，最终延伸至整个机架。

过去三十年，NVIDIA GPU 经历了几次根本性的身份转换：

- 从固定功能的 3D 图形加速器，变成可编程并行处理器；
- 从依附 CPU 的协处理器，变成 AI 与高性能计算的主计算引擎；
- 从依靠通用计算单元，转向 CUDA Core、Tensor Core、RT Core 协作；
- 从追求单芯片峰值性能，转向优化显存、互连、封装、供电和散热；
- 从“生产画面”，走向“生产 token”和大规模智能。

## 基本框架

现代 NVIDIA GPU 通常由多个 GPC（Graphics Processing Cluster）组成，GPC 之下是 TPC 和 SM（Streaming Multiprocessor）。其中，SM 是 CUDA 程序执行的核心单元。

一个 SM 内通常包含：

- 多组 warp 调度器；
- FP32、FP64、INT 等常规执行流水线；
- Tensor Core 等矩阵运算单元；
- 寄存器文件、L1 缓存和共享内存；
- Load/Store、特殊函数与异步数据搬运单元。

CUDA 线程以 32 个线程组成的 warp 为基本调度单位。GPU 不像 CPU 那样主要依靠复杂的乱序执行和大缓存降低单线程延迟，而是让大量 warp 同时驻留：一个 warp 等待显存时，调度器立即执行其他已就绪的 warp。

因此，GPU 的优势是高吞吐而非低延迟。它特别适合：

- 同一操作作用于大量数据；
- 计算过程能被拆分为许多并行任务；
- 分支相对规则；
- 每次数据搬运可以支撑较多计算。

其性能上限可以用 Roofline 模型粗略描述：

$$
P_{\text{实际}}\leq
\min\left(P_{\text{峰值计算}},\ B_{\text{内存}}\times I_{\text{算术强度}}\right)
$$

这里的 $I$ 是每搬运一个字节能够完成多少次运算。这个简单关系几乎解释了 NVIDIA 后续的全部演进：

- 增加计算流水线和 Tensor Core，是提高计算上限；
- 引入 HBM、扩大缓存，是提高数据供给能力；
- NVLink 和 NVSwitch，是提高多 GPU 通信上限；
- FP16、FP8、FP4，是在提高计算密度的同时减少数据量；
- TMA、TMEM 和 kernel 融合，是减少中间数据的反复搬运。

## 主要架构

| 时期 | 架构或代表产品 | 关键变化 | 主要局限 |
| --- | --- | --- | --- |
| 1995—1998 | NV1、RIVA、TNT | 建立 PC 3D 图形流水线，转向标准三角形和多纹理 | 固定功能，几乎不能由开发者重新定义 |
| 1999—2005 | GeForce 256、GeForce 3—7 | 硬件 T&L，随后引入可编程顶点和像素着色器 | 顶点、像素硬件分离，容易出现资源失衡 |
| 2006—2009 | Tesla/G80、GT200 | 统一着色器、SIMT 与 CUDA | 缓存、ECC、FP64 和计算可靠性尚不成熟 |
| 2010 | Fermi | L1/L2、ECC、强 FP64、并发 kernel、C++ 支持 | 芯片庞大，功耗与控制复杂度较高 |
| 2012—2014 | Kepler、Maxwell | Hyper-Q、Dynamic Parallelism；随后重构 SM 以提高性能/瓦 | Kepler 依赖高并行度，Maxwell 弱化了 FP64/HPC |
| 2016 | Pascal | HBM2、NVLink、FP16、硬件页错误与统一内存 | GP100 与消费级 GP10x 的能力差异很大 |
| 2017—2018 | Volta、Turing | Tensor Core、独立线程调度；RT Core 进入实时图形 | 专用单元只能加速特定算法和数据类型 |
| 2020 | Ampere | TF32、BF16、结构化稀疏、MIG、异步数据搬运 | 峰值常依赖低精度或 2:4 稀疏 |
| 2022 | Hopper、Ada | Transformer Engine、TMA、线程块集群；SER 与神经渲染 | 软件和系统调优难度明显提高 |
| 2024—2025 | Blackwell | 双 reticle 统一 GPU、FP4、TMEM、NVLink 5、NVL72 | 高度依赖先进封装、液冷与机架级设计 |
| 2026 | Rubin | HBM4、NVLink 6、长上下文与 Agentic AI 优化 | 更偏向低精度 AI，并非所有传统指标都同步增长 |

同一个架构名称下可能存在完全不同的产品实现。例如 Pascal GP100 与 GP104、Ampere GA100 与 GA102、数据中心 Blackwell 与 RTX Blackwell，面向的精度、显存、互连和工作负载并不相同。所以，跨代比较不能只看 CUDA Core 数量。

### 从图形流水线到 CUDA

NVIDIA 的第一款产品 NV1 使用二次曲面纹理映射，但主流图形 API 后来选择了三角形。这促使 NVIDIA 通过 RIVA 系列转向标准三角形流水线。

这段经历留下了一个重要原则：**硬件架构必须与 API、开发工具和内容生态共同演进**。

1999 年的 GeForce 256 将几何变换、光照、三角形设置和渲染集成到单颗芯片。原本由 CPU 完成的图形工作被进一步转移到 GPU，显著提高了 3D 场景吞吐。但它仍然主要是固定功能处理器。真正改变 GPU 性质的是后来的可编程着色器：

- 顶点着色器允许开发者控制几何变换；
- 像素着色器允许开发者定义材质、光照和后处理；
- GPU 从执行预设状态，开始执行由开发者编写的小程序。

早期顶点和像素着色器对应不同硬件。当场景的顶点与像素工作量不平衡时，一部分硬件会闲置。

2006 年，G80 使用统一着色器架构，让顶点、几何和像素任务在相同的通用计算核心上执行，由硬件动态分配资源。这不仅解决了图形负载失衡，也为 CUDA 奠定了基础。CUDA 的出现意味着开发者不再需要把科学计算伪装成纹理和着色器操作。统一着色器由此完成了两次转型：

- 对图形而言，它是更灵活的资源池；
- 对计算而言，它是大规模 SIMT 并行处理器。

### 从“可以计算”到“可信赖地计算”

初代 CUDA GPU 虽然拥有很高的单精度吞吐，却缺少成熟计算处理器应有的缓存、纠错和双精度能力。

Fermi 在 2010 年补齐了这些基础设施：

- 引入 L1/L2 缓存层级；
- 加入 ECC；
- 显著强化 FP64；
- 支持多个 kernel 并发；
- 改善原子操作、C++ 和 IEEE 浮点行为。

Fermi 使 GPU 第一次真正具备进入 HPC 和数据中心的条件。它的代价则是面积大、功耗高，并且缓存、纠错和复杂控制逻辑占用了大量晶体管。

Kepler 随后转向并发和能效：

- Hyper-Q 提供多个硬件工作队列，减少不同 CUDA stream 之间的伪依赖；
- Dynamic Parallelism 允许 GPU kernel 启动新的 kernel；
- warp shuffle 让线程直接交换寄存器数据；
- GPUDirect RDMA 减少网络设备、CPU 内存与 GPU 显存之间的绕行。

Kepler 的 SMX 很宽，理论吞吐高，但需要充足的线程级和指令级并行度才能利用。线程块太少、寄存器压力过大或分支发散，都会让执行单元闲置。

Maxwell 的思路则是 **减少理论浪费**。它重新划分 SMM，让每个 warp 调度器对应更固定的执行资源，简化控制和数据通路。虽然单个 SMM 的核心数减少，但利用率和单位面积效率提高，最终获得了更好的性能/瓦。

这一时期的核心变化可以概括为：**NVIDIA 不再只追求堆叠更多执行单元，而开始追求每个晶体管能够贡献多少有效性能**。

### Pascal：内存和互连进入架构中心

2016 年的 Pascal GP100 同时引入了多项决定未来方向的技术：

- HBM2；
- 第一代 NVLink；
- 更高的 FP16 吞吐；
- 49 位统一虚拟地址；
- GPU 硬件页错误；
- 更细粒度的计算抢占。

HBM2 提高了显存带宽，NVLink 缓解了 PCIe 在 GPU—GPU 通信中的限制。硬件页错误让 Unified Memory 可以按需迁移数据，而不再只是统一编程接口。不过，统一内存并没有消除数据移动成本。如果工作集远大于 HBM、访问模式又高度随机，页错误和迁移仍可能导致严重抖动。它优先改善的是可编程性，而不是把 CPU 内存变成等价的 GPU 显存。Pascal 还标志着 NVIDIA 从单卡产品转向系统产品。P100、NVLink 和 DGX-1 共同构成了早期多 GPU AI 训练平台，GPU 架构的边界开始超出芯片本身。

### Tensor Core、RT Core 与领域专用化

Volta 是 NVIDIA AI 架构的关键分水岭。第一代 Tensor Core 将矩阵乘加变成一级硬件原语，以 FP16 输入和 FP32 累加执行神经网络中的核心运算。它体现出新的设计哲学：**保留可编程 SM，同时为占据主要运行时间的数学模式设置专用高速通路**。

此后，NVIDIA GPU 内逐渐形成多类执行单元协作：

- CUDA Core 负责通用 FP、INT 和着色；
- Tensor Core 负责矩阵与低精度 AI；
- RT Core 负责 BVH 遍历和几何求交；
- NVENC/NVDEC 负责视频编解码；
- TMA 等单元负责复杂 tensor 的异步搬运。

Turing 将 Tensor Core 带入消费图形，并首次增加 RT Core。实时渲染由此变成三部分协同：

1. CUDA Core 执行可编程着色；
2. RT Core 处理光线追踪的几何工作；
3. Tensor Core 执行降噪、重建和超分辨率。

这类专用化能够产生数量级提升，但也有明确代价：如果应用不使用光追或矩阵运算，相应专用单元不能自动变成普通 CUDA Core。专用硬件实际上是 NVIDIA 对未来工作负载方向的一次押注。

### Ampere、Hopper 与完整 AI 数据流

Ampere 将 Tensor Core 扩展为覆盖更多精度的通用矩阵引擎，支持 TF32、BF16、FP16、FP64、INT8、INT4 和 2:4 结构化稀疏。

其中：

- TF32 降低了传统 FP32 模型使用 Tensor Core 的门槛；
- BF16 在保持较大动态范围的同时降低数据量；
- FP64 Tensor Core 面向 HPC；
- 2:4 稀疏允许硬件跳过部分零权重；
- MIG 可以把一颗 A100 隔离成多个独立 GPU 实例。

但 Ampere 也说明了为什么“峰值 FLOPS”越来越难比较。宣传中的峰值可能依赖低精度、结构化稀疏、特定矩阵形状和 Boost 频率，不能代表实际应用性能。

Hopper 则从加速矩阵乘进一步走向加速完整 Transformer：

- FP8 Transformer Engine 动态管理 FP8 与 FP16；
- TMA 异步搬运多维 tensor；
- Thread Block Cluster 将协作范围扩展到多个 SM；
- Distributed Shared Memory 允许集群内线程块访问彼此的共享内存；
- NVLink 4 提高多 GPU 通信带宽；
- Grace Hopper 通过一致性 NVLink-C2C 连接 CPU 和 GPU。

当 Tensor Core 足够快以后，矩阵乘不再是唯一瓶颈。数据搬运、softmax、同步、collective 通信和 kernel 之间的空泡开始占据更大比例。Hopper 的重点正是减少这些非 GEMM 开销。

与 Hopper 同代的 Ada Lovelace 面向图形，重点解决光线追踪中的不规则执行。SER（Shader Execution Reordering）会重新组织执行路径相似的着色任务，缓解 warp divergence。更强的 Optical Flow Accelerator 和 Tensor Core 则支持 DLSS 3 帧生成。

生成帧能提高显示帧率，但并不等同于增加真实模拟帧：它不能等比例降低游戏逻辑和输入延迟，也可能引入运动伪影。

### Blackwell 与 Rubin：GPU 变成机架级系统

随着单颗 GPU 接近光刻 reticle 面积上限，继续制造更大的单片芯片变得困难。

数据中心 Blackwell 使用两个 reticle-limited die，通过 10 TB/s 的 NV-HBI 连接，对 CUDA 暴露为一个统一 GPU。它不是让开发者手动管理的两颗 GPU，而是在封装和一致性层面尽量维持单 GPU 编程模型。

Blackwell 的关键变化包括：

- 双 die 统一计算域；
- FP6、FP4 与 NVFP4；
- Tensor Memory 减少中间结果写回；
- 第五代 NVLink；
- Grace CPU、GPU、NVSwitch、网络和液冷的机架级联合设计；
- GB200/GB300 NVL72 将 72 个 GPU 组织成高带宽 scale-up 域。

这意味着架构优化的基本单位从芯片扩大到了机架。性能不再只取决于 SM，而同时取决于：

- HBM 容量与带宽；
- GPU 间互连；
- collective 通信效率；
- 供电瞬态；
- 液冷能力；
- 故障隔离和调度软件。

2026 年公布的 Rubin 继续沿着这个方向前进。NVIDIA 官方规格包括最高 288 GB HBM4、22 TB/s 显存带宽和每 GPU 3.6 TB/s 的 NVLink 6 带宽，并针对长上下文 attention、softmax、MoE 通信和依赖 kernel 之间的衔接进行优化。

Rubin 的目标不再只是缩短一次训练，而是提高 Agentic AI 的持续推理效率。Agent 会在推理、检索、工具调用和长上下文处理之间不断切换，低延迟解码也经常受到显存带宽而非 Tensor FLOPS 限制。

值得注意的是，Rubin 并非所有传统指标都增长。NVIDIA 公布的 Rubin FP64 向量峰值低于 Blackwell，而低精度矩阵、内存和互连性能大幅提高。这说明架构资源正在进一步向 AI 推理和通信倾斜。

## 优势与代价

NVIDIA 的主要优势不是某一个单独硬件模块，而是硬件与软件的长期配合。

其优势主要包括：

- **通用与专用并存**：保留 CUDA 可编程性，同时用 Tensor、RT 和数据搬运单元加速热点路径；
- **软件兼容性强**：CUDA、PTX、驱动、cuBLAS、cuDNN、TensorRT、NCCL 和开发工具形成长期积累；
- **重视数据移动**：从 GPUDirect、HBM、NVLink 到 TMA、TMEM，持续减少无效搬运；
- **系统扩展能力强**：把芯片、封装、CPU、网络和机架作为统一平台设计；
- **图形与 AI 相互促进**：AI 硬件推动神经渲染，图形需求又扩大低精度推理的应用范围。

对应的结构性代价包括：

- **SIMT 对不规则任务敏感**：复杂分支、指针追踪、图和树结构容易造成 warp divergence；
- **理论峰值难以兑现**：实际性能高度依赖 batch、矩阵形状、显存访问和通信；
- **低精度需要算法配合**：FP8、FP4 可能需要缩放、校准、微调或量化感知训练；
- **功率和部署复杂度上升**：高端系统依赖先进封装、液冷、高密度供电和复杂网络；
- **平台迁移成本高**：CUDA 与 NVLink 提供一致体验，也形成明显的软件和系统绑定；
- **专用化存在方向风险**：晶体管一旦用于特定单元，就无法在其他工作负载中自由复用。

---

判断一代架构是否真正进步，至少要同时观察：

- 工作负载是图形、训练、推理还是科学计算；
- 使用 FP64、FP32、TF32、BF16、FP16、FP8 还是 FP4；
- 峰值是否包含结构化稀疏；
- 是单 GPU、单节点还是多机集群；
- 任务受计算、显存带宽还是通信限制；
- 比较吞吐、单请求延迟还是每瓦性能；
- 显存容量是否足以容纳模型和 KV Cache；
- 软件栈是否已经针对新架构优化。

CUDA Core 数量尤其不能直接跨代比较。执行流水线宽度、双发射能力、FP32/INT32 资源分配和每周期吞吐都可能变化。同一架构下的数据中心芯片和消费级芯片也可能采用不同的 SM、显存与互连设计。对 AI 推理而言，真正有价值的指标通常不是峰值 PFLOPS，而是：

- 满足目标延迟时的 tokens/s；
- 每个用户的解码速度；
- 每瓦或每美元产生的 token；
- 长上下文下的并发能力；
- 多 GPU 扩展后的有效利用率。

---

回顾 NVIDIA GPU 架构，可以看到一条清晰的演进路线：

- GeForce 256 解决如何把图形工作从 CPU 搬到 GPU；
- G80 和 CUDA 解决如何让同一批核心执行不同并行任务；
- Fermi 解决 GPU 能否成为可靠的科学计算处理器；
- Kepler 和 Maxwell 解决并发利用率与性能/瓦；
- Pascal 解决显存、互连和多 GPU 扩展；
- Volta 和 Turing 为矩阵和光追建立专用高速通路；
- Ampere 扩展精度、稀疏和云端资源隔离；
- Hopper 优化完整 Transformer 数据流；
- Blackwell 突破单片面积并把机架变成计算单元；
- Rubin 则进一步面向长上下文、MoE、Agent 和每 token 经济性。

NVIDIA 真正持续推进的，不是某一种计算核心，而是不断识别系统中的下一个瓶颈，再把架构边界从算术单元向内存、互连、封装、软件和数据中心基础设施外扩。

## 参考资料

### 架构白皮书

- [NVIDIA GeForce 8/9 Series GPU Programming Guide](https://developer.download.nvidia.com/GPU_Programming_Guide/GPU_Programming_Guide_G80.pdf)：理解统一着色器、G80 图形流水线与早期通用计算。
- [Fermi Tuning Guide](https://developer.download.nvidia.com/compute/DevZone/docs/html/C/doc/Fermi_Tuning_Guide.pdf)：Fermi 的缓存、共享内存、并发 kernel 与数值行为。
- [Kepler Tuning Guide](https://docs.nvidia.com/cuda/archive/9.2/pdf/Kepler_Tuning_Guide.pdf)：Hyper-Q、Dynamic Parallelism、warp shuffle 与 SMX。
- [Maxwell Tuning Guide](https://docs.nvidia.com/cuda/maxwell-tuning-guide/)：SMM 分区、调度简化和性能/瓦演进。
- [Pascal GP100 Architecture Whitepaper](https://images.nvidia.com/content/pdf/tesla/whitepaper/pascal-architecture-whitepaper.pdf)：HBM2、NVLink、FP16 和 Unified Memory。
- [Volta V100 Architecture Whitepaper](https://images.nvidia.com/content/volta-architecture/pdf/volta-architecture-whitepaper.pdf)：第一代 Tensor Core 与独立线程调度。
- [NVIDIA Turing Architecture In-Depth](https://developer.nvidia.com/blog/nvidia-turing-architecture-in-depth/)：RT Core、Tensor Core 与混合渲染。
- [NVIDIA A100 Tensor Core GPU Architecture](https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/nvidia-ampere-architecture-whitepaper.pdf)：TF32、结构化稀疏、MIG 与异步数据搬运。
- [NVIDIA Ada GPU Architecture](https://images.nvidia.com/aem-dam/Solutions/geforce/ada/nvidia-ada-gpu-architecture.pdf)：SER、第三代 RT Core、DLSS 3 和神经渲染。
- [NVIDIA Hopper Architecture In-Depth](https://developer.nvidia.com/blog/nvidia-hopper-architecture-in-depth/)：Transformer Engine、TMA、线程块集群与 NVLink 4。
- [NVIDIA Blackwell Architecture](https://www.nvidia.com/en-us/data-center/technologies/blackwell-architecture/)：双 reticle GPU、NVLink 5 与机架级设计。
- [Inside NVIDIA Rubin GPU Architecture](https://developer.nvidia.com/blog/inside-nvidia-rubin-gpu-architecture-powering-the-era-of-agentic-ai/)：HBM4、NVLink 6、长上下文和 Agentic AI 优化。

### 编程模型与性能分析

- [CUDA C++ Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)：CUDA 线程层级、SIMT、warp、内存模型与同步机制。
- [CUDA C++ Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)：数据搬运、访存合并、占用率和性能优化原则。
- [Roofline Analysis with NVIDIA Nsight Compute](https://developer.nvidia.com/blog/accelerating-hpc-applications-with-nsight-compute-roofline-analysis/)：判断 kernel 究竟受计算还是内存带宽限制。
- [NVIDIA Corporate Timeline](https://www.nvidia.com/en-us/about-nvidia/corporate-timeline/)：从早期 3D 图形、GPU、CUDA 到 RTX 的官方历史。

