---
title: Triton Attention Kernel
description: >-
  Triton 实现 Softmax Attention 算子的基本思路。重点思考怎样不用存完整 attention matrix，仍然精确算出
  softmax attention.
tags:
  - Attention
  - Softmax
  - Triton
categories: 编程
mathjax: true
abbrlink: 3fb3592b
date: 2026-08-12 21:51:38
---

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/ai/softmax_attention.webp" alt="softmax_attention" width="100%;" />

<center> 图片由 GPT-5.6 Sol High 生成 </center>

## 实现思路

标准的 scaled dot-product attention 可以写成：

$$
O =\operatorname{softmax}\left(\frac{QK^T}{\sqrt d}\right)V
$$

假设：

```text
Q: [M, d]
K: [N, d]
V: [N, d]
```

最直接的 PyTorch 实现是：

```python
import torch
import torch.nn.functional as F


def solve(
    Q: torch.Tensor, K: torch.Tensor, V: torch.Tensor, output: torch.Tensor, M: int, N: int, d: int
):
    scores = torch.matmul(Q, K.T) / (d ** 0.5)
    attention = F.softmax(scores, dim=-1)
    output.copy_(torch.matmul(attention, V))

```

这段代码的问题在于，`Q @ K.T` 会首先产生一个大小为 `[M, N]` 的 Attention Score 矩阵，softmax 之后仍然需要处理一个同样规模的矩阵。如果序列很长，这个中间结果会带来明显的显存占用和显存读写开销。

而本文实现的 Triton kernel 采用的是另一种计算顺序。先不完整计算 `QK^T`，而是让一个 Triton program 负责一个 Query，然后把 K 和 V 按 32 行一块依次读入：

```text
Q[i]
 │
 ├── K[0:32]   → score → softmax 更新 → V[0:32]   → 累加
 ├── K[32:64]  → score → softmax 更新 → V[32:64]  → 累加
 ├── K[64:96]  → score → softmax 更新 → V[64:96]  → 累加
 └── ...
```

最终，它只保留当前 Query、当前 K/V block，以及几个用于 softmax 和输出累积的中间变量，而不需要把完整的 Attention Probability 矩阵写回显存。

---

先从 kernel 的启动方式看：

```python
grid = (M,)

attention_kernel[grid](...)
```

这里的 `grid = (M,)` 意味着沿着第 0 个 grid 维度启动 M 个 Triton program，然后 kernel 内部通过 `pid = tl.program_id(axis=0)` 得到当前 program 的编号。所以整个 kernel 的任务划分可以表示为

```text
pid = 0   → 计算 output[0, :]
pid = 1   → 计算 output[1, :]
pid = 2   → 计算 output[2, :]
...
pid = M-1 → 计算 output[M-1, :]
```

也就是说，一个 program 对应一个 Query。接下来 `Q + pid * stride_qm + offs_d * stride_qd` 一次性构造当前 Query 这一整行的地址。等价于一次性构造：

```text
&Q[pid, 0]
&Q[pid, 1]
&Q[pid, 2]
...
```

然后通过 `q = tl.load(q_ptrs, mask=mask_q, other=0.0)` 把这一整块数据读出来。这里 `mask_q = offs_d < d` 是为了处理 `BLOCK_SIZE_D` 大于真实维度 `d` 的情况。外部代码中 `BLOCK_SIZE_D = triton.next_power_of_2(d)` 会把 d 向上补到最接近的 2 的次幂。后补的部分必须通过 `mask` 屏蔽，否则就会发生越界访问。

后面 K 和 V 的加载过程其实只是二维版本的同一个思路。

---

kernel 中的主循环是：

```python
for start_n in range(0, N, BLOCK_SIZE_N=32):
```

也就是说，一次只处理 32 个 Key 和 32 个 Value。

加载 K

```python
k = tl.load(
    K + 
    offsets_n[:, None] * stride_kn + 
    offsets_d[None, :] * stride_kd, 
    mask=mask_k, other=0.0
)
```

这里同时使用了两个索引：`offsets_n[:, None]` 的 shape 是 `[BLOCK_SIZE_N, 1]`，而 `offsets_d[None, :]` 的 shape 是 `[1, BLOCK_SIZE_D]`，两者广播后就形成了一个二维地址网格：

```text
[BLOCK_SIZE_N, BLOCK_SIZE_D]
```

对应的数据可以想象成：

```text
K[n0, 0] K[n0, 1] ... K[n0, d-1]
K[n1, 0] K[n1, 1] ... K[n1, d-1]
K[n2, 0] K[n2, 1] ... K[n2, d-1]
...
```

