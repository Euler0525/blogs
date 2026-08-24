---
title: Softmax 算子的实现与优化
description: 从最朴素的实现方法开始，逐步优化，并实现 Online Softmax。
tags:
  - CUDA
series: AI Infra
series_order: 5
categories: 编程
mathjax: true
abbrlink: 5db73590
date: 2026-08-26 13:45:01
---

## 起始版本

对于长度为 $N$ 的输入向量 $x$，Softmax 的定义为

$$
y_i =\frac{e^{x_i}}{\sum_{j = 0}^{N-1}e^{x_j}}
$$

直接计算指数时，如果输入中存在较大的正数，`expf` 可能上溢；较大的负数则可能下溢。Softmax 对所有输入同时平移一个常数保持不变，因此可以先求最大值 $m=\max_j x_j$，再计算

$$
y_i =\frac{e^{x_i-m}}{\sum_{j = 0}^{N-1}e^{x_j-m}}
$$

此时最大的指数项为 $e^0=1$，其余指数项均不大于 1，可以显著降低浮点上溢的风险。下面的实现将一个输入向量交给一个包含 256 个线程的 Block；每个线程通过步长为 `BLOCK_SIZE` 的循环处理 `tid`、`tid + BLOCK_SIZE` 等位置，所以即使 $N$ 大于线程数也能覆盖全部元素。

```c++
#include <cuda_runtime.h>
#include <float.h>
#include <math.h>

#define BLOCK_SIZE 256
#define WARPS_NUM (BLOCK_SIZE / 32)

__device__ __forceinline__ float warp_reduce_sum(float value) {
    value += __shfl_down_sync(0xffffffffu, value, 16);
    value += __shfl_down_sync(0xffffffffu, value, 8);
    value += __shfl_down_sync(0xffffffffu, value, 4);
    value += __shfl_down_sync(0xffffffffu, value, 2);
    value += __shfl_down_sync(0xffffffffu, value, 1);

    return value;
}

__device__ __forceinline__ float warp_reduce_max(float value) {
    value = fmaxf(value, __shfl_down_sync(0xffffffffu, value, 16));
    value = fmaxf(value, __shfl_down_sync(0xffffffffu, value, 8));
    value = fmaxf(value, __shfl_down_sync(0xffffffffu, value, 4));
    value = fmaxf(value, __shfl_down_sync(0xffffffffu, value, 2));
    value = fmaxf(value, __shfl_down_sync(0xffffffffu, value, 1));

    return value;
}

__device__ __forceinline__ float softmax_max_kernel(float local_max_value,
                                                    float *shared) {
    int tid = threadIdx.x;
    local_max_value = warp_reduce_max(local_max_value);

    int lane_id = tid & 31;
    int warp_id = tid >> 5;

    if (lane_id == 0) {
        shared[warp_id] = local_max_value;
    }
    __syncthreads();

    if (warp_id == 0) {
        local_max_value = lane_id < WARPS_NUM ? shared[lane_id] : -FLT_MAX;
        local_max_value = warp_reduce_max(local_max_value);
        if (lane_id == 0) {
            shared[0] = local_max_value;
        }
    }
    __syncthreads();

    return shared[0];
}

__device__ __forceinline__ float softmax_sum_kernel(float local_sum_value,
                                                    float *shared) {
    int tid = threadIdx.x;
    local_sum_value = warp_reduce_sum(local_sum_value);

    int lane_id = tid & 31;
    int warp_id = tid >> 5;

    if (lane_id == 0) {
        shared[warp_id] = local_sum_value;
    }
    __syncthreads();

    if (warp_id == 0) {
        local_sum_value = lane_id < WARPS_NUM ? shared[lane_id] : 0.0f;
        local_sum_value = warp_reduce_sum(local_sum_value);
        if (lane_id == 0) {
            shared[0] = local_sum_value;
        }
    }
    __syncthreads();

    return shared[0];
}

__global__ void softmax_kernel(const float *input, float *output, int N) {
    int tid = threadIdx.x;
    __shared__ float shared[WARPS_NUM];
    float local_max_value = -FLT_MAX;
    for (int i = tid; i < N; i += BLOCK_SIZE) {
        local_max_value = fmaxf(local_max_value, input[i]);
    }
    float max_value = softmax_max_kernel(local_max_value, shared);

    float local_sum_value = 0.0f;
    for (int i = tid; i < N; i += BLOCK_SIZE) {
        float value = expf(input[i] - max_value);
        output[i] = value;
        local_sum_value += value;
    }
    float inv_sum_value = 1.0f / softmax_sum_kernel(local_sum_value, shared);

    for (int i = tid; i < N; i += BLOCK_SIZE) {
        output[i] *= inv_sum_value;
    }
}

// input, output are device pointers (i.e. pointers to memory on the GPU)
extern "C" void solve(const float *input, float *output, int N) {
    if (input == nullptr || output == nullptr || N <= 0) {
        return;
    }

    softmax_kernel<<<1, BLOCK_SIZE>>>(input, output, N);
    cudaDeviceSynchronize();
}
```

整个 Kernel 分为三次遍历。第一次遍历中，每个线程计算自己负责元素的局部最大值，再由 `softmax_max_kernel` 求出整个 Block 的最大值；第二次遍历计算 `expf(input[i] - max_value)`，一边把指数结果暂存到 `output`，一边累加局部和，随后由 `softmax_sum_kernel` 得到分母；第三次遍历将暂存的指数结果乘以分母的倒数，得到最终 Softmax。暂存指数结果避免了归一化阶段再次调用 `expf`，代价是额外读写一次 `output`。

最大值与求和都采用两级规约。`warp_reduce_max` 和 `warp_reduce_sum` 使用 `__shfl_down_sync` 直接交换同一 Warp 内各 Lane 的寄存器值，偏移量依次为 16、8、4、2、1，最终由 Lane 0 得到该 Warp 的规约结果。由于 `BLOCK_SIZE` 为 256，一个 Block 正好包含 `WARPS_NUM=8` 个完整 Warp，因此代码中的全掩码 `0xffffffffu` 覆盖所有 Lane。

每个 Warp 的 Lane 0 将局部结果写入 `shared[warp_id]`，第一次 `__syncthreads()` 保证所有 Warp 都完成写入。随后第一个 Warp 读取这 8 个结果并进行第二级规约，其余 Lane 使用对应运算的单位元补齐：最大值规约使用 `-FLT_MAX`，求和规约使用 `0.0f`。第二次 `__syncthreads()` 保证 Block 内所有线程读取 `shared[0]` 时，最终结果已经写入。最大值规约结束后，后续求和规约可以复用同一段共享内存。

单 Block 设计使 Block 内同步和规约较为直接，也能正确处理任意正长度的一维向量；但整个 Kernel 最多只使用 256 个线程，输入很长或需要同时处理多行、批量数据时，无法利用多个 Block 扩展并行度。`solve` 中的 `cudaDeviceSynchronize()` 会等待该 Kernel 执行完成后再返回。
