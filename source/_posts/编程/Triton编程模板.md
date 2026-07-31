---
title: Triton 编程模板
description: '以向量加法为例，讲解 Triton Kernel、启动网格、块内索引、边界掩码、PyTorch 包装、正确性验证和性能测试的一般写法。'
tags:
  - Triton
  - GPU
  - CUDA
categories:
  - 编程
mathjax: true
abbrlink: 27f68a41
date: 2026-08-03 15:15:15
---

Triton 是一种面向 GPU Kernel 的编程语言和编译器。与 CUDA 直接围绕线程、线程块编程不同，Triton 更强调 **一个 Program Instance 处理一个数据块（Tile）**：程序员描述块内数据的索引、加载、计算和写回，编译器负责将这些块级操作映射到 GPU 线程上。

一个完整、可维护的 Triton 算子通常由以下部分组成：

1. 使用 `@triton.jit` 定义设备端 Kernel；
2. 根据 Program ID 构造当前数据块的索引；
3. 使用 Mask 保护不完整的边界块；
4. 编写 Python Wrapper，检查输入、分配输出并配置启动网格；
5. 与 PyTorch 参考实现比较，验证正确性；
6. 预热并重复测量，统计可靠的性能数据。

本文以一维向量加法为例，提炼这种代码的一般形式。

## Triton 的执行模型

假设向量包含 $N$ 个元素，每个 Triton Program 处理 `BLOCK_SIZE` 个元素，那么需要启动的 Program 数量为

$$
N_{programs}=\left\lceil\frac{N}{BLOCK\_SIZE}\right\rceil
$$

Program 与数据的关系如下：

```text
Program 0 -> [0, BLOCK_SIZE)
Program 1 -> [BLOCK_SIZE, 2 * BLOCK_SIZE)
Program 2 -> [2 * BLOCK_SIZE, 3 * BLOCK_SIZE)
...
```

这里的 Program 不等价于 CUDA 中的单个线程，更接近一个负责 Tile 的逻辑执行实例。`tl.program_id(axis=0)` 返回当前 Program 在启动网格第 0 维上的编号，`tl.arange` 则一次产生整个块的局部索引。

当 $N$ 不是 `BLOCK_SIZE` 的整数倍时，最后一个 Program 会覆盖超出张量范围的地址。因此，几乎所有非整齐分块的 Kernel 都需要边界 Mask。

## 模板

下面的向量加法包含 Kernel、启动函数和用户接口三层。

> 分出 `_launch_add` 的原因是正常调用需要创建输出，而性能测试通常需要复用预分配的输出，以免把内存分配时间混入 Kernel 时间。

```python
import torch
import triton
import triton.language as tl


@triton.jit
def add_kernel(
    x_ptr,
    y_ptr,
    output_ptr,
    n_elements,
    BLOCK_SIZE: tl.constexpr,
):
    block_start = tl.program_id(axis=0) * BLOCK_SIZE
    offsets = block_start + tl.arange(0, BLOCK_SIZE)
    mask = offsets < n_elements

    x = tl.load(x_ptr + offsets, mask=mask)
    y = tl.load(y_ptr + offsets, mask=mask)
    output = x + y
    tl.store(output_ptr + offsets, output, mask=mask)


def _launch_add(
    x: torch.Tensor,
    y: torch.Tensor,
    output: torch.Tensor,
) -> None:
    n_elements = output.numel()
    if n_elements == 0:
        return

    grid = lambda meta: (
        triton.cdiv(n_elements, meta["BLOCK_SIZE"]),
    )
    add_kernel[grid](
        x,
        y,
        output,
        n_elements,
        BLOCK_SIZE=256,
    )


def triton_add(x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    if not (x.is_cuda and y.is_cuda):
        raise ValueError("x and y must be CUDA tensors")
    if x.shape != y.shape:
        raise ValueError("x and y must have the same shape")
    if x.device != y.device:
        raise ValueError("x and y must be on the same device")
    if x.dtype != y.dtype:
        raise ValueError("x and y must have the same dtype")
    if not (x.is_contiguous() and y.is_contiguous()):
        raise ValueError("x and y must be contiguous")

    output = torch.empty_like(x)
    _launch_add(x, y, output)

    return output
```

### Kernel 签名

```python
@triton.jit
def add_kernel(
    x_ptr,
    y_ptr,
    output_ptr,
    n_elements,
    BLOCK_SIZE: tl.constexpr,
):
```

`@triton.jit` 表示该函数由 Triton 即时编译并在 GPU 上执行。传入的 PyTorch CUDA Tensor 会根据其 `data_ptr()` 和 `dtype` 转换为设备指针。

Kernel 参数可以分成两类：

- **运行时参数**：输入输出指针、张量尺寸和 Stride 等；
- **编译期元参数**：块大小、流水级数或某个算法开关等，通常标记为 `tl.constexpr`。

`BLOCK_SIZE` 参与 `tl.arange(0, BLOCK_SIZE)` 的形状构造，所以必须在编译期确定。相比之下，`n_elements` 只参与运行时边界判断，不应该随意标为 `tl.constexpr`，否则不同长度可能生成不同的编译版本，增加编译和缓存开销。