于是 `k` 就是当前 32 个 Key 组成的二维 block。

然后

```python
qk = tl.sum(q[None, :] * k, axis=1)
```

本质上是在计算当前 Query 与这 32 个 Key 的点积。

`q[None, :]` 的 shape 是 `[1, BLOCK_SIZE_D]` 与 `k.shape = [BLOCK_SIZE_N, BLOCK_SIZE_D]`，广播以后得到 `[BLOCK_SIZE_N, BLOCK_SIZE_D]`，再沿 feature 维，也就是 `axis=1` 求和，最终得到 `[BLOCK_SIZE_N]`

其中每个元素分别是

$$
q\cdot k_0,\quad q\cdot k_1,\quad \ldots,\quad q\cdot k_{31}
$$

随后

```python
qk *= sm_scale
sm_scale = d ** -0.5
```

于是得到 Attention 中的

$$
\frac{qk^T}{\sqrt d}
$$

需要注意的是，最后一个 K block 不一定刚好有 32 个合法 token。比如 N = 100，最后一轮索引是 96 到 127，其中只有 96 到 99 合法。

虽然 `tl.load` 时已经通过 mask 把越界的 K 填成了 0，但这还不够。如果 K 是 0，那么 $q\cdot 0 = 0$，而 softmax 中 score = 0 并不等于忽略这个位置，因为 $e^0 = 1$

因此代码还需要

```python
qk = tl.where(offsets_n < N, qk, -float('inf'))
```

把非法位置的 score 设成负无穷。

---

普通 softmax 可以写成

$$
p_i =
\frac{e^{x_i}}
{\sum_j e^{x_j}}
$$

为了避免指数溢出，通常会先减去最大值

$$
p_i =
\frac{e^{x_i-m}}
{\sum_j e^{x_j-m}}
$$

其中

$$
m =\max_j x_j
$$

如果一次能看到所有 score，这件事非常简单。问题在于，这个 kernel 每次只能看到 32 个 score。假设 N = 96，那么当前 Query 的 score 实际上是分三次出现的

```text
score[0:32]    score[32:64]    score[64:96]
```

第一块处理完时，根本不知道后面的 block 是否会出现更大的值。因此不能简单地对每个 block 独立做 softmax，再把结果拼起来。

代码初始化了三个核心状态

```python
m_i = -float("inf")
l_i = 0.0
acc = tl.zeros([BLOCK_SIZE_D], dtype=tl.float32)
```

它们分别表示

```text
m_i   当前为止见过的最大 score
l_i   当前 softmax 分母
acc   当前 softmax 加权 V 的分子
```

假设第一块 score 是

```text
[1, 2, 3]
```

那么当前最大值变成 3。于是可以计算

$$
[e^{1-3}, e^{2-3}, e^{3-3}]
$$

也就是

$$
[e^{-2}, e^{-1},1]
$$

此时 softmax 的分母是

$$
l_i = e^{-2}+e^{-1}+1
$$

问题出现在下一块。假设第二块突然出现

```text
[4, 5, 10]
```

新的最大值就从 3 变成了 10。第一块之前所有结果都是按照

$$
e^{x-3}
$$

计算的。但为了继续和第二块合并，现在所有历史结果都必须重新转换到以 10 为最大值的表示方式

$$
e^{x-10}
$$

而

$$
e^{x-10}
=
e^{x-3}e^{3-10}
$$

所以不需要重新计算第一块的所有元素，只需要把之前累积的结果统一乘上：

$$
e^{3-10}
$$

更一般地

$$
\alpha = e^{m_{\text{old}}-m_{\text{new}}}
$$

这就是代码 `alpha = tl.exp(m_prev - m_i)` 的由来。

因此 softmax denominator 可以在线更新

```python
p = tl.exp(qk - m_i)  # 当前 block 相对于新最大值计算出来的指数
l_i = l_i * alpha + tl.sum(p, axis=0)
```

实现了

```shell
旧 block 的贡献 × alpha + 当前 block 的贡献
```

这一步解决了“分块情况下如何计算完整 softmax”的问题。但 Attention 最终需要的不是 softmax probability 本身，而是

$$
\operatorname{softmax}(S)V
$$

把公式展开就是

$$
O =
\frac{
\sum_j e^{s_j-m}V_j
}{
\sum_j e^{s_j-m}
}
$$

所以只维护 denominator `l_i` 还不够，还要同步维护

$$
\sum_j e^{s_j-m}V_j
$$

