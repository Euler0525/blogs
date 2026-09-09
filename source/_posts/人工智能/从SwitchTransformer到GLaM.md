---
title: 从 Switch Transformer 到 GLaM
description: 大规模 MoE 的架构、路由、通信与 Scaling。
tags:
  - Transformer
  - Switch Transformer
  - MoE
  - GLaM
  - Scaling
  - 负载均衡
categories: [人工智能, 大模型技术]
series: 论文精选
series_order: 2
mathjax: true
abbrlink: 27d8c7a2
date: 2026-09-08 15:02:42
---

Dense Transformer 的基本扩展逻辑很直接：增加层数、隐藏维度或 FFN 宽度，参数量和每个 token 的计算量通常同步增加。MoE（Mixture-of-Experts）改变了这一点：

$$
P_{\text{total}} \neq P_{\text{active/token}}
$$

模型可以拥有大量参数，但每个 token 只激活少数 Expert。Switch Transformer 证明了这种稀疏条件计算可以被简化、稳定训练并扩展到万亿参数；GLaM 则进一步证明，MoE 可以用于 GPT 式 Decoder-only 大语言模型，并在 zero-shot、one-shot、few-shot 场景中获得更好的性能/计算比。

模型有多少参数已经不是一个充分指标。至少还要同时看总参数、每 token 激活参数、FLOPs/token、Expert 数、每 token 激活的 Expert 数，以及通信和存储成本。

## Dense Scaling 与 MoE 的核心差异

标准 Transformer 的 FFN 可写成：

$$
\operatorname{FFN}(x)= W_2\sigma(W_1x)
$$

若隐藏维度为 $d_{\text{model}}$，FFN 中间维度为 $d_{\text{ff}}$，其参数量约与 $2d_{\text{model}}d_{\text{ff}}$ 成正比。Dense 模型扩容时，新增参数通常都会参与每个 token 的计算，因此近似有：

$$
P_{\text{total}} \approx P_{\text{active/token}}
$$

MoE 把一个 FFN 换成多个独立 Expert：

$$
E_1, E_2,\ldots, E_N
$$

Router 根据 token 表示 $x$ 计算：

$$
h(x)= W_rx
$$

再经 softmax 得到对各 Expert 的概率：

$$
p_i(x)=
\frac{\exp(h_i(x))}
{\sum_j\exp(h_j(x))}
$$

关键不是“有很多 Expert”，而是每个 token 只调用少数 Expert。因此，Expert 数增加时总参数可以大幅增长，而单 token 的主要 FFN 计算不需要同比增长。

---

## Switch Transformer：把 MoE 做简单

Switch Transformer 的核心简化是 **Top-1 Routing**。传统 MoE 常使用 Top-2 或 Top-$k$：

$$
y =
p_{i_1}(x)E_{i_1}(x)
+
p_{i_2}(x)E_{i_2}(x)
$$

Switch 只保留一个 Expert：

$$
i^*=\arg\max_i p_i(x)
$$

$$
y = p_{i^*}(x)E_{i^*}(x)
$$

这样做有三个直接收益：Router 计算更少；每个 Expert 所需 capacity 更低；通信和实现更简单。Top-1 的潜在代价是单 token 不能同时组合多个 Expert 的输出，但论文实验并没有显示这一简化会明显损害整体质量。

一个常见疑问是：`argmax` 不可导，Router 为什么还能训练？原因是离散 Expert 选择虽然不可导，但最终输出仍保留 gate probability $p_{i^*}(x)$，因此梯度可以通过 softmax 概率回传到 Router。也就是说，模型不是对 `argmax` 求导，而是利用被选中 Expert 的连续 gate 值训练 Router。

### 负载均衡

MoE 的 Router 如果完全自由竞争，容易出现少数 Expert 越来越热门、其他 Expert 几乎得不到训练数据的情况。Switch 为此引入辅助负载均衡损失。

设 batch 中有 $T$ 个 token、$N$ 个 Expert。对 Expert $i$，定义实际路由比例：

$$
f_i =
\frac{1}{T}
\sum_{x\in B}
\mathbf{1}
\left[
\arg\max p(x)= i
\right]
$$

再定义 Router 分配给该 Expert 的平均概率质量：

$$
P_i =
\frac{1}{T}
\sum_{x\in B}p_i(x)
$$

