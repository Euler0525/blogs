---
title: Triton 矩阵乘法中的数值稳定性
description: '浮点矩阵乘法的数值结果不仅取决于代数公式，还显著取决于求和树、分块方式和计算精度路径。'
tags:
  - 矩阵乘法
  - 浮点误差
  - 数值稳定性
  - 求和条件数
  - GEMM
  - Triton
categories: 编程
mathjax: true
abbrlink: 59237dbe
date: 2026-08-09 18:25:03
---

> Same Algebra $\not\Rightarrow$ Same Floating-Point Evaluation

## 错误版本

在练习题目 [LeetGPU | Matrix Multiplication](https://leetgpu.com/challenges/matrix-multiplication) 时，首先写了一个非标准的 Triton Kernel

```python
@triton.jit
def matrix_multiplication_kernel_err(
    a, b, c, M, N, K, stride_am, stride_an, stride_bn, stride_bk, stride_cm, stride_ck
):
    m = tl.program_id(axis=0)
    k = tl.program_id(axis=1)

    BLOCK_N: tl.constexpr = 256
    offsets = tl.arange(0, BLOCK_N)

    acc = tl.zeros((BLOCK_N,), dtype=tl.float32)
    for n_start in tl.range(0, N, BLOCK_N):
        n = n_start + offsets
        mask = n < N
        a_value = tl.load(a + m * stride_am + n * stride_an, mask=mask, other=0.0).to(tl.float32)
        b_value = tl.load(b + n * stride_bn + k * stride_bk, mask=mask, other=0.0).to(tl.float32)
        acc += a_value * b_value
    result = tl.sum(acc, axis=0)

    tl.store(c + m * stride_cm + k * stride_ck, result)
```

虽然数学上是在计算 $C_{m, k} = \sum_{n} A_{m, n}B_{n, k}$。令 $p_n = A_{m, n}B_{n, k}$，目标就是求 $\sum p_n$。但是上面代码并没有按顺序累加，实际计算结构是

```shell
acc[0]   = p0   + p256 + p512 + ...
acc[1]   = p1   + p257 + p513 + ...
...
acc[255] = p255 + p511 + p767 + ...

result = tl.sum(acc)
```

它被拆成了 256 条独立的跨步累加链，最后再做一次规约。但是对于 FP32 数据类型来说，有限精度浮点运算实际是

$$
\operatorname{fl}(x \circ y) = (x \circ y)(1+\delta), \quad |\delta|\le u
$$

因此，每做一次加法，就可能发生一次舍入，则 $\operatorname{fl}(\operatorname{fl}(a+b)+c) == \operatorname{fl}(a+\operatorname{fl}(b+c))$ 未必成立，不同的分组顺序会得到不同的局部和，不同的舍入时机就会导致最终结果误差不同。

---

本题的测试用例为 [Matrix Multiplication — Triton 测试用例](https://github.com/Euler0525/leetgpu-challenges/blob/main/challenges/easy/2_matrix_multiplication/solution/triton/test_cases.md)，测试 `matrix_multiplication_kernel_err` 会发现下面测试用例不通过

```shell
functional_14	max_dimensions	8,192 × 6,144 × 4,096	uniform(-1.0, 1.0)
```

该用例的特点是矩阵维度大，元素数值接近 $0$。准确地说，这个用例真正敏感的并不是元素都很接近 0，而是 **输入以 0 为中心、正负号混合，并且内积维度 $N=6144$ 很大**。对任意一个输出元素，仍然记

$$
s = \sum_{n = 0}^{N-1} p_n, \qquad p_n = A_{m, n}B_{n, k}.
$$

衡量求和问题对扰动敏感程度的一个常用量是求和条件数

$$
\kappa_{\mathrm{sum}}
=\frac{\sum_n |p_n|}{\left|\sum_n p_n\right|}
=\frac{\sum_n |p_n|}{|s|}.
$$

如果所有 $p_n$ 基本同号，那么分子和分母量级接近，$\kappa_{\mathrm{sum}}$ 通常不会很大；但这里 $A,B\sim U(-1,1)$，所以 $p_n$ 也是关于 $0$ 对称的随机变量，正负项会大量互相抵消。此时 $\sum |p_n|$ 仍然很大，而最终的 $|s|$ 却可能很小，于是 $\kappa_{\mathrm{sum}}$ 会迅速增大。极端情况下若真实和恰好为 $0$，相对条件数甚至可以视为无穷大。

对独立的 $A_{m,n},B_{n,k}\sim U(-1,1)$，有

$$
\mathbb E [p_n] = 0,\qquad
\mathbb E|p_n|=\frac14,\qquad
\operatorname{Var}(p_n)=\frac19.
$$

因此在 $N=6144$ 时，可以粗略估计

$$
\sum_n |p_n|\approx \frac{N}{4}= 1536,
\qquad
\operatorname{std}(s)=\sqrt{\frac{N}{9}}\approx 26.1.
$$

如果某个输出元素的 $|s|$ 恰好处在一个标准差附近，那么条件数已经约为

$$
\kappa_{\mathrm{sum}}\approx \frac{1536}{26.1}\approx 59.
$$

而输出矩阵共有 $8192\times4096$ 个元素，其中可能会出现一些抵消更严重、$|s|$ 更接近 $0$ 的位置；这些位置的 $\kappa_{\mathrm{sum}}$ 可以达到更高。这时浮点误差就会被条件数放大。对长度为 $N$ 的浮点点积，在经典舍入模型下常见的前向误差估计具有下面的形式

$$
|\widehat{s}-s|
\lesssim
\gamma_N\sum_n |p_n|,
\qquad
\gamma_N =\frac{Nu}{1-Nu},
$$

因此相对误差满足

$$
\frac{|\widehat{s}-s|}{|s|}
\lesssim
\gamma_N\kappa_{\mathrm{sum}}.
$$

这里精确的常数会随乘法是否融合为 FMA、规约树的形状等实现细节变化，但核心项始终是 $\sum|p_n|/|s|$。FP32 的单位舍入误差约为 $u=2^{-24}$，当 $N=6144$ 时 $\gamma_N\approx 3.66\times10^{-4}$；一旦 $\kappa_{\mathrm{sum}}$ 很大，相对误差就可能被明显放大。这也解释了 **灾难性抵消** 为什么重要。抵消本身并不一定额外制造舍入误差，但它会把最终结果压到很小的量级，从而暴露并放大此前乘法、局部累加中已经产生的舍入误差。前面的错误 Kernel 先按 $n\bmod 256$ 把乘积拆成 256 条跨步累加链，再对 256 个局部和做 `tl.sum`：

$$
q_r =\operatorname{fl}\left(\sum_j p_{r+256j}\right),\qquad
\widehat{s}=\operatorname{fl}\left(\sum_{r = 0}^{255}q_r\right).
$$

这种求和树与 PyTorch/CUDA GEMM 参考实现采用的计算路径并不相同。由于浮点加法不满足结合律，不同分组会在不同位置进行舍入；当某个输出元素又恰好具有很大的 $\kappa_{\mathrm{sum}}$ 时，本来只有几个 ULP(Unit in the Last Place) 的局部差异就可能被放大成明显的相对误差，最终越过测试的允许误差。

所以，这个大尺寸随机用例容易暴露问题，本质上是三个因素叠加：**内积很长、数据正负混合导致强抵消、实现改变了求和树**。

## 修正版本

参考官方的 Triton GEMM 写法，我又写了一个 分块版本的二维矩阵乘法核并且通过了 [Matrix Multiplication — Triton 测试用例](https://github.com/Euler0525/leetgpu-challenges/blob/main/challenges/easy/2_matrix_multiplication/solution/triton/test_cases.md)

```python
@triton.jit
def matrix_multiplication_kernel(
    a, b, c, M, N, K,
    stride_am, stride_an, stride_bn, stride_bk, stride_cm, stride_ck,
    BLOCK_M: tl.constexpr,
    BLOCK_N: tl.constexpr,
    BLOCK_K: tl.constexpr,
):
    pid = tl.program_id(axis=0)
    num_pid_k = tl.cdiv(K, BLOCK_K)
    pid_m = pid // num_pid_k
    pid_k = pid % num_pid_k

    offsets_m = pid_m * BLOCK_M + tl.arange(0, BLOCK_M)
    offsets_k = pid_k * BLOCK_K + tl.arange(0, BLOCK_K)
    offsets_n = tl.arange(0, BLOCK_N)

    a_ptrs = a + offsets_m[:, None] * stride_am + offsets_n[None, :] * stride_an
    b_ptrs = b + offsets_n[:, None] * stride_bn + offsets_k[None, :] * stride_bk
    acc = tl.zeros((BLOCK_M, BLOCK_K), dtype=tl.float32)

    for n_start in range(0, N, BLOCK_N):
        a_values = tl.load(
            a_ptrs,
            mask=(offsets_m[:, None] < M) & (offsets_n[None, :] + n_start < N),
            other=0.0,
        )
        b_values = tl.load(
            b_ptrs,
            mask=(offsets_n[:, None] + n_start < N) & (offsets_k[None, :] < K),
            other=0.0,
        )
        acc += tl.dot(a_values, b_values, input_precision="ieee")
        a_ptrs += BLOCK_N * stride_an
        b_ptrs += BLOCK_N * stride_bn

    c_ptrs = c + offsets_m[:, None] * stride_cm + offsets_k[None, :] * stride_ck
    tl.store(c_ptrs, acc, mask=(offsets_m[:, None] < M) & (offsets_k[None, :] < K))
```

计算图是 $C_{\text{tile}} = D_0 + D_1 + D_2 + \cdots$，其中 $D_i = \operatorname{dot}(A_{\text{tile}_i}, B_{\text{tile}_i})$.

这里的 `tl.dot` 不是对两个向量做一次标量点积，而是对两个 **二维 block 做小型矩阵乘法**。对当前 Kernel 的记号，设第 $i$ 次循环覆盖归约维度上的区间

$$
I_i =[i\cdot BLOCK_N,(i+1)\cdot BLOCK_N),
$$

那么加载到 SRAM/寄存器语义中的两个 block 可以写成

$$
A_i\in\mathbb R^{BLOCK_M\times BLOCK_N},\qquad
B_i\in\mathbb R^{BLOCK_N\times BLOCK_K}.
$$

`tl.dot(a_values, b_values, input_precision="ieee")` 返回一个

$$
D_i = A_iB_i\in\mathbb R^{BLOCK_M\times BLOCK_K}
$$

的 block。展开到单个输出位置 $(r,c)$，它所做的工作就是

$$
(D_i)_{r, c}
=\sum_{j = 0}^{BLOCK_N-1}(A_i)_{r, j}(B_i)_{j, c}.
$$

因此整个 Kernel 的计算图可以写成

```text
A_0 [BM×BN] ─┐
             ├─ tl.dot ─> D_0 [BM×BK] ─┐
B_0 [BN×BK] ─┘                         │
                                       ├─ + ─> acc_1
A_1 [BM×BN] ─┐                         │
             ├─ tl.dot ─> D_1 [BM×BK] ─┘
B_1 [BN×BK] ─┘

acc_0 = 0
acc_1 = fl(acc_0 + D_0)
acc_2 = fl(acc_1 + D_1)
...
acc_T = fl(acc_{T-1} + D_{T-1})
C_tile = acc_T
```

其中

$$
T =\left\lceil\frac{N}{BLOCK_N}\right\rceil.
$$

也就是说，一个 Triton program instance 不再只计算一个标量 $C_{m,k}$，而是一次负责输出矩阵中的一个 $BLOCK_M\times BLOCK_K$ tile。每轮循环沿着归约维 $N$ 取一块连续的 $A_i$ 和 $B_i$，`tl.dot` 同时产生这一整块输出的部分和，然后外层循环继续把各个 $D_i$ 累加到 FP32 的 `acc` 中。这正是典型 blocked GEMM 的结构：

$$
C_{\mathrm{tile}}
= A_0B_0+A_1B_1+\cdots+A_{T-1}B_{T-1}.
$$

从数值角度看，这个版本仍然没有摆脱浮点非结合性：`tl.dot` 内部的乘加顺序以及不同 $D_i$ 之间的累加仍然会产生舍入。但是它有两个重要区别。

第一，`acc` 明确使用 `tl.float32`，所以各个 block 的结果在整个归约过程中都保留在 FP32 累加器中。Triton 官方 GEMM 教程采用的也是“加载 $A/B$ block → `tl.dot` → 累加到 FP32 accumulator”的结构。

第二，当前输入本身就是 FP32，而 Triton 在 NVIDIA GPU 上对 f32×f32 的 `tl.dot` 默认可能采用 TF32 输入精度。这里显式指定

```python
input_precision="ieee"
```

表示要求 f32 点积使用 IEEE 精度路径，而不是默认的 TF32 输入精度，从而避免先把 FP32 输入有效尾数压缩到 TF32 精度后再做矩阵乘。需要注意，这个参数描述的是 `tl.dot` 的输入计算精度；具体最终 lower 成什么指令序列仍取决于 Triton 版本和目标硬件，不能仅凭 Python 代码把它理解成某一种固定的机器指令。

把两个版本放在一起看，它们的差别可以概括为：

```text
错误版本：
    p_n
     │
     ├─ 按 n mod 256 分成 256 条跨步链
     │      q_0, q_1, ..., q_255
     └─ tl.sum(q) -> C[m, k]

分块 GEMM：
    连续的归约区间 I_0, I_1, ...
     │
     ├─ A_i × B_i --tl.dot--> D_i（一个输出 tile 的部分和）
     │
     └─ FP32 acc = D_0 + D_1 + ... -> C_tile
```

后者使用了 Triton 专门为矩阵乘提供的 block-level `tl.dot` ，计算组织方式也与常规高性能 GEMM 更一致。

## 参考资料

[LeetGPU | Matrix Multiplication](https://leetgpu.com/challenges/matrix-multiplication)

[Triton's documentation | Group GEMM](https://triton-lang.org/main/getting-started/tutorials/08-grouped-gemm.html)

[Triton's documentation | Matrix Multiplication](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html)

[Triton 中文站 | 分组 GEMM](https://triton.hyper.ai/docs/getting-started/tutorials/group-gemm)

[Triton's documentation | triton.language.dot](https://triton-lang.org/main/python-api/generated/triton.language.dot.html)

[NVIDIA | Floating Point and IEEE 754](https://docs.nvidia.com/cuda/floating-point/index.html)
