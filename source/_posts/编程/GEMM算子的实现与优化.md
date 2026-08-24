---
title: GEMM 算子的实现与优化
description: 从最朴素的实现方法开始，逐步优化，提升算数强度。
tags:
  - CUDA
series: AI Infra
series_order: 4
categories: 编程
mathjax: true
abbrlink: f099c507
date: 2026-08-26 10:28:10
---

## 朴素实现

这里计算的是行主序矩阵乘法

$$
C=A B,\qquad A\in\mathbb{R}^{M\times N},\quad B\in\mathbb{R}^{N\times K},\quad C\in\mathbb{R}^{M\times K}
$$

其中每个输出元素是 $A$ 的一行与 $B$ 的一列的点积：$C_{i,j}=\sum_{n=0}^{N-1}A_{i,n}B_{n,j}$。二维 Grid 将 `threadIdx.x` 映射到输出列 `col`，将 `threadIdx.y` 映射到输出行 `row`，因此每个有效线程负责计算一个 $C[row][col]$。Grid 尺寸采用向上取整，边缘 Block 可能包含超出矩阵范围的线程，所以 Kernel 开头需要通过边界判断提前返回。

```c++
#include <cuda_runtime.h>

__global__ void matrix_multiplication_kernel(const float *A, const float *B,
                                             float *C, int M, int N, int K) {
    int col = blockDim.x * blockIdx.x + threadIdx.x;
    int row = blockDim.y * blockIdx.y + threadIdx.y;
    if (col >= K || row >= M) {
        return;
    }

    // A(N, 1), B(K, 1), C(K, 1)
    float sum = 0.0f;
    for (int n = 0; n < N; ++n) {
        sum += A[row * N + n] * B[n * K + col];
    }
    C[row * K + col] = sum;
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float *A, const float *B, float *C, int M, int N,
                      int K) {
    dim3 threadsPerBlock(16, 16);
    dim3 blocksPerGrid((K + threadsPerBlock.x - 1) / threadsPerBlock.x,
                       (M + threadsPerBlock.y - 1) / threadsPerBlock.y);

    matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M,
                                                                     N, K);
    cudaDeviceSynchronize();
}
```

循环的每次迭代执行一次乘法和一次加法，忽略循环控制开销时，每个输出元素约需要 $2N$ FLOPs。若从单线程视角估算，并假设每次访问都需要从 Global Memory 读取、不考虑缓存和线程之间的复用，则需要读取 $A$、$B$ 各 $N$ 个 `float`，共 $8N$ Bytes，对应的算术强度为

$$
\dfrac{2N}{8N} = 0.25 \space \mathrm{FLOPs/Byte}
$$

这一数值是朴素访存模型下的上层估算，并不表示硬件一定产生 $2N$ 次彼此独立的内存事务。在同一次循环迭代中，具有相同 `row` 的相邻线程读取同一个 `A[row * N + n]`，可由缓存或广播机制复用；相邻 `col` 的线程读取连续的 `B[n * K + col]`，能够形成合并访问，最终写入 `C` 时地址也连续。不过这些数据没有被程序显式保存在 Block 内供后续线程复用，矩阵较大、缓存不能容纳工作集时，同一元素仍可能被不同线程或 Block 反复从更低层存储读取，因此性能通常受内存流量限制。

## Tiling 优化

