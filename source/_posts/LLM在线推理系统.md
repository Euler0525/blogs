---
title: LLM 在线推理系统
description: 以一个具体的例子讲解 LLM 推理的流程。
tags:
  - LLM
  - Transformer
  - Attention
categories: 人工智能
mathjax: true
abbrlink: 5e9dc74b
date: 2026-08-13 16:49:44
---

> 本文由 GPT-5.6 Sol High 生成，用于个人学习 LLM 推理的流程。

本文只追踪一个请求：

```text
用户：法国的首都是哪里？
```

记作 **Request R42**。我们从它进入 API Server 开始，一直追踪到模型输出 `巴黎。`、生成 EOS，并释放 KV Cache。

文中的 token 划分、token ID、block 编号和模型维度都只是教学示意。为了让张量形状具体，假设模型配置如下：

```shell
Transformer layers = 32
hidden size        = 4096
query heads        = 32
KV heads           = 8        # GQA
head dim           = 128
vocab size         = 100000
weight dtype       = BF16
KV cache dtype     = BF16
KV block size      = 16 tokens
```

客户端发送：

```json
{
  "messages": [
    {
      "role": "user",
      "content": "法国的首都是哪里？"
    }
  ],
  "max_tokens": 8,
  "temperature": 0.7,
  "top_p": 0.9,
  "stream": true
}
```

整条链路可以先记成：

```shell
Request
  ↓
Chat Template
  ↓
Tokenizer
  ↓
Scheduler
  ↓
KV Cache Allocation
  ↓
Prefill
  ↓
Logits → Sampling → First Token
  ↓
Decode Loop
  ↓
Streaming
  ↓
EOS / Stop
  ↓
Free KV Cache
```

其中，**模型负责根据当前上下文计算 logits；推理引擎负责调度模型执行、维护 KV Cache、采样 token、流式返回以及管理请求生命周期。**

## 请求进入推理引擎

### Request 状态

API Server 收到 JSON 后，会把它转换成内部请求状态：

```shell
Request R42
├── request_id       = R42
├── messages         = [{user: "法国的首都是哪里？"}]
├── max_new_tokens   = 8
├── temperature      = 0.7
├── top_p            = 0.9
├── stream           = true
├── input_token_ids  = []
├── output_token_ids = []
├── kv_block_table   = []
└── status           = preprocessing
```

在线推理中的 request 不是一段静态字符串，而是一个持续变化的 sequence state。后面的 Scheduler、KV Cache 和 Decode Loop 都在读写这份状态。

### Chat Template

聊天模型通常不会直接看到用户输入，而是先按照训练时约定的格式展开 `messages`。示意如下：

```text
<|user|>
法国的首都是哪里？
<|assistant|>
```

因此 R42 得到：

```shell
prompt_text =
"<|user|>\n法国的首都是哪里？\n<|assistant|>\n"
```

Tokenizer 处理的是这个最终 prompt，而不一定只是用户肉眼看到的文字。

### Tokenizer 与 Embedding

假设 prompt 被切成：

```text
[<|user|>, 法国, 的, 首都, 是, 哪里, ？, <|assistant|>]
```

对应示意 token ID：

```text
[1, 19321, 312, 18273, 374, 8821, 1234, 2]
```

于是：

```shell
R42
├── input_token_ids = [1, 19321, 312, 18273, 374, 8821, 1234, 2]
├── prompt_len      = 8
└── status          = waiting
```

Tokenizer 与 Embedding 要区分：

```shell
Tokenizer:  text → token IDs
Embedding: token IDs → continuous vectors
```

模型通过 embedding matrix 查出每个 token 的向量：

$$
x_i = E [t_i]
$$

若词表大小为 100000，hidden size 为 4096：

$$
E\in\mathbb{R}^{100000\times4096}
$$

R42 的 8 个 token 经过 Embedding 后得到：

$$
X\in\mathbb{R}^{8\times4096}
$$

## Scheduler 与 Continuous Batching

### Scheduler 决定谁在这一轮上 GPU

假设 R42 到达时还有两个请求正在生成：

```shell
R17: decode
R28: decode
R42: waiting for prefill
```

Scheduler 会在每个 GPU iteration 前重新选择本轮要执行的 sequence。例如：

```shell
GPU Iteration #105
├── R17 → decode 1 token
├── R28 → decode 1 token
└── R42 → prefill 8 tokens
```

下一轮可能变成：

