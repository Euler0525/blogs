---
title: CUDA性能优化
tags:
  - CUDA
  - 共享内存
  - 局部性原理
categories: 编程
abbrlink: e94de802
date: 2026-02-27 11:15:56
---

> 以 [LeetGPU-Matrix Multiplication](https://leetgpu.com/challenges/matrix-multiplication) 为例
>
> ```c++
> #include <cuda_runtime.h>
> 
> __global__ void matrix_multiplication_kernel(const float* A, const float* B, float* C, int M, int N, int K) {
> 
> }
> 
> // A, B, C are device pointers (i.e. pointers to memory on the GPU)
> extern "C" void solve(const float* A, const float* B, float* C, int M, int N, int K) {
>  dim3 threadsPerBlock(16, 16);
>  dim3 blocksPerGrid((K + threadsPerBlock.x - 1) / threadsPerBlock.x,
>                     (M + threadsPerBlock.y - 1) / threadsPerBlock.y);
> 
>  matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M, N, K);
>  cudaDeviceSynchronize();
> }

性能演进如下图所示

``` shell
性能 (GFLOPS, V100 FP32)
    ↑
7000|                              ████████████ cuBLAS/Cutlass
    |                              ████████████ (Tensor Core + 汇编)
    |
1000|                    ████████ async/wmma
    |                    ████████ (异步拷贝 + 矩阵指令)
    |
 650|          ████████ 寄存器/occupancy 调优
    |          ████████ (指令调度 + 延迟隐藏)
    |
 500|     ████ 向量化加载
    |     ████ (float4, 128-bit 事务)
    |
 300|  ████ Bank Conflict 优化
    |  ████ (padding, 避免共享内存冲突)
    |
  50|██ 基础共享内存 Tiling
    |██ (减少全局内存访问)
    |
   5|█ 基础全局内存 Kernel
    +--------------------------------→ 优化层级
      1   2    3      4        5         6           7
      
Level 1: 如何让 GPU 并行计算？  → 线程映射
Level 2: 如何减少慢速内存访问？  → 共享内存复用
Level 3: 如何避免共享内存冲突？  → Bank 对齐
Level 4: 如何提升内存事务效率？  → 向量化加载
Level 5: 如何隐藏计算/内存延迟？ → Occupancy 调优
Level 6: 如何利用专用硬件加速？  → Tensor Core + Async
Level 7: 如何工程化交付高性能？  → 库函数 + Autotune
```

---

## 基础全局内存 Kernel

> 线程映射、内存索引、并行执行。

``` c++
__global__ void matmul_base(const float * A, const float* B, float* C, int M, int N, int K) {
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    if (row >= M || col >= K) {
        return;
    }

    float acc = 0.0f;
    for (int i = 0; i < N; ++i) {
        acc += A[row * N + i] * B[i * K + col];  // 每次都访问全局内存
    }
    C[row * K + col] = acc;
}
```

上面这种访问内存的方法，

- 对于单个线程内部，`x,y` 固定，`i` 变化，则 `A` 的访问缓存友好；

- 在 CUDA 硬件中，`threadIdx.x` 是变化最快的维度，因此同一个 Warp 内的线程，其 `x` 坐标必然是连续（或分段连续）的，而 `y` 坐标相对稳定。分析合并访问时，对于 Warp 级别，同一循环迭代（`i` 相同），`A` 访问的地址相同（广播），`B` 访问的地址连续（合并访问）

`A` 的内存访问方式，依赖 L1 缓存广播，如果 N 过大，`A` 的一行可能超出 L1 缓存，导致缓存抖动，修改为下面这种共享内存的访问方式，

|  访问模式  |        代码        |           硬件行为            |       问题       |
| :--------: | :----------------: | :---------------------------: | :--------------: |
| **A 访问** |  `A[row * N + i]`  | 同 warp 内线程读 **相同地址** | 广播依赖 L1 缓存 |
| **B 访问** |  `B[i * K + col]`  | 同 warp 内线程读 **连续地址** |     合并访问     |
| **C 写入** | `C[row * K + col]` | 同 warp 内线程写 **连续地址** |     合并写入     |

性能瓶颈在于全局内存访问次数

- `A`：$M\times K\times N$ 次读取，实际数据量 $M\times N\rightarrow K$ 倍冗余；

- `B`：$M\times N\times K$ 次读取，实际数据量 $N\times K\rightarrow M$ 倍冗余；

## 共享内存 Tiling

> 通过共享内存复用数据，减少全局内存访问。

``` c++
#define TILE_SIZE 16
__global__ void matmul_tiled(const float * A, const float* B, float* C, int M, int N, int K) {
    int row = blockDim.y * blockIdx.y + threadIdx.y;  // [0, M)
    int col = blockDim.x * blockIdx.x + threadIdx.x;  // [0, K)
    if (row >= M || col >= K) {
        return;
    }

    __shared__ float As [TILE_SIZE][TILE_SIZE];
    __shared__ float Bs [TILE_SIZE][TILE_SIZE];

    float acc = 0.0f;
    int num_tiles = (N + TILE_SIZE - 1) / TILE_SIZE;

    for (int i = 0; i < num_tiles; ++i) {
        // 每个线程加载 1 个元素到 shared memory
        int a_col = i * TILE_SIZE + threadIdx.x;
        int b_row = i * TILE_SIZE + threadIdx.y;

        As [threadIdx.y][threadIdx.x] = (a_col < N) ? A[row * N + a_col] : 0.0f;  // Boundary Filling
        Bs [threadIdx.y][threadIdx.x] = (b_row < N) ? B[b_row * K + col] : 0.0f;

        __syncthreads();

        #pragma unroll
        for (int k = 0; k < TILE_SIZE; ++k) {
            acc += As [threadIdx.y][k] * Bs [k][threadIdx.x];
        }
        
        __syncthreads();
    }
    if (row < M && col < K) {
        C[row * K + col] = acc;
    }
}
```

以 `TILE_SIZE=16` 为例，将 $N$ 维度分成 $N/TILE\_SIZE$ 个块，然后每个 block 的 `16×16` 线程协作

1. 加载 `A` 的 `16×16` 子块 和 `B` 的 `16×16` 子块 到 Shared Memory
2. `16×16` 线程并行计算 `16×16` 次乘加
3. 重复 $N/TILE\_SIZE$ 次

最终的数据复用效果是全局内存访问减少 16 倍

- `A` 的每个元素被 block 内 16 个线程复用（同一行的不同列）

- `B` 的每个元素被 block 内 16 个线程复用（同一列的不同行）

## Bank Conflict 优化

> 避免多个线程同时访问同一 Memory Bank，导致串行化。
>
> **Shared Memory Bank**
>
> GPU 共享内存物理结构分为 32 个 bank，每个 bank 每周期可服务 1 个 4B 访问，32 个连续 float 地址分布到 32 个 bank：
>
> ``` shell
> addr:  0   1   2  ...  31  32  33  ...
> bank: [0] [1] [2] ... [31] [0] [1] ...
> ```
>
> - 无冲突访问：warp 内 32 线程访问 32 个不同 bank， 1 周期完成
> - 有冲突访问：warp 内多个线程访问同一 bank ， 串行执行，周期数 = 冲突线程数

Tiling kernel 中的共享内存访问为

``` c++
#pragma unroll
for (int k = 0; k < TILE_SIZE; ++k) {
    acc += As [threadIdx.y][k] * Bs [k][threadIdx.x];
}
```

在访问时，同 warp 内：`threadIdx.x` 变化快，`threadIdx.y` 相对固定；

在计算时：固定 k，不同 `threadIdx.y` 访问 `As [0][k], As [1][k], As [2][k]...`，对应的地址计算为

``` c++
&As [threadIdx.y][k] = base + threadIdx.y * (TILE_SIZE) * 4 + k * 4
```

若 $TILE\_SIZE = 16$，地址间隔为$64B=2\times 32B$，Memory Bank索引为

``` c++
(base / 4 + threadIdx.y * 16 + k) % 32
```

结果导致`threadIdx.y = 0` 和 `threadIdx.y = 2` 索引相同，访问同一 Memory Bank，发生冲突！

可以采用添加Padding的方案，使列间距不是32的倍数

``` c++
__shared__ float As [TILE_SIZE][TILE_SIZE + PADDING];  // PADDING = 8
```

这种方案可以消除Bank Conflict，但是会增加共享内存占用，降低占用率

## 向量化内存访问

> 让每次内存请求携带更多有效数据，提升带宽利用率。
>
> **GPU 内存事务**
>
> GPU 全局内存访问特性为
>
> - 最小事务粒度：32 字节 (L1 cache line) 或 128 字节 (L2)
> - warp 内 32 线程访问连续 128 字节 → 1 个 128B 事务（高效访问）
> - warp 内 32 线程访问分散地址 → 多个事务（低效访问）
>

``` c++
// 标量加载, 每次 4B
As [threadIdx.y][threadIdx.x] = A[row * N + base_col + threadIdx.x];

// float4 向量化加载, 每次 16B
int base_idx = row * N + tile_idx * TILE_SIZE + threadIdx.x * VEC_WIDTH;
if (base_idx + VEC_WIDTH <= N) {
    const float4* a_vec = reinterpret_cast <const float4*>(&A [base_idx]);
    float4 val = *a_vec;  // 读取 16B

    As [threadIdx.y][threadIdx.x + 0] = val.x;
    As [threadIdx.y][threadIdx.x + 1] = val.y;
    As [threadIdx.y][threadIdx.x + 2] = val.z;
    As [threadIdx.y][threadIdx.x + 3] = val.w;
}
```

对于 warp 加载 32 个 float，共 128B

标量方式：

- 32 条 `ld.global.f32` 指令
- 硬件合并：128B 连续地址 → 1 个 128B 事务
- 指令解码/调度开销：32 条指令

向量化方式：

- 8 条 `ld.global.v4.f32` 指令
- 硬件合并：8×16B = 128B → 1 个 128B 事务
- 指令开销：8 条指令

## 寄存器与 Occupancy 调优

> **延迟隐藏与资源平衡**：
>
> Occupancy = 活跃 warp 数 / 理论最大 warp 数；通过增加并发 warp 数，隐藏内存/计算延迟。