```c++
#include <cuda_runtime.h>

#define TILE_SIZE 16

__global__ void matrix_multiplication_kernel(const float *A, const float *B,
                                             float *C, int M, int N, int K) {
    int col = blockDim.x * blockIdx.x + threadIdx.x;
    int row = blockDim.y * blockIdx.y + threadIdx.y;

    __shared__ float As[TILE_SIZE][TILE_SIZE];
    __shared__ float Bs[TILE_SIZE][TILE_SIZE];
    float sum = 0.0f;

    // A(N, 1), B(K, 1), C(K, 1)
    for (int tile = 0; tile < (N + TILE_SIZE - 1) / TILE_SIZE; ++tile) {
        // A tile
        int Acol = threadIdx.x + tile * TILE_SIZE;
        if (row < M && Acol < N) {
            As[threadIdx.y][threadIdx.x] = A[row * N + Acol];
        } else {
            As[threadIdx.y][threadIdx.x] = 0.0f;
        }
        // B tile
        int Brow = threadIdx.y + tile * TILE_SIZE;
        if (Brow < N && col < K) {
            Bs[threadIdx.y][threadIdx.x] = B[Brow * K + col];
        } else {
            Bs[threadIdx.y][threadIdx.x] = 0.0f;
        }
        __syncthreads();

        for (int n = 0; n < TILE_SIZE; ++n) {
            sum += As[threadIdx.y][n] * Bs[n][threadIdx.x];
        }
        __syncthreads();
    }

    if (row < M && col < K) {
        C[row * K + col] = sum;
    }
}

// A, B, C are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float *A, const float *B, float *C, int M, int N,
                      int K) {
    dim3 threadsPerBlock(TILE_SIZE, TILE_SIZE);
    dim3 blocksPerGrid((K + threadsPerBlock.x - 1) / threadsPerBlock.x,
                       (M + threadsPerBlock.y - 1) / threadsPerBlock.y);

    matrix_multiplication_kernel<<<blocksPerGrid, threadsPerBlock>>>(A, B, C, M,
                                                                     N, K);
    cudaDeviceSynchronize();
}
```

Tiling 版本把归约维度 $N$ 划分为长度为 `TILE_SIZE` 的小块。一个 $16\times16$ 线程 Block 对应 $C$ 的一个 $16\times16$ 输出子块，每个线程仍然只计算一个输出元素，但 Block 内的线程会协作完成当前 Tile 的数据加载：线程 `(threadIdx.y, threadIdx.x)` 分别从 $A$ 和 $B$ 读取一个元素，写入 `As` 和 `Bs`。加载地址沿 `threadIdx.x` 连续，有利于形成合并的 Global Memory 访问。

当矩阵尺寸不是 `TILE_SIZE` 的整数倍时，最后一个 Tile 或边缘 Block 会落在矩阵范围之外。代码将越界的 $A$、$B$ 元素填为 0，使它们参与乘加时不改变结果。这里不能像朴素版本一样让越界线程提前返回，因为 Block 中的所有线程都必须继续参与共享内存加载和 `__syncthreads()`；最终只有满足 `row < M && col < K` 的线程才写回 $C$。

第一次 `__syncthreads()` 位于加载之后，用来保证整个 Tile 已经写入共享内存，所有线程才能开始计算。内层循环中，每个线程读取 `As[threadIdx.y][n]` 与 `Bs[n][threadIdx.x]`，完成当前 Tile 的 16 次乘加：同一个 $A$ 元素可以被输出子块同一行的 16 个线程复用，同一个 $B$ 元素可以被同一列的 16 个线程复用。第二次 `__syncthreads()` 位于计算之后，防止部分线程提前进入下一轮并覆盖仍在被其他线程读取的共享内存。

设 Tile 边长为 $T$，一个完整 Tile 阶段从 Global Memory 读取 $2T^2$ 个 `float`，完成约 $2T^3$ FLOPs。忽略输出写回、边界和缓存影响时，其算术强度约为

$$
\frac{2T^3}{2T^2\times4}=\frac{T}{4}\ \mathrm{FLOPs/Byte}
$$

当 $T=16$ 时约为 $4\ \mathrm{FLOPs/Byte}$，相较于把每个线程视为独立读取全部操作数的朴素模型，Global Memory 读取量最多可降低约 16 倍。每个线程的累加值 `sum` 保存在寄存器中，遍历完全部 Tile 后再写回一次。当前实现属于基础共享内存 Tiling，尚未采用一线程多输出、寄存器分块、向量化加载或异步流水等进一步优化。