```shell
GPU Iteration #106
├── R17 → decode 1 token
├── R42 → decode 1 token
└── R51 → prefill 20 tokens
```

这就是 **Continuous Batching**：batch 不固定，而是在 iteration 之间动态重组。这样可以及时移除已完成请求并插入新请求，提高 GPU 利用率。

### Token Budget

Scheduler 通常还会限制一轮允许处理的 token 总量。例如：

```text
max_num_batched_tokens = 8192
```

需要满足：

$$
\text{prefill tokens}+\text{decode tokens}\le 8192
$$

R42 只有 8 个 prompt token，可以直接进入 Prefill。长 Prompt 则可能被拆成多个 chunk。

## KV Cache 与显存管理

### 为什么需要 KV Cache

Transformer 的每层 Attention 都会产生 Q、K、V。自回归生成时，历史 token 的 K/V 一旦计算出来就不会变化，因此可以保存下来。

R42 Prefill 后，每一层都缓存 8 个 prompt 位置的 K/V：

```shell
Layer 1:  K[0:8], V[0:8]
Layer 2:  K[0:8], V[0:8]
...
Layer 32: K[0:8], V[0:8]
```

生成 `巴黎` 后追加 position 8；生成 `。` 后再追加 position 9。

```shell
Prefill 后     sequence_len = 8
生成 "巴黎" 后 sequence_len = 9
生成 "。" 后   sequence_len = 10
```

这样 Decode 时不需要重新计算整个历史上下文。

### Paged KV Cache

如果为每个请求按最大上下文长度预留连续显存，会造成大量浪费和碎片。Paged KV Cache 把 KV 存储切成固定大小的 block。

假设一个 block 能容纳 16 个 token。R42 当前只需要一个逻辑块：

```shell
R42 logical block 0
└── positions 0 ~ 15
```

它可以映射到任意空闲物理块：

```shell
R42 Block Table

logical block 0 → physical block 37
```

于是 R42 的状态变成：

```shell
R42
├── prompt_len     = 8
├── sequence_len   = 8
├── kv_block_table = [37]
└── status         = scheduled_for_prefill
```

**KV Cache 是模型需要保存的数据；Paged KV Cache 是推理引擎管理这些数据的显存布局。**

## Prefill：第一次完整模型前向

### Prompt 如何进入 Transformer

R42 的 8 个 token 一起进入模型：

```shell
Token IDs
   ↓
Embedding
   ↓
X^(0) [8, 4096]
   ↓
Transformer Layer 1
   ↓
...
   ↓
Transformer Layer 32
   ↓
Final RMSNorm
   ↓
LM Head
   ↓
Logits
```

Prefill 不是把 8 个 prompt token 逐个做 8 次完整 forward，而是让多个位置并行通过 Transformer。

由于使用 causal mask，每个位置只能看到自己以及之前的位置：

```shell
              Key position
             1 2 3 4 5 6 7 8
Query pos 1  ●
Query pos 2  ● ●
Query pos 3  ● ● ●
Query pos 4  ● ● ● ●
Query pos 5  ● ● ● ● ●
Query pos 6  ● ● ● ● ● ●
Query pos 7  ● ● ● ● ● ● ●
Query pos 8  ● ● ● ● ● ● ● ●
```

Prefill 最终完成两件事：

```shell
1. 为 R42 的 8 个 prompt 位置写入每层 K/V Cache
2. 用最后一个 prompt 位置的 hidden state 产生第一个输出 token 的 logits
```

### Transformer Block

32 层的参数不同，但计算结构基本重复。以 Layer 1 为例：

```shell
                 X
                 │
                 ├──────────────────────────┐
                 ↓                          │
              RMSNorm                       │
                 ↓                          │
             Q/K/V GEMM                     │
                 ↓                          │
              RoPE(Q,K)                     │
                 ↓                          │
              Attention                     │
                 ↓                          │
         Output Projection                  │
                 ↓                          │
                Add ◀───────────────────────┘
                 │
                 X'
                 │
                 ├──────────────────────────┐
                 ↓                          │
              RMSNorm                       │
                 ↓                          │
          Gate / Up GEMM                    │
                 ↓                          │
              SwiGLU                        │
                 ↓                          │
            Down GEMM                       │
                 ↓                          │
                Add ◀───────────────────────┘
                 ↓
             next layer
```

#### RMSNorm

对 hidden state：

$$
x =(x_1, x_2,\ldots, x_d)
$$

计算：