辅助损失为：

$$
L_{\text{aux}}
=
\alpha N
\sum_{i = 1}^{N}f_iP_i
$$

理想状态是 $f_i=P_i=1/N$。某个 Expert 如果实际负载过高，$f_i$ 会变大，继续给它高概率 $P_i$ 的代价也会增大，从而形成负反馈。

这里 $f_i$ 含有 `argmax`，不可导；$P_i$ 来自 softmax，可导。训练时可以把 $f_i$ 看作当前 batch 的统计量，梯度通过 $P_i$ 回到 Router。Switch 论文使用 $\alpha=10^{-2}$。

### Expert Capacity 与 Token Dropping

为了高效执行，Expert 一般需要固定最大 token 数。Switch 定义：

$$
C =
\frac{T}{N}
\times
\text{capacity factor}
$$

capacity factor 太小，容易 overflow；太大则会产生 padding、显存和通信浪费。若某个 Expert 已满，Switch 的基本做法是让后续 overflow token 跳过该 Switch FFN，依赖 residual connection 继续传递。

因此负载均衡不仅是为了“公平使用 Expert”，也是为了减少 overflow 和 token dropping。

---

## All-to-All：MoE 的系统代价

Expert Parallelism 中，不同 Expert 分布在不同设备上。某个 token 当前在设备 $D_0$，但 Router 选择的 Expert 位于 $D_2$，就必须把 token hidden state 从 $D_0$ 发送到 $D_2$。

由于任意设备上的 token 都可能被路由到任意其他设备，通信不是简单点对点，而是典型的 **All-to-All**。

第一次 All-to-All 做的是：

$$
\text{Data-sharded layout}
\rightarrow
\text{Expert-sharded layout}
$$

也就是把“按 batch/token 分片”的数据重新组织成“按 Expert 分片”的数据。Expert 计算完成后，再做一次对应的 combine/return，把输出恢复到原 token 的逻辑位置。

All-to-All 和 All-Reduce 不同：

- All-Reduce 的核心是聚合，例如对多个设备上的梯度求和。
- All-to-All 的核心是重分布，不做求和，而是把不同数据块发送给不同目标设备。

因此可以直接记成：

$$
\text{All-Reduce}=\text{聚合}
$$

$$
\text{All-to-All}=\text{重排 / 洗牌}
$$

这也是 MoE 的一个关键 trade-off：减少单 token 的 dense 计算，往往会增加跨设备通信压力。

---

## 大规模 MoE 的并行与稳定性

Switch Transformer 讨论了三种核心并行方式：

| 并行方式 | 核心思想 | 典型通信 |
|---|---|---|
| Data Parallelism | 不同设备处理不同 batch | 梯度 All-Reduce |
| Model Parallelism | 一个大矩阵拆到多个设备 | 层内 All-Reduce |
| Expert Parallelism | 不同 Expert 放在不同设备 | All-to-All |

Model Parallelism 可以理解为“一个 token 的一次计算需要多个设备合作”；Expert Parallelism 更像“不同 token 被分流到不同设备”。

当模型同时使用 model parallelism 与 expert parallelism 时，会同时产生 All-Reduce 和 All-to-All，系统瓶颈不再只是 FLOPs，而是计算、显存、网络拓扑和通信带宽的联合约束。

Switch 还给出了两个重要训练稳定性技巧。

第一，**选择性精度训练**。纯 bfloat16 容易让 Router 不稳定，因此只在 Router 内部使用 float32，其他大部分计算仍保留 bfloat16。这样可以获得接近 float32 的稳定性，同时保持接近 bfloat16 的吞吐量。

第二，**减小初始化尺度**。论文将默认 Transformer 初始化 scale 从 $s=1.0$ 降到 $s=0.1$，显著降低了不同随机种子之间的训练方差。对超大稀疏模型来说，初始化的作用不仅是“给参数一个起点”，而是控制前向激活和反向梯度的数值尺度。

---

## Switch 的 Scaling 结论

Switch 最重要的实验不是“做出了万亿参数模型”，而是证明：

$$
\text{在相近 FLOPs/token 下增加 sparse parameters，性能仍然可以持续提升}
$$

从少量 Expert 增加到几十、上百个 Expert 时，总参数不断增长，但每 token 的主要计算预算基本保持不变，模型的样本效率和测试损失持续改善。

