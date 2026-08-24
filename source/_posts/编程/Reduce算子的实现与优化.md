---
title: Reduce 算子的实现与优化
description: '从最朴素的并行规约实现方法开始，逐步优化，提升内存带宽利用率。'
tags:
  - CUDA
  - 并行编程
  - 共享内存
series: AI Infra
series_order: 3
categories: 编程
mathjax: true
abbrlink: a7k39mq2
date: 2026-02-27 11:15:56
---

> 以 [LeetGPU | Reduction](https://leetgpu.com/challenges/reduction) 为例，这是一个典型的 Memory-Bound 的操作。
>
> 注：本文的性能测试数据为 NVIDIA GeForce RTX 4060 Laptop 运行结果，仅供参考。

## 单线程串行求和

只有一个 GPU 线程工作

```c++
#include <cuda_runtime.h>

__global__ void reduceKernel(const float *input, float *output, int N) {
    double sum = 0.0;
    for (int i = 0; i < N; ++i) {
        sum += input[i];
    }

    output[0] = static_cast<float>(sum);
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    reduceKernel<<<1, 1>>>(input, output, N);
}
```

CPU 将 `reduceKernel` 交给 GPU，然后立即返回执行后面的代码；GPU 收到任务后慢慢执行，利用 `nsys` 工具观察 CUDA API 的时间线，会发现 CPU 侧调用 CUDA Runtime/Driver，将 kernel launch 命令提交出去的时间仅为 60.145us，接下来 `cudaDeviceSynchronize()` 约为 105.407ms，相当于 CPU 在等待 GPU 完成任务。

## 多线程并行读取

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

注：精度错误。

## 块内规约

### 朴素树形

最直接的块内树形规约是从步长 `1` 开始，每一轮让满足条件的线程把右侧元素累加到当前位置。每个线程将局部计算的结果写入共享内存，每个 Block 内先完成树形规约，这样就可以将原子加操作数量从线程数下降到块数。不过规约的每一层都需要执行 `__syncthreads()`

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];

    shared[tid] = idx < N ? input[idx] : 0.0f;
    __syncthreads();

    for (int stride = 1; stride < BLOCK_SIZE; stride <<= 1) {
        if (tid % (2 * stride) == 0) {
            shared[tid] += shared[tid + stride];
        }
        __syncthreads();
    }

    if (tid == 0) {
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

随着 `stride` 增大，同一个 Warp 内满足 `threadIdx.x % (2 * stride) == 0` 的线程越来越稀疏，会产生明显的 Warp Divergence；同时取模运算和交错的 Shared Memory 访问也会带来额外开销。

例如

- `stride=1` 时：每个 Warp 内只有偶数线程工作 → 50% 利用率
- `stride=2` 时：每 4 个线程只有 1 个工作 → 25% 利用率
- ……

---

在 ncu 的 Memory Chart 中

```shell
Grid Size  = 16,384 blocks
Block Size = 256 threads
```

- Global

`input[idx]` 是 global read，每个 warp 执行一次 global load instruction，因此总数为 $16384 * 256/32=131072$；`atomicAdd(output, shared[0]);` 每个 block 执行一次，共 $16384$，总数即为 $131072 + 16384 \approx 147.46K$.

- Shared Store

开始写入 `shared`，每个 block 8 个 warp

后续规约的循环中，随着 `stride` 递增，活跃的 warp 总数为 $8+8+8+8+8+4+2+1=47$，即每个 block 的 reduction 需要由 47 个 warp-instance 执行。整个 grid 总共 $(8 + 47) * 16384\approx 901.12K$.

- Shared Load

`shared[tid] += shared[tid + stride];` 每个活跃的 warp 两次 shared load，最后原子加还需要一次，所以一个 block 共 $47 * 2 + 1=95$ 次 load，整个 grid 共 $16384 * 95\approx 1.56MB$

- Device Memory

总线程数为 $16384 * 256 = 4194304$，每个线程读取 `float`，总数即为 $4194304 * 4\approx 16.78MB$.

### 交错寻址

可以把线程是否参与规约的判断改成连续线程计算目标下标。前半部分线程通过 `index = 2 * stride * tid` 找到本轮需要合并的位置，参与计算的线程集中在 Warp 前部，减少了朴素树形中由取模条件造成的 Warp Divergence。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int tid = threadIdx.x;
    int idx = blockDim.x * blockIdx.x + tid;
    __shared__ float shared[BLOCK_SIZE];

    shared[tid] = idx < N ? input[idx] : 0.0f;
    __syncthreads();

    for (int stride = 1; stride < BLOCK_SIZE; stride <<= 1) {
        int index = 2 * stride * tid;
        if (index < BLOCK_SIZE) {
            shared[index] += shared[index + stride];
        }
        __syncthreads();
    }

    if (tid == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int BlocksPerGrid = (N + BLOCK_SIZE - 1) / BLOCK_SIZE;
    reduceKernel<<<BlocksPerGrid, BLOCK_SIZE>>>(input, output, N);
}
```

不过随着 `stride` 增大，Shared Memory 的访问间隔也同步增大，多个线程可能映射到相同的 Memory Bank，因此仍然可能出现 Bank Conflict。

例如

- **第 1 轮循环（stride = 1）**：tid 0 访问 shared [0]、shared [1]；tid 16 访问 shared [32]、shared [33]。shared [0] 和 shared [32] 都落在 Bank 0 → **2 路 Bank Conflict**
- **第 2 轮循环（stride = 2）**：tid 0 访问 shared [0,2]；tid 8 访问 shared [32,34]；tid 16 访问 shared [64,66]；tid 24 访问 shared [96,98]。shared [0]、shared [32]、shared [64]、shared [96] 都在 Bank 0 → **4 路 Bank Conflict**
- **第 3 轮循环（stride = 4）**：8 路 Bank Conflict
- ……

### 步长反转

把规约方向反过来，从 `BLOCK_SIZE / 2` 开始不断将步长减半。每一轮都由连续的前 `offset` 个线程访问 `shared[tid]` 和 `shared[tid + offset]`，避免了交错寻址中的跨步 Shared Memory 访问，也让有效线程连续分布，从而消除典型的 Bank Conflict 和主要的 Warp Divergence。最后一个 Warp 中活跃线程仍会逐步减少，后续再通过展开最后 Warp 继续优化。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];

    shared[tid] = idx < N ? input[idx] : 0.0f;
    __syncthreads();

    for (int stride = BLOCK_SIZE / 2; stride > 0; stride >>= 1) {
        if (tid < stride) {
            shared[tid] += shared[tid + stride];
        }
        __syncthreads();
    }

    if (tid == 0) {
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

- 活跃线程 → Warp Divergence

| `stride` |      朴素树形       |     交错寻址      | `stride` |     步长反转      |
| :------: | :-----------------: | :---------------: | :------: | :---------------: |
|    1     |  0, 2, 4, ..., 254  | 0, 1, 2, ..., 127 |   128    | 0, 1, 2, ..., 127 |
|    2     |  0, 4, 8, ..., 252  | 0, 1, 2, ..., 63  |    64    | 0, 1, 2, ..., 63  |
|    3     | 0, 8, 16, ..., 248  | 0, 1, 2, ..., 31  |    32    | 0, 1, 2, ..., 31  |
|    4     | 0, 16, 32, ..., 240 | 0, 1, 2, ..., 15  |    16    | 0, 1, 2, ..., 15  |

- 同一个 warp 访问共享内存地址与 Bank → Bank Conflict

| 规约轮次 | 朴素树形                                                     | 交错寻址                                                     | 步长反转                                                     | Bank Conflict                                                |
| :------: | :----------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
|    1     | `(0,1), (2,3), (4,5), (6,7), (8,9), (10,11), (12,13), (14,15), (16,17), (18,19), (20,21), (22,23), (24,25), (26,27), (28,29), (30,31)` | `(0,1), (2,3),..., (30,31) // (32,33), (34,35),..., (62,63)` | `(0,128), (1,129), (2,130),..., (31,159)`                    | 交错寻址 **2-way**；朴素树形、步长反转无冲突                 |
|    2     | `(0,2), (4,6), (8,10), (12,14), (16,18), (20,22), (24,26), (28,30)` | `(0,2), (4,6),..., (28,30) // (32,34), (36,38),..., (60,62) // (64,66), (68,70),..., (92,94) // (96,98), (100,102),..., (124,126)` | `(0,64), (1,65), (2,66),..., (31,95)`                        | 交错寻址 **4-way**；朴素树形、步长反转无冲突                 |
|    3     | `(0,4), (8,12), (16,20), (24, 28)`                           | `(0,4), (8,12), (16,20), (24,28) // (32,36), (40,44), (48,52), (56,60) // (64,68), (72,76), (80,84), (88,92) // (96,100), (104,108), (112,116), (120,124) // (128,132), (136,140), (144,148), (152,156) // (160,164), (168,172), (176,180), (184,188) // (192,196), (200,204), (208,212), (216,220) // (224,228), (232,236), (240,244), (248,252)` | `(0,32), (1,33), (2,34),..., (31,63)`                        | 交错寻址 **8-way**；朴素树形、步长反转无冲突                 |
|    4     | `(0,8), (16,24)`                                             | `(0,8), (16,24) // (32,40), (48,56) // (64,72), (80,88) // (96,104), (112,120) // (128,136), (144,152) // (160,168), (176,184) // (192,200), (208,216) // (224,232), (240,248)` | `(0,16), (1,17), (2,18),..., (15,31)`                        | 交错寻址 **16-way**；朴素树形、步长反转无冲突                |
|    5     | `(0,16)`                                                     | `(0,16) // (32,48) // (64,80) // (96,112) // (128,144) // (160,176) // (192,208) // (224,240)` | `(0,8), (1,9), (2,10), (3,11), (4,12), (5,13), (6,14), (7,15)` | 交错寻址最高可形成 **8-way** 有效冲突；朴素树形、步长反转无冲突 |


### 双元素处理

前面的版本每个线程只在进入 Shared Memory 规约前读取一个元素。可以让每个线程先在寄存器中累加两个输入元素，再把局部和写入 Shared Memory。这样同样数量的线程一次可以覆盖两倍的数据，Block 数量近似减半，同时前几轮本来会逐步退出的线程被提前用于 Global Memory 读取和加法。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];

    double sum = 0.0f;
    if (idx < N) {
        sum += input[idx];
    }
    if (idx + BLOCK_SIZE < N) {
        sum += input[idx + BLOCK_SIZE];
    }

    shared[tid] = sum;
    __syncthreads();

    for (int stride = BLOCK_SIZE / 2; stride > 0; stride >>= 1) {
        if (tid < stride) {
            shared[tid] += shared[tid + stride];
        }
        __syncthreads();
    }

    if (tid == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```


### 展开最后 Warp

当规约只剩最后 32 个线程时，后续计算全部发生在同一个 Warp 内。此时不再需要每一层都执行 Block 级别的 `__syncthreads()`，可以显式展开最后一个 Warp 的加法，只保留 Warp 级同步。

在 Volta 及之后的架构中存在 Independent Thread Scheduling，因此下面使用 `__syncwarp()` 保证同一个 Warp 对 Shared Memory 的读写顺序，而不是依赖早期架构隐式的 Warp Lockstep 行为。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * blockDim.x * blockIdx.x + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE];

    double sum = 0.0f;
    if (idx < N) {
        sum += input[idx];
    }
    if (idx + BLOCK_SIZE < N) {
        sum += input[idx + BLOCK_SIZE];
    }

    shared[tid] = sum;
    __syncthreads();

    for (int stride = BLOCK_SIZE / 2; stride > 32; stride >>= 1) {
        if (tid < stride) {
            shared[tid] += shared[tid + stride];
        }
        __syncthreads();
    }

    if (tid < 32) {
        volatile float *v = shared;
        v[tid] += v[tid + 32];
        __syncwarp();
        v[tid] += v[tid + 16];
        __syncwarp();
        v[tid] += v[tid + 8];
        __syncwarp();
        v[tid] += v[tid + 4];
        __syncwarp();
        v[tid] += v[tid + 2];
        __syncwarp();
        v[tid] += v[tid + 1];
    }

    if (tid == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```

### 完全循环展开

`BLOCK_SIZE` 在 Kernel 启动时通常是固定值，因此可以把它变成模板参数。编译器可以在编译期确定每一层规约是否存在，并把 Shared Memory 规约和最后一个 Warp 的规约全部展开，消除循环变量、循环条件和分支控制带来的指令开销。

下面每个 `if` 的条件都只依赖模板参数，是编译期常量。对于 `reduceKernel<256>`，编译器会进行常量折叠，只保留 256 线程版本实际需要的规约步骤，因此源码中不再存在运行时规约循环。

```c++
#include <cuda_runtime.h>

#define BLOCK_SIZE 256

template <unsigned int BLOCK_SIZE_>
__global__ void reduceKernel(const float *input, float *output, int N) {
    int idx = 2 * BLOCK_SIZE_ * blockIdx.x + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE_];

    double sum = 0.0f;
    if (idx < N) {
        sum += input[idx];
    }
    if (idx + BLOCK_SIZE_ < N) {
        sum += input[idx + BLOCK_SIZE_];
    }

    shared[tid] = sum;
    __syncthreads();

    if (BLOCK_SIZE_ >= 1024) {
        if (tid < 512)
            shared[tid] += shared[tid + 512];
        __syncthreads();
    }
    if (BLOCK_SIZE_ >= 512) {
        if (tid < 256)
            shared[tid] += shared[tid + 256];
        __syncthreads();
    }
    if (BLOCK_SIZE_ >= 256) {
        if (tid < 128)
            shared[tid] += shared[tid + 128];
        __syncthreads();
    }
    if (BLOCK_SIZE_ >= 128) {
        if (tid < 64)
            shared[tid] += shared[tid + 64];
        __syncthreads();
    }

    if (tid < 32) {
        volatile float *v = shared;
        v[tid] += v[tid + 32];
        __syncwarp();
        v[tid] += v[tid + 16];
        __syncwarp();
        v[tid] += v[tid + 8];
        __syncwarp();
        v[tid] += v[tid + 4];
        __syncwarp();
        v[tid] += v[tid + 2];
        __syncwarp();
        v[tid] += v[tid + 1];
    }

    if (tid == 0) {
        atomicAdd(output, shared[0]);
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = BLOCK_SIZE * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;

    reduceKernel<BLOCK_SIZE>
        <<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```

### Warp Shuffle

Shared Memory 主要用于不同线程之间交换中间结果，而同一个 Warp 内可以直接通过 Shuffle 指令交换寄存器值。使用 `__shfl_down_sync` 后，每个 Warp 的规约都在寄存器中完成，只需要让每个 Warp 的 Lane 0 把局部和写入一小段 Shared Memory，再由第一个 Warp 完成 Block 级规约。

这样 Shared Memory 从 `BLOCK_SIZE` 个元素缩小到 `BLOCK_SIZE / 32` 个元素，并且整个 Block 只需要一次 `__syncthreads()`。

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
    int idx = blockDim.x * blockIdx.x * 2 + threadIdx.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE / 32];

    double sum = 0.0f;
    if (idx < N) {
        sum += input[idx];
    }
    if (idx + BLOCK_SIZE < N) {
        sum += input[idx + BLOCK_SIZE];
    }

    sum = warpReduceSum(sum);

    int lane_id = tid % 32;
    int warp_id = tid >> 5;

    if (lane_id == 0) {
        shared[warp_id] = sum;
    }
    __syncthreads();

    if (warp_id == 0) {
        double warp_sum = lane_id < BLOCK_SIZE / 32 ? shared[lane_id] : 0.0f;
        double block_sum = warpReduceSum(warp_sum);
        if (lane_id == 0) {
            atomicAdd(output, block_sum);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = ThreadsPerBlock * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```


## 网格步长循环

每个线程不再只读取一两个元素，而是按整个网格的跨度连续处理多个元素。这样可以使用固定数量的块处理任意长度的输入，每个线程循环处理多个元素。

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
    int idx = blockDim.x * blockIdx.x * 2 + threadIdx.x;
    int stride = gridDim.x * blockDim.x * 2;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE / 32];

    double sum = 0.0f;
    for (int i = idx; i < N; i += stride) {
        sum += input[i];
        if (i + BLOCK_SIZE < N) {
            sum += input[i + BLOCK_SIZE];
        }
    }
    sum = warpReduceSum(sum);

    int lane_id = tid % 32;
    int warp_id = tid >> 5;

    if (lane_id == 0) {
        shared[warp_id] = sum;
    }
    __syncthreads();

    if (warp_id == 0) {
        double warp_sum = lane_id < BLOCK_SIZE / 32 ? shared[lane_id] : 0.0f;
        double block_sum = warpReduceSum(warp_sum);
        if (lane_id == 0) {
            atomicAdd(output, block_sum);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = ThreadsPerBlock * 2;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;
    BlocksPerGrid = BlocksPerGrid > 1024 ? 1024 : BlocksPerGrid;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```


### 向量化 + Stride Loop

Grid-Stride Loop 解决的是数据规模大于当前 Grid 覆盖范围的问题，而向量化读取可以减少 Global Memory Load 指令数量并提高单线程每次访存的有效载荷。将连续的 4 个 `float` 视为一个 `float4` 后，每个线程一次读取 16 Byte，并继续按照整个 Grid 的跨度循环读取后续向量。

这种方式既保持了连续线程之间的合并访存，也允许固定数量的 Block 反复处理任意长度的输入。向量部分结束后再单独处理不足 4 个元素的尾部，因此不会遗漏数据。这里默认 `input` 具有至少 16 Byte 对齐，`cudaMalloc` 返回的设备地址满足这一要求。

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
    int idx = blockDim.x * blockIdx.x + threadIdx.x;
    int stride = gridDim.x * blockDim.x;
    int tid = threadIdx.x;
    __shared__ float shared[BLOCK_SIZE / 32];

    double sum = 0.0f;
    const float4 *input4 = reinterpret_cast<const float4 *>(input);
    for (int i = idx; i < N / 4; i += stride) {
        float4 value = input4[i];
        sum += value.x + value.y + value.z + value.w;
    }

    int tail = N / 4 * 4;
    for (int i = idx + tail; i < N; i += stride) {
        sum += input[i];
    }

    sum = warpReduceSum(sum);

    int lane_id = tid % 32;
    int warp_id = tid >> 5;

    if (lane_id == 0) {
        shared[warp_id] = sum;
    }
    __syncthreads();

    if (warp_id == 0) {
        double warp_sum = lane_id < BLOCK_SIZE / 32 ? shared[lane_id] : 0.0f;
        double block_sum = warpReduceSum(warp_sum);
        if (lane_id == 0) {
            atomicAdd(output, block_sum);
        }
    }
}

extern "C" void solve(const float *input, float *output, int N) {
    cudaMemset(output, 0, sizeof(float));
    if (N <= 0) {
        return;
    }

    int ThreadsPerBlock = BLOCK_SIZE;
    int elementsPerBlock = ThreadsPerBlock;
    int BlocksPerGrid = (N + elementsPerBlock - 1) / elementsPerBlock;
    BlocksPerGrid = BlocksPerGrid > 1024 ? 1024 : BlocksPerGrid;

    reduceKernel<<<BlocksPerGrid, ThreadsPerBlock>>>(input, output, N);
}
```