$$
\mathrm{RMS}(x)=
\sqrt{\frac{1}{d}\sum_{i = 1}^{d}x_i^2+\epsilon}
$$

然后：

$$
\mathrm{RMSNorm}(x)=
\frac{x}{\mathrm{RMS}(x)}\odot g
$$

它主要控制 hidden state 的数值尺度。工程实现中常和 residual 等操作融合，以减少 HBM 读写。

#### Q/K/V Projection 与 RoPE

RMSNorm 后通过线性层得到：

$$
Q = XW_Q,\qquad K = XW_K,\qquad V = XW_V
$$

实际实现常合并成一次 GEMM：

$$
[Q, K, V] = XW_{QKV}
$$

随后 RoPE 对 Q、K 注入位置信息：

```shell
Q ──→ RoPE ──→ Q_rot
K ──→ RoPE ──→ K_rot
V ───────────→ V
```

因此 Attention 不只知道 token 内容，还能感知 token 之间的位置关系。

#### Attention

标准 scaled dot-product attention：

$$
A =\frac{QK^\top}{\sqrt{d_h}}
$$

加入 causal mask：

$$
P =\mathrm{softmax}(A+M)
$$

得到：

$$
O = PV
$$

对 R42 最后一个 `<|assistant|>` 位置来说，它的 Query 会与前面所有允许访问的位置的 Key 计算匹配，再按权重聚合对应 Value。

```shell
Query(<|assistant|>)
        ↓
与历史 Key 计算 score
        ↓
Softmax
        ↓
对历史 Value 加权求和
        ↓
contextual representation
```

##### FlashAttention

FlashAttention 不改变 Attention 的数学定义，而是优化执行方式。核心是把 Q/K/V 分块放入片上 SRAM，使用 online softmax 直接累计结果，避免完整的 $N\times N$ attention matrix 在 HBM 中反复读写。

#### KV Cache 写入

Prefill 时，每层产生的 K/V 被写入 R42 的 KV block：

```shell
Layer 1  positions 0 ~ 7 → block 37
Layer 2  positions 0 ~ 7 → block 37
...
Layer 32 positions 0 ~ 7 → block 37
```

逻辑 position、layer、K/V head 等维度由 KV cache layout 共同定位。block table 负责把逻辑 block 映射到物理显存。

#### MLP 与 Residual

Attention 输出先经过 output projection：

$$
y = OW_O
$$

再做 residual：

$$
x'= x+y
$$

随后进入第二个 RMSNorm 和 MLP。以 SwiGLU 为例：

$$
g = x'W_{gate},\qquad
u = x'W_{up}
$$

$$
h =\mathrm{SiLU}(g)\odot u
$$

$$
y_{mlp}= hW_{down}
$$

最后：

$$
x_{next}= x'+y_{mlp}
$$

可以粗略记成：

```shell
Attention → 在 token 之间聚合上下文
MLP       → 对每个位置的表示做非线性变换
```

### LM Head 产生第一个 token 的 logits

经过第 32 层后，对最后一个 prompt 位置做 Final RMSNorm：

$$
h =\mathrm{RMSNorm}(x_{32})
$$

再通过 LM Head 投影到词表空间：

$$
z = hW_{vocab}^{\top}
$$

因此：

$$
z\in\mathbb{R}^{100000}
$$

假设最高的几个 logits 为：

```shell
"巴黎"   12.6
"里昂"    8.1
"法国"    6.7
"伦敦"    5.9
...
```

模型到这里完成的是：

```shell
当前上下文 → 100000 个 next-token logits
```

### Sampling 与首次 Streaming

R42 使用：

```shell
temperature = 0.7
top_p       = 0.9
```

Temperature 对 logits 做：

$$
z'_i =\frac{z_i}{T}
$$

Top-p 再限制候选集合。最终假设采样得到：

```shell
next_token_id = 13579
next_token    = "巴黎"
```

R42 更新为：

```shell
R42
├── output_token_ids = [13579]
├── generated_len    = 1
├── sequence_len     = 9
└── status           = decoding
```

因为 `stream=true`，服务端立即 detokenize 并返回：

```text
巴黎
```

**第一个输出 token 的 logits 来自 Prefill 最后一个位置，不需要先额外执行一次 Decode。**

## Decode：逐 token 继续生成

### 从“巴黎”生成“。”

此时逻辑上下文已经是：

```text
<|user|> 法国 的 首都 是 哪里 ？ <|assistant|> 巴黎
```