### 块内索引与指针运算

一维 Kernel 最常见的索引模板是：

```python
pid = tl.program_id(axis=0)
offsets = pid * BLOCK_SIZE + tl.arange(0, BLOCK_SIZE)
```

`pid * BLOCK_SIZE` 是当前块的起始位置，`tl.arange` 产生块内向量索引。于是 `offsets` 不是单个整数，而是包含 `BLOCK_SIZE` 个元素的 Triton Tensor。

Triton 使用显式指针运算描述访存位置：

```python
x = tl.load(x_ptr + offsets, mask=mask)
tl.store(output_ptr + offsets, output, mask=mask)
```

这与 C/CUDA 中的指针偏移类似，但一次构造和访问的是一组地址。连续的 `offsets` 通常可以形成合并访存（Coalesced Access）。如果输入不是连续布局，就需要把维度索引与 Stride 组合到地址表达式中，而不能简单地把张量当作扁平连续数组。

### 边界 Mask

边界 Mask 的典型写法是：

```python
mask = offsets < n_elements
x = tl.load(x_ptr + offsets, mask=mask, other=0.0)
tl.store(output_ptr + offsets, output, mask=mask)
```

只计算 `mask` 而不把它传给 `tl.load` 和 `tl.store` 没有任何效果。越界读可能得到非法数据甚至触发运行错误，越界写则可能破坏其他张量的内容。

对于加法，越界位置不会被存储，因此 Load 的 `other` 值并不参与有效输出，可以省略。对于归约、矩阵乘法等运算，越界填充值会参与中间计算，此时必须根据运算选择单位元，例如：

- 求和或矩阵乘法使用 `other=0.0`；
- 求最大值通常使用负无穷；
- 求最小值通常使用正无穷。

### 启动网格与元参数

Triton Kernel 通过以下语法启动：

```python
add_kernel[grid](
    x,
    y,
    output,
    n_elements,
    BLOCK_SIZE=256,
)
```

`grid` 描述需要创建多少个 Program Instance。它既可以是一个元组，也可以是一个根据元参数计算网格形状的函数：

```python
grid = (triton.cdiv(n_elements, 256),)
```

或者：

```python
grid = lambda meta: (
    triton.cdiv(n_elements, meta["BLOCK_SIZE"]),
)
```

第二种形式使网格与 `BLOCK_SIZE` 保持关联。当块大小以后改为自动调优参数时，不需要同步修改网格计算。

Triton Kernel 的启动是异步的。Wrapper 返回 Tensor 时，GPU 计算可能仍在进行；后续有数据依赖的 GPU 操作会在同一 Stream 上保持正确顺序。只有在 CPU 必须读取结果或进行手工计时时，才需要显式同步。

### Python Wrapper

Kernel 本身应专注于 GPU 上的数据处理，而 Python Wrapper 负责建立一个安全、易用的算子接口，通常包括：

- 检查设备、形状、Dtype 和内存布局；
- 计算元素数量、维度与 Stride；
- 分配输出 Tensor；
- 处理空 Tensor 等无需启动 Kernel 的情况；
- 计算启动网格并传入元参数。

例如，Kernel 按连续一维布局生成地址，如果 Wrapper 接受非连续 Tensor，程序即使没有报错，也会读取错误的位置。另一种处理方式是在 Kernel 中显式接收 Stride，从而支持更一般的布局。

### 正确性验证

自定义 Kernel 首先要证明结果正确，再讨论性能。最直接的方式是与 PyTorch 参考实现比较：

```python
def test_correctness() -> None:
    torch.manual_seed(0)

    # 257 和 100_003 用于覆盖不完整的尾块
    for size in (0, 1, 257, 100_003):
        x = torch.randn(size, device="cuda", dtype=torch.float32)
        y = torch.randn_like(x)

        actual = triton_add(x, y)
        expected = x + y
        torch.testing.assert_close(actual, expected)
```

测试尺寸不应只有 `BLOCK_SIZE` 的整数倍。建议至少覆盖：

- 空输入和单元素输入；
- 小于一个块的输入；
- 比一个块多一个元素的输入；
- 较大的非整齐尺寸；
- 算子支持的不同 Dtype；
- 极大值、极小值、零、无穷和 NaN 等特殊数据。

浮点运算还要根据算法选择合理的 `rtol` 和 `atol`。包含归约的 Kernel 可能改变加法顺序，因此不一定与参考实现逐位相等。

### 性能测试

GPU 基准不能只执行一次，也不应把首次 JIT 编译、输出分配和异步调度混在一起。对于向量加法，可以预分配输出，并对 PyTorch 和 Triton 使用相同的测试条件：

