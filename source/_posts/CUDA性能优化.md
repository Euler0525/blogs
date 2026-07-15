---
title: CUDA性能优化
description: '以矩阵乘法为例记录 CUDA 性能优化路径，从基础全局内存 kernel 到共享内存 tiling、bank conflict、向量化访问和 occupancy 调优。'
tags:
  - CUDA
  - 并行编程
  - 共享内存
  - 局部性原理
categories: 编程
abbrlink: e94de802
date: 2026-02-27 11:15:56
---

## 并行编程

> 以 [LeetGPU | Reduction](https://leetgpu.com/challenges/reduction) 为例

### 单线程串行求和

只有一个 GPU 线程工作

```c++
#include <cuda_runtime.h>

__global__ void reduceKernel(const float *input, float *output, int N) {
    float ans = 0.0;
    for (int i = 0; i < N; ++i) {
        ans += input[i];
    }

    output[0] = ans;
}

extern "C" void solve(const float *input, float *output, int N) {
    if (N <= 0) {
        cudaMemset(output, 0, sizeof(float));
        return;
    }

    reduceKernel<<<1, 1>>>(input, output, N);
}
```

### 多线程并行读取

最直接的并行化方式是每个线程处理若干个元素，每个线程计算一个局部和，然后使用 `atomicAdd` 加到最终结果。

相比单线程版本，它能够并行读取输入，但是每个线程都会进行一次原子操作，竞争严重。

```c++
#include <cuda_runtime.h>

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    float sum = 0.0f;
    sum += input[idx];
    atomicAdd(output, sum);
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = 256;
    int BlocksPerGrid = (N + ThreadsPerBlock - 1) / ThreadsPerBlock;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```

### 块内规约

每个线程将局部计算的结果写入共享内存，每个 Block 内先完成树形规约，这样就可以将原子加操作数量从线程数下降到块数。不过规约的每一层都需要执行 `__syncthreads()`

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];
    float sum = 0.0f;
    sum += input[idx];
    shared[threadIdx.x] = sum;
    __syncthreads();

    // All values are reduced to shared [0] per block
    for (int offset = BLOCK_SIZE / 2; offset > 0; offset >>= 1) {
        if (offset > threadIdx.x) {
            shared[threadIdx.x] += shared[threadIdx.x + offset];
        }
        __syncthreads();
    }

    if (threadIdx.x == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int BlocksPerGrid = (N + ThreadsPerBlock - 1) / ThreadsPerBlock;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```

也可以让一个线程读取两个元素，这样可以减少块数

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];
    float sum = 0.0f;

    if (idx < N) {
        sum += input[idx];
    }
    if (idx + BLOCK_SIZE < N) {
        sum += input[idx + BLOCK_SIZE];
    }

    shared[threadIdx.x] = sum;
    __syncthreads();

    // All values are reduced to shared [0] per block
    for (int offset = BLOCK_SIZE / 2; offset > 0; offset >>= 1) {
        if (offset > threadIdx.x) {
            shared[threadIdx.x] += shared[threadIdx.x + offset];
        }
        __syncthreads();
    }

    if (threadIdx.x == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;

    reduceKernel<<<BlocksPerGrid, BLOCK_SIZE>>>(input, output, N);
}
```



### 网格步长循环

每个线程不再只读取一两个元素，而是按整个网格的跨度连续处理多个元素。这样可以使用固定数量的块处理任意长度的输入，每个线程循环处理多个元素。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    int stride = blockDim.x * gridDim.x * 2;
    __shared__ float shared[BLOCK_SIZE];
    float sum = 0.0f;

    // Grid-Stride Loop
    for (int i = idx; i < N; i += stride) {
        sum += input[i];

        if (i + BLOCK_SIZE < N) {
            sum += input[i + BLOCK_SIZE];
        }
    }

    shared[threadIdx.x] = sum;
    __syncthreads();

    // All values are reduced to shared [0] per block
    for (int offset = BLOCK_SIZE / 2; offset > 0; offset >>= 1) {
        if (offset > threadIdx.x) {
            shared[threadIdx.x] += shared[threadIdx.x + offset];
        }
        __syncthreads();
    }

    if (threadIdx.x == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;
    BlocksPerGrid = BlocksPerGrid > 1024 ? 1024 : BlocksPerGrid;

    reduceKernel<<<BlocksPerGrid, BLOCK_SIZE>>>(input, output, N);
}
```

### 规约

同一个 warp 内的线程同步执行，可以使用 `__shfl_down_sync` 在线程寄存器之间交换数据，不需要共享内存和 `__syncthreads`.

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__device__ __forceinline__ float warpReduceSum(float value) {
    value += __shfl_down_sync(0xffffffff, value, 16);
    value += __shfl_down_sync(0xffffffff, value, 8);
    value += __shfl_down_sync(0xffffffff, value, 4);
    value += __shfl_down_sync(0xffffffff, value, 2);
    value += __shfl_down_sync(0xffffffff, value, 1);

    return value;
}

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    int stride = blockDim.x * gridDim.x * 2;
    __shared__ float shared[BLOCK_SIZE];
    float sum = 0.0f;

    for (int i = idx; i < N; i += stride) {
        sum += input[i];

        if (i + BLOCK_SIZE < N) {
            sum += input[i + BLOCK_SIZE];
        }
    }

    shared[threadIdx.x] = sum;
    __syncthreads();

    for (int offset = BLOCK_SIZE / 2; offset >= 32; offset >>= 1) {
        if (offset > threadIdx.x) {
            shared[threadIdx.x] += shared[threadIdx.x + offset];
        }
        __syncthreads();
    }

    if (threadIdx.x < 32) {
        float value = shared[threadIdx.x];
        value = warpReduceSum(value);
        if (threadIdx.x == 0) {
            atomicAdd(output, value);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;
    BlocksPerGrid = BlocksPerGrid > 1024 ? 1024 : BlocksPerGrid;

    reduceKernel<<<BlocksPerGrid, BLOCK_SIZE>>>(input, output, N);
}
```

每个 warp 独立规约，可以去掉 `BLOCK_SIZE` 大小的共享内存数组，每个块只需要一次 `__syncthreads` 和 `atomicAdd`.

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__device__ __forceinline__ float warpReduceSum(float value) {
    value += __shfl_down_sync(0xffffffff, value, 16);
    value += __shfl_down_sync(0xffffffff, value, 8);
    value += __shfl_down_sync(0xffffffff, value, 4);
    value += __shfl_down_sync(0xffffffff, value, 2);
    value += __shfl_down_sync(0xffffffff, value, 1);

    return value;
}

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    int stride = blockDim.x * gridDim.x * 2;
    __shared__ float warpSum[BLOCK_SIZE / 32];
    float sum = 0.0f;

    for (int i = idx; i < N; i += stride) {
        sum += input[i];

        if (i + BLOCK_SIZE < N) {
            sum += input[i + BLOCK_SIZE];
        }
    }
    sum = warpReduceSum(sum);

    int lane = threadIdx.x & 31;
    int warpId = threadIdx.x >> 5;
    if (lane == 0) {
        warpSum[warpId] = sum;
    }
    __syncthreads();

    if (warpId == 0) {
        float blockSum = lane < BLOCK_SIZE / 32 ? warpSum[lane] : 0.0f;
        blockSum = warpReduceSum(blockSum);

        if (lane == 0) {
            atomicAdd(output, blockSum);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;
    BlocksPerGrid = BlocksPerGrid > 1024 ? 1024 : BlocksPerGrid;

    reduceKernel<<<BlocksPerGrid, BLOCK_SIZE>>>(input, output, N);
}
```

### 两阶段规约

虽然每个块只执行一次 `atomicAdd`，但是当块数较多时，所有块仍然竞争同一个地址。可以将规约拆成两步

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256
#define ELEMENTS_PER_THREAD 8

__device__ __forceinline__ float warpReduceSum(float val) {
    val += __shfl_down_sync(0xFFFFFFFF, val, 16);
    val += __shfl_down_sync(0xFFFFFFFF, val, 8);
    val += __shfl_down_sync(0xFFFFFFFF, val, 4);
    val += __shfl_down_sync(0xFFFFFFFF, val, 2);
    val += __shfl_down_sync(0xFFFFFFFF, val, 1);

    return val; // lane 0
}

__global__ __launch_bounds__(BLOCK_SIZE) void reduceKernel(
    const float *__restrict__ input, float *__restrict__ output, int N) {
    __shared__ float warpSums[BLOCK_SIZE / 32]; // 8 float

    float sum = 0.0f;
    int base = blockIdx.x * (BLOCK_SIZE * ELEMENTS_PER_THREAD) + threadIdx.x;
#pragma unroll
    for (int i = 0; i < ELEMENTS_PER_THREAD; ++i) {
        int idx = base + i * BLOCK_SIZE;
        if (idx < N) {
            sum += input[idx];
        }
    }
    sum = warpReduceSum(sum);
    int lane = threadIdx.x & 31;
    int wid = threadIdx.x >> 5;
    if (lane == 0) {
        warpSums[wid] = sum;
    }
    __syncthreads();

    if (wid == 0) {
        sum = (threadIdx.x < (BLOCK_SIZE / 32)) ? warpSums[lane] : 0.0f;
        sum = warpReduceSum(sum);

        if (threadIdx.x == 0) {
            output[blockIdx.x] = sum;
        }
    }
}

__global__ __launch_bounds__(BLOCK_SIZE) void reduceFinalKernel(
    const float *__restrict__ input, float *__restrict__ output, int N) {
    __shared__ float warpSums[BLOCK_SIZE / 32];

    float sum = 0.0f;
    for (int i = blockIdx.x * BLOCK_SIZE + threadIdx.x; i < N;
         i += blockDim.x * gridDim.x) {
        sum += input[i];
    }

    sum = warpReduceSum(sum);

    int lane = threadIdx.x & 31;
    int wid = threadIdx.x >> 5;
    if (lane == 0) {
        warpSums[wid] = sum;
    }
    __syncthreads();

    if (wid == 0) {
        sum = (threadIdx.x < (BLOCK_SIZE / 32)) ? warpSums[lane] : 0.0f;
        sum = warpReduceSum(sum);

        if (threadIdx.x == 0) {
            atomicAdd(output, sum);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    if (N <= 0) {
        cudaMemset(output, 0, sizeof(float));
        return;
    }

    int elemsPerBlock = BLOCK_SIZE * ELEMENTS_PER_THREAD;    // 256 * 8 = 2048
    int numBlocks = (N + elemsPerBlock - 1) / elemsPerBlock; // Round up

    if (numBlocks == 1) {
        reduceKernel<<<1, BLOCK_SIZE>>>(input, output, N);
    } else {
        float *partial = nullptr;
        cudaMalloc(&partial, numBlocks * sizeof(float));

        reduceKernel<<<numBlocks, BLOCK_SIZE>>>(input, partial, N);
        int finalBlocks = (numBlocks + elemsPerBlock - 1) / elemsPerBlock;
        if (finalBlocks <= 1) {
            reduceKernel<<<1, BLOCK_SIZE>>>(partial, output, numBlocks);
        } else {
            cudaMemset(output, 0, sizeof(float));
            reduceFinalKernel<<<finalBlocks, BLOCK_SIZE>>>(partial, output,
                                                           numBlocks);
        }

        cudaFree(partial);
    }
}
```

## 性能演进

> 以 [LeetGPU | Matrix Multiplication](https://leetgpu.com/challenges/matrix-multiplication) 为例

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

### 基础全局内存 Kernel

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

### 共享内存 Tiling

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

### Bank Conflict 优化

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

若 $TILE\_SIZE = 16$，地址间隔为 $64B=2\times 32B$，Memory Bank 索引为

``` c++
(base / 4 + threadIdx.y * 16 + k) % 32
```

结果导致 `threadIdx.y = 0` 和 `threadIdx.y = 2` 索引相同，访问同一 Memory Bank，发生冲突！

可以采用添加 Padding 的方案，使列间距不是 32 的倍数

``` c++
__shared__ float As [TILE_SIZE][TILE_SIZE + PADDING];  // PADDING = 8
```

这种方案可以消除 Bank Conflict，但是会增加共享内存占用，降低占用率

### 向量化内存访问

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

### 寄存器与 Occupancy 调优

> **延迟隐藏与资源平衡**：
>
> Occupancy = 活跃 warp 数 / 理论最大 warp 数；通过增加并发 warp 数，隐藏内存/计算延迟。