下一轮只把最新 token `巴黎` 作为新的模型输入。过去 8 个 prompt token 的 K/V 已在缓存中，无需重新计算。

对每层来说，只计算：

$$
Q_{new}= x_{new}W_Q
$$

$$
K_{new}= x_{new}W_K
$$

$$
V_{new}= x_{new}W_V
$$

Attention 使用一个新 Query 读取全部历史 K/V：

$$
\mathrm{Attention}
\left(
Q_{new},
[K_1,\ldots, K_8, K_{new}],
[V_1,\ldots, V_8, V_{new}]
\right)
$$

同时把 `巴黎` 的新 K/V 追加到 position 8：

```shell
KV positions: 0 ~ 7
        ↓
KV positions: 0 ~ 8
```

因为 block size 为 16，当前仍只使用：

```shell
logical block 0 → physical block 37
```

这一轮经过 32 层、Final Norm、LM Head 和 Sampling 后，假设得到：

```shell
next_token = "。"
```

立即流式返回：

```text
巴黎。
```

### 从“。”生成 EOS

下一轮输入最新 token `。`，过程完全相同：

```shell
"。"
 ↓
Embedding
 ↓
new Q/K/V
 ↓
read historical KV
 ↓
Attention
 ↓
append new K/V
 ↓
LM Head
 ↓
Sampling
 ↓
<EOS>
```

EOS 表示模型认为生成可以结束。

### Prefill 与 Decode 的核心区别

| 维度 | Prefill | Decode |
|---|---|---|
| 单请求输入 | 整段或一块 Prompt | 最新 1 个 token |
| Query 数量 | 多个 | 1 个 |
| KV Cache | 批量创建 | 读取历史并追加 |
| GEMM 形状 | 通常更大 | 通常更 skinny |
| 典型瓶颈 | 更偏 compute-bound | 更偏 memory-bandwidth-bound |
| 用户体验 | 影响 TTFT | 影响 TPOT / ITL |

Decode 每次只产生一个新 token，但服务器可以在同一 iteration 中同时为很多 request 各生成一个 token。

### Stop 与资源回收

每次 Sampling 后，引擎都会检查：

```shell
EOS
stop token / stop string
max_new_tokens
max context length
client cancelled
timeout / abort
```

R42 生成 EOS 后：

```shell
status        = finished
finish_reason = stop
```

随后回收 KV block：

```shell
logical block 0 → physical block 37
                         ↓
                    free list
```

并从 Scheduler 的 active request set 中移除 R42。到这里，一次在线请求才真正闭环。

## 推理系统中的关键优化

### PagedAttention

如果 R42 的 sequence 超过 16 token，就可能跨多个物理 block：

```shell
logical block 0 → physical block 37
logical block 1 → physical block 12
logical block 2 → physical block 91
```

Decode 的新 Query 需要读取这些分散的历史 K/V。PagedAttention 根据 block table 直接定位物理 KV block 并执行 Attention。

因此：

```shell
Paged KV Cache → 解决 KV 如何分页存放
PagedAttention → 解决 Attention 如何读取分页 KV
```

### Chunked Prefill

若 R42 的 Prompt 不是 8 token，而是 12000 token，一次性 Prefill 可能长时间占用一个 iteration，影响其他请求的 Decode 延迟。

可以切成：

```shell
chunk 1 = 4096
chunk 2 = 4096
chunk 3 = 3808
```

Scheduler 再把这些 chunk 与其他请求的 Decode 交错执行。Chunked Prefill 的核心是用更细粒度的调度，在吞吐和在线延迟之间取得平衡。

### GPU Kernel 与 Kernel Fusion

RMSNorm、RoPE、GEMM、Attention、SwiGLU、Sampling 都只是算子描述，最终必须落到 GPU kernel：

```shell
Model Operator
     ↓
CUDA / Triton / Library
     ↓
GPU Kernel
     ↓
SM / Tensor Core
```

例如：

$$
[Q, K, V] = XW_{QKV}
$$

可能由 cuBLASLt、CUTLASS、Triton GEMM 或自定义 CUDA kernel 实现。

对于 Decode，很多小算子的计算量不大，但频繁 HBM 读写和 kernel launch 会增加延迟，因此常进行融合：

```shell
RMSNorm + residual
RoPE + KV cache write
SiLU + elementwise multiply
logits processing + sampling
```

Kernel Fusion 的核心目标通常不是改变模型数学公式，而是减少 launch 开销和 HBM 往返。

## 性能指标

### TTFT

从请求到达到第一个 token 返回：