这说明 total parameters 不是 FLOPs 的简单同义词。对 MoE 来说 $P_{\text{total}}$ 和 $P_{\text{active}}$ 是两个独立程度更高的 scaling 轴。

同时要区分三种效率：sample efficiency、FLOP efficiency 和 wall-clock efficiency。MoE 每 step 学得更快，不代表真实训练时间一定更短，因为还要付 Router、padding 和 All-to-All 的成本。Switch 论文进一步做了 wall-clock 对比，说明在特定 TPU 集群和实现下，MoE 的样本效率收益足以抵消额外通信开销。

---

## GLaM

GLaM 的目标与 Switch 不同。Switch 主要证明 MoE 可以稳定扩展；GLaM 则希望验证

> MoE 能否像 GPT-3 一样，作为通用 Decoder-only Language Model，在 zero-shot、one-shot、few-shot in-context learning 中取得更好的性能/计算比？

最大的 GLaM 总参数约为 1.2T，但每个 token 只激活约 96.6B 参数。论文报告其在 29 个 NLP benchmark 上的平均 zero-shot、one-shot、few-shot 表现优于 GPT-3 175B，同时 inference FLOPs/token 约为 GPT-3 的一半。

GLaM 与 Switch 的几个关键区别如下：

| | Switch Transformer | GLaM |
|---|---|---|
| 基础架构 | Encoder-Decoder | Decoder-only |
| 主要目标 | 预训练、微调、稀疏扩容 | In-context learning |
| Routing | Top-1 | Top-2 |
| 最大总参数 | ~1.6T | ~1.2T |
| 最大模型 active params | 极低 | 96.6B |
| Expert 设计 | 多、偏小 | 更大、更重 |

### 为什么 GLaM 回到 Top-2

GLaM 每个 token 选择两个 Expert，并对两个输出做加权组合：

$$
y =
w_1E_{i_1}(x)
+
w_2E_{i_2}(x)
$$

如果有 $E$ 个 Expert，Top-1 的路径数量约为 $E$，Top-2 的 Expert pair 数量级可达到 $O(E^2)$。以 64 个 Expert 为例，无序 pair 数量是：

$$
\binom{64}{2}= 2016
$$

这给了每个 token 更多条件计算组合，但代价是更高的 active compute 与通信。GLaM 将 Top-2 视为性能和训练/服务效率之间的折中，而不是宣称它理论上一定优于 Top-1。

---

### Total Parameters、Active Parameters 与 FLOPs/token

最大的 GLaM：

$$
P_{\text{total}}= 1.2T
$$

但：

$$
P_{\text{active/token}}= 96.6B
$$

也就是每个 token 只激活约 8% 的参数。

对比几个代表模型：

| 模型 | Total Params | Activated Params/token |
|---|---:|---:|
| GPT-3 | 175B | 175B |
| Switch-C | 1.5T | 1.5B |
| GLaM 64B/64E | 1.2T | 96.6B |

同样是“万亿参数 MoE”，其 active compute 可以完全不同。因此一个 MoE 模型更应该用以下元组描述：

$$
(
P_{\text{total}},
P_{\text{active}},
E,
k,
\text{FLOPs/token}
)
$$

而不是只报一个“1.2T”。

GLaM 的 `64B/64E` 也不是总参数 64B，而是其 base dense size 和每层 Expert 数的命名。实际最大模型总参数约 1.2T。

---

### 增加 Expert：总参数暴涨，Active Compute 几乎不变

GLaM 在一个约 1.7B 的基础模型上，将 Expert 数从 1 增加到 256：

| 模型 | Total Params | Active Params |
|---|---:|---:|
| 1.7B Dense | 1.7B | 1.700B |
| 1.7B/32E | 20B | 1.878B |
| 1.7B/64E | 27B | 1.879B |
| 1.7B/128E | 53B | 1.881B |
| 1.7B/256E | 105B | 1.886B |

总参数从 1.7B 增长到 105B，而 active parameters 仅从 1.70B 增长到 1.886B。

对应实验显示，在 prediction FLOPs 基本一致时，增加 Expert 一般会改善 zero-shot、one-shot、few-shot 表现。这个结果再次说明：