当前 block 中 `p[:, None] * v` 会让当前 32 个 softmax 权重分别乘上对应的 Value：

```text
p0 * V0
p1 * V1
p2 * V2
...
```

随后：

```python
tl.sum(p[:, None] * v, axis=0)
```

得到：

$$
\sum_j p_jV_j
$$

循环结束后

$$
acc =
\sum_j e^{s_j-m}V_j
$$

同时

$$
l_i =
\sum_j e^{s_j-m}
$$

因此

```python
acc = acc / l_i
```

就得到

$$
O =
\frac{
\sum_j e^{s_j-m}V_j
}{
\sum_j e^{s_j-m}
}
$$

也就是标准的

$$
O =\operatorname{softmax}(S)V
$$

---

```python
for i in parallel(range(M)):
    q = Q[i]

    running_max = -inf
    denominator = 0
    numerator = zeros(d)
    for start in range(0, N, 32):
        k = K[start:start + 32]
        v = V[start:start + 32]

        scores = q @ k.T / sqrt(d)
        new_max = max(running_max, scores.max(),)
        alpha = exp(running_max - new_max)
        weights = exp(scores - new_max)
        denominator = (denominator * alpha + weights.sum())

        numerator = (
            numerator * alpha
            + (weights[:, None] * v).sum(dim=0)
        )

        running_max = new_max

    output[i] = numerator / denominator
```

## 附录

- 完整 Triton Attention Kernel 实现

```python
import torch
import triton
import triton.language as tl


@triton.jit
def attention_kernel(
    Q, K, V, output,
    stride_qm, stride_qd,
    stride_kn, stride_kd,
    stride_vn, stride_vd,
    stride_om, stride_od,
    M, N, d,
    sm_scale,
    BLOCK_SIZE_N: tl.constexpr,
    BLOCK_SIZE_D: tl.constexpr,
):
    Q = Q.to(tl.pointer_type(tl.float32))
    K = K.to(tl.pointer_type(tl.float32))
    V = V.to(tl.pointer_type(tl.float32))

    pid = tl.program_id(0)
    offsets_d = tl.arange(0, BLOCK_SIZE_D)
    mask_q = offsets_d < d

    q = tl.load(Q + pid * stride_qm + offsets_d * stride_qd, mask=mask_q, other=0.0)

    m_i = -float('inf')
    l_i = 0.0
    acc = tl.zeros([BLOCK_SIZE_D], dtype=tl.float32)
    for start_n in range(0, N, BLOCK_SIZE_N):
        offsets_n = start_n + tl.arange(0, BLOCK_SIZE_N)
        mask_k = (offsets_n[:, None] < N) & (offsets_d[None, :] < d)
        k = tl.load(K + offsets_n[:, None] * stride_kn + offsets_d[None, :] * stride_kd,
                    mask=mask_k, other=0.0)
        qk = tl.sum(q[None, :] * k, axis=1)
        qk *= sm_scale
        qk = tl.where(offsets_n < N, qk, -float('inf'))

        m_prev = m_i
        block_max = tl.max(qk, axis=0)
        m_i = tl.maximum(m_prev, block_max)
        alpha = tl.exp(m_prev - m_i)
        p = tl.exp(qk - m_i)
        l_i = l_i * alpha + tl.sum(p, axis=0)

        mask_v = (offsets_n[:, None] < N) & (offsets_d[None, :] < d)
        v = tl.load(V + offsets_n[:, None] * stride_vn + offsets_d[None, :] * stride_vd,
                    mask=mask_v, other=0.0)
        acc = acc * alpha + tl.sum(p[:, None] * v, axis=0)

    acc = acc / l_i
    tl.store(output + pid * stride_om + offsets_d * stride_od, acc, mask=mask_q)


# Q, K, V, output are tensors on the GPU
def solve(
    Q: torch.Tensor, K: torch.Tensor, V: torch.Tensor, output: torch.Tensor, M: int, N: int, d: int
):
    sm_scale = d ** -0.5
    grid = (M,)
    BLOCK_SIZE_N = 32
    BLOCK_SIZE_D = triton.next_power_of_2(d)
    attention_kernel[grid](
        Q, K, V, output,
        Q.stride(0), Q.stride(1),
        K.stride(0), K.stride(1),
        V.stride(0), V.stride(1),
        output.stride(0), output.stride(1),
        M, N, d,
        sm_scale,
        BLOCK_SIZE_N=32,
        BLOCK_SIZE_D=triton.next_power_of_2(d),
        num_warps=4,
        num_stages=2
    )
```