$$
\mathrm{TTFT}
\approx
T_{queue}
+
T_{preprocess}
+
T_{prefill}
+
T_{first\ sampling}
+
T_{stream}
$$

长 Prompt、排队和 Prefill 都会直接影响 TTFT。

### ITL 与 TPOT

ITL 是相邻两个输出 token 的时间间隔；TPOT 是首 token 之后每个输出 token 的平均耗时。

$$
\mathrm{TPOT}
=
\frac{T_{generation\ after\ first\ token}}
{N_{output}-1}
$$

它们主要受 Decode、batch 调度、模型权重/KV 读取和 GPU kernel 效率影响。

### Throughput

服务端还关心：

```shell
requests / second
input tokens / second
output tokens / second
total tokens / second
```

在线 Serving 的核心权衡是：

```shell
低 TTFT
低 TPOT / ITL
高 Throughput
高 GPU Utilization
```

## 常见优化对应哪一步

| 技术 | 作用位置 | 主要解决的问题 |
|---|---|---|
| Continuous Batching | Scheduler | 动态组 batch，提高 GPU 利用率 |
| Chunked Prefill | Prefill 调度 | 降低长 Prompt 对 Decode 的阻塞 |
| Paged KV Cache | 显存管理 | 减少 KV 预留浪费与碎片 |
| PagedAttention | Decode Attention | 直接读取分页 KV |
| FlashAttention | Attention kernel | 降低 Attention HBM IO |
| GQA / MQA | Attention / KV | 减少 KV Cache 容量与带宽 |
| Quantization | 权重 / KV | 降低显存和带宽压力 |
| Tensor Parallel | Model Forward | 将大模型计算拆到多 GPU |
| CUDA Graph | Decode 执行 | 降低重复 launch 开销 |
| Kernel Fusion | Operator / Kernel | 减少 HBM 往返和 launch |
| Speculative Decoding | Decode Loop | 减少大模型昂贵解码步数 |
| Prefix Caching | Prefill / KV | 复用相同前缀的计算结果 |

判断一个优化技术时，最有用的问题不是“它属于什么名词”，而是：

```text
它优化的是排队、KV 显存、一次 Model Forward，还是 Decode Loop？
```

## R42 的完整生命周期

把全文压缩成一条状态链：

```shell
Client
  │
  │ "法国的首都是哪里？"
  ↓
API Server
  ↓
Chat Template
  ↓
Tokenizer
  │ token IDs = [...]
  ↓
Waiting Queue
  ↓
Scheduler / Continuous Batching
  ↓
Allocate KV Block 37
  ↓
Prefill 8 Tokens
  ├── Embedding
  ├── Transformer × 32
  ├── Write Prompt KV
  └── Last Position → Logits
  ↓
Sampling
  ↓
"巴黎"
  ↓
Streaming
  ↓
Scheduler
  ↓
Decode "巴黎"
  ├── new Q/K/V
  ├── read old KV
  ├── append new KV
  └── logits
  ↓
Sampling → "。"
  ↓
Streaming
  ↓
Scheduler
  ↓
Decode "。"
  ↓
Sampling → EOS
  ↓
Stop
  ↓
Free KV Block 37
  ↓
Finished
```

从系统分层看，同一条链路又可以写成：

```shell
Serving Layer
API / HTTP / SSE / request lifecycle
        ↓
Scheduling Layer
Scheduler / Continuous Batching
        ↓
Memory Layer
KV Cache / Paged KV
        ↓
Model Execution Layer
Prefill / Decode / Transformer Forward
        ↓
Operator & Kernel Layer
GEMM / RMSNorm / RoPE / Attention / Sampling
        ↓
Hardware Layer
CUDA / Triton / GPU / HBM / Tensor Core
```

## 结论

- **Prefill** 并行处理 Prompt，建立历史 KV Cache，并从最后一个位置产生第一个输出 token 的 logits。
- **Decode** 每轮只处理最新 token，复用历史 K/V，再追加新 K/V。
- **Scheduler** 在每个 iteration 动态组织不同请求的 Prefill 和 Decode。
- **Paged KV Cache** 管理 KV 的显存布局，**PagedAttention** 负责直接读取这种分页布局。
- **FlashAttention、Kernel Fusion、CUDA/Triton** 位于更底层，优化的是相同模型计算在 GPU 上的执行效率。
- 一次请求只有在 **EOS/Stop → KV 回收 → 从 active set 移除** 后才真正结束。