```python
def benchmark(size: int = 1 << 24) -> None:
    x = torch.randn(size, device="cuda", dtype=torch.float32)
    y = torch.randn_like(x)
    torch_output = torch.empty_like(x)
    triton_output = torch.empty_like(x)

    options = {
        "warmup": 100,
        "rep": 500,
        "quantiles": [0.2, 0.5, 0.8],
        "fast_flush": True,
    }

    torch_times = triton.testing.do_bench(
        lambda: torch.add(x, y, out=torch_output),
        **options,
    )
    triton_times = triton.testing.do_bench(
        lambda: _launch_add(x, y, triton_output),
        **options,
    )

    bytes_moved = 3 * size * x.element_size()

    def gbps(median_ms: float) -> float:
        return bytes_moved / (median_ms * 1e-3) / 1e9

    for name, times in (
        ("PyTorch", torch_times),
        ("Triton", triton_times),
    ):
        p20_ms, median_ms, p80_ms = times
        spread = (p80_ms - p20_ms) / median_ms * 100
        print(
            f"{name}: median={median_ms:.3f} ms, "
            f"p20={p20_ms:.3f} ms, p80={p80_ms:.3f} ms, "
            f"spread={spread:.1f}%, {gbps(median_ms):.1f} GB/s"
        )
```

这段基准遵循几个原则：

1. **排除内存分配**：两种实现都复用输出 Tensor，只测算子执行；
2. **先预热再采样**：排除 JIT 编译、缓存初始化和 GPU 升频阶段；
3. **使用分位数**：中位数比均值更不容易被系统抢占等长尾样本干扰，p20 和 p80 用于观察波动；
4. **明确缓存条件**：`fast_flush=True` 冲刷 L2，更接近 DRAM 带宽测试；
5. **统计实际数据流量**：向量加法读取 `x`、读取 `y`、写入 `output`，因此是三个 Tensor 的字节数；
6. **统一单位**：GPU 规格通常使用十进制 GB/s，即 $10^9$ Byte/s，而不是 GiB/s。

单个尺寸不足以描述全部性能。小张量通常受 Launch Latency 限制，大张量才更容易进入带宽饱和区。正式性能报告应扫描一组对数递增的尺寸，并使用 `triton.testing.perf_report` 绘制性能曲线。

## 二维模板

二维问题仍遵循相同骨架，只是启动网格和地址计算扩展到两个维度：

```python
pid_m = tl.program_id(axis=0)
pid_n = tl.program_id(axis=1)

offsets_m = pid_m * BLOCK_SIZE_M + tl.arange(0, BLOCK_SIZE_M)
offsets_n = pid_n * BLOCK_SIZE_N + tl.arange(0, BLOCK_SIZE_N)

mask = (offsets_m[:, None] < M) & (offsets_n[None, :] < N)
ptrs = base_ptr + offsets_m[:, None] * stride_m \
                + offsets_n[None, :] * stride_n
```

二维网格可以写成：

```python
grid = (
    triton.cdiv(M, BLOCK_SIZE_M),
    triton.cdiv(N, BLOCK_SIZE_N),
)
```

矩阵乘法、Softmax 和归约的复杂性主要来自块内算法、访存重用及数值稳定性，但其外层仍然是“Program ID → Tile 索引 → Load → Compute → Store”的结构。

## 自动调优

固定的 `BLOCK_SIZE` 适合教学和简单算子。当性能明显依赖输入形状、Warp 数或流水级数时，可以使用 `@triton.autotune`：

```python
@triton.autotune(
    configs=[
        triton.Config({"BLOCK_SIZE": 128}, num_warps=4),
        triton.Config({"BLOCK_SIZE": 256}, num_warps=4),
        triton.Config({"BLOCK_SIZE": 512}, num_warps=8),
    ],
    key=["n_elements"],
)
@triton.jit
def kernel(..., n_elements, BLOCK_SIZE: tl.constexpr):
    ...
```

自动调优器会针对给定 Key 尝试候选配置并缓存较优结果。它不是所有 Kernel 的必需部分：候选配置过多会增加首次运行时间，Key 选择过细也可能导致频繁重新调优。此外，调优期间 Kernel 会执行多次；如果 Kernel 会原地累加或修改状态，需要使用 `reset_to_zero`、`restore_value` 或 Hook 保证各候选配置在相同初始条件下测量。

## 总结

Triton Kernel 的通用模板可以压缩成下面这条主线：

```text
定义 JIT Kernel
    ↓
Program ID 映射到数据 Tile
    ↓
构造指针与边界 Mask
    ↓
Load → Compute → Store
    ↓
Python Wrapper 校验、分配并启动
    ↓
参考实现验证正确性
    ↓
预热、重复采样并报告稳健统计量
```

## 参考资料

- [Triton 官方教程：Vector Addition](https://triton-lang.org/main/getting-started/tutorials/01-vector-add.html)
- [Triton Python API](https://triton-lang.org/main/python-api/triton.html)
- [`triton.jit` API](https://triton-lang.org/main/python-api/generated/triton.jit.html)
- [`triton.autotune` API](https://triton-lang.org/main/python-api/generated/triton.autotune.html)
- [Triton 官方教程：Matrix Multiplication](https://triton-lang.org/main/getting-started/tutorials/03-matrix-multiplication.html)