$$
P_{\text{total}}\uparrow\uparrow
\quad
P_{\text{active}}\approx \text{constant}
$$

仍然可能带来性能提升。

这并不是“新增 Expert 都参与当前 token 的计算”，而是它们为 Router 提供了更多可选择的参数子空间。

---

### GLaM 的 2D Sharding

GLaM 与 Switch 的另一个重要区别是 Expert 本身更大。论文指出，当单个 Expert 大到无法放入一块 TPU 时，一个 Expert 还要继续跨设备分片。

Expert 权重张量可以写成：

$$
[E, M, H]
$$

其中 $E$ 是 Expert 维度，$M$ 是 model dimension，$H$ 是 FFN hidden dimension。GLaM 同时沿 $E$ 和 $H$ 分片；activation 张量：

$$
[B, S, M]
$$

则沿 batch 维度 $B$ 和 model 维度 $M$ 分片。

这本质上是：

$$
\text{Expert Parallelism}
+
\text{Model/Tensor Parallelism}
$$

的组合，再借助 GSPMD 自动推断其他张量的 sharding。

因此大规模 MoE 的工程问题已经不只是“把 Expert 放到不同设备”，而是“Expert 本身还要继续被切分”。

---

### GLaM 的训练与数据工程

GLaM 继续使用 MoE auxiliary loss，系数为 0.01，用于负载均衡。训练时使用 float32 权重和 bfloat16 activation。面对万亿参数训练的不稳定，论文采取了很务实的工程策略：先训练小模型暴露数据和基础设施问题；若某 batch 梯度出现 NaN/Inf 则跳过更新；若训练出现异常大波动或 NaN/Inf，则从健康 checkpoint 重启。

相比 Switch，GLaM 更值得注意的另一条主线是 **数据质量**。

论文构建了约 1.6T token 的候选训练数据，并训练质量分类器对网页进行评分。高质量样本不是简单硬过滤，而是通过 Pareto sampling 提高采样概率，同时保留部分低质量网页，以降低质量分类器带来的系统性偏差。

一个关键实验对比了约 143B filtered webpages 与约 7T unfiltered webpages。控制模型和 mixture proportions 后，filtered data 在 NLG 和 NLU 上均表现更好，且对 NLG 的提升更明显。

这说明在固定训练预算下数据质量不能被候选语料池规模简单替代。

---

## Switch 与 GLaM

传统 dense scaling 可以粗略写成：

$$
Q = f(P, D, C)
$$

其中 $P$ 是参数量、$D$ 是数据、$C$ 是计算。

MoE 出现后，至少需要拆成：

$$
Q =
f(
P_{\text{total}},
P_{\text{active}},
E,
k,
D_{\text{quantity}},
D_{\text{quality}},
C,
R,
C_{\text{comm}}
)
$$

其中：

- $P_{\text{total}}$：模型总容量；
- $P_{\text{active}}$：每 token 实际激活参数；
- $E$：Expert 数；
- $k$：每 token 激活 Expert 数；
- $D_{\text{quantity}}$：数据量；
- $D_{\text{quality}}$：数据质量；
- $R$：routing quality；
- $C_{\text{comm}}$：通信成本。

Switch 的贡献是证明 $P_{\text{total}}$ 可以和 $P_{\text{active}}$ 大幅解耦；GLaM 则继续探索在 Decoder-only LLM 中，如何在 total capacity、active compute、Expert 数、Expert 大小、数据质量和系统效率之间配置预算。

最后一个最重要的结论是：

$$
\text{Compute Efficient}
\neq
\text{Memory Efficient}
\neq
\text{Communication Efficient}
\neq
\text{Serving Efficient}
$$

MoE 的本质不是“让模型变稀疏”这么简单，而是重新分配容量、计算、通信和存储预算。Switch Transformer 解决的是如何让这种架构简单、稳定、可扩展；GLaM 则证明它可以进一步成为通用 Decoder-only 大语言模型的有效 scaling 路线。

## 参考资料

[arXiv | Computer Science > Machine Learning | Switch Transformers: Scaling to Trillion Parameter Models with Simple and Efficient Sparsity](https://arxiv.org/abs/2101.03961)

[arXiv | Computer Science > Computation and Language | GLaM: Efficient Scaling of Language Models with Mixture-of-Experts](https://arxiv.org/abs/2112.06905)
