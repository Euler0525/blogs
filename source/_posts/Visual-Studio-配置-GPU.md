---
title: Visual Studio 配置 GPU
tags:
  - OpenCL
  - GPU
categories: 工具
mathjax: true
abbrlink: 43549b3a
date: 2026-01-17 11:25:23
---

> 运行环境：
>
> - 操作系统：Windows 11 Pro
> - 开发工具：Visual Studio 2022 v17.14.24

## CUDA

Visual Studio 在新建的工程中，右键 → [Build Custemization Files]，添加下面目录中的 `.targets` 文件

```powershell
C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\extras\visual_studio_integration\MSBuildExtensions
```

然后

- [Properties] → [VC++ Directories] → [Include Directories] 填入 `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\include`
- [Properties] → [VC++ Directories] → [Library Directories] 填入 `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\lib\x64`
- [Properties] → [Linker] → [Input] → [Additional Dependencies] 填入 `cuda.lib`
- [Properties] → [CUDA C/C++] → [Common] → [CUDA Toolkit Custom Dir] 填入 `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4`

---

`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\extras\demo_suite\deviceQuery.exe`

```powershell
 CUDA Device Query (Runtime API) version (CUDART static linking)

Detected 1 CUDA Capable device(s)

Device 0: "NVIDIA GeForce RTX 4060 Laptop GPU"
  CUDA Driver Version / Runtime Version          12.7 / 12.4
  CUDA Capability Major/Minor version number:    8.9
  Total amount of global memory:                 8188 MBytes (8585216000 bytes)
MapSMtoCores for SM 8.9 is undefined.  Default to use 128 Cores/SM
MapSMtoCores for SM 8.9 is undefined.  Default to use 128 Cores/SM
  (24) Multiprocessors, (128) CUDA Cores/MP:     3072 CUDA Cores
  GPU Max Clock rate:                            1890 MHz (1.89 GHz)
  Memory Clock rate:                             8001 Mhz
  Memory Bus Width:                              128-bit
  L2 Cache Size:                                 33554432 bytes
  Maximum Texture Dimension Size (x,y,z)         1D=(131072), 2D=(131072, 65536), 3D=(16384, 16384, 16384)
  Maximum Layered 1D Texture Size, (num) layers  1D=(32768), 2048 layers
  Maximum Layered 2D Texture Size, (num) layers  2D=(32768, 32768), 2048 layers
  Total amount of constant memory:               zu bytes
  Total amount of shared memory per block:       zu bytes
  Total number of registers available per block: 65536
  Warp size:                                     32
  Maximum number of threads per multiprocessor:  1536
  Maximum number of threads per block:           1024
  Max dimension size of a thread block (x,y,z): (1024, 1024, 64)
  Max dimension size of a grid size    (x,y,z): (2147483647, 65535, 65535)
  Maximum memory pitch:                          zu bytes
  Texture alignment:                             zu bytes
  Concurrent copy and kernel execution:          Yes with 1 copy engine(s)
  Run time limit on kernels:                     Yes
  Integrated GPU sharing Host Memory:            No
  Support host page-locked memory mapping:       Yes
  Alignment requirement for Surfaces:            Yes
  Device has ECC support:                        Disabled
  CUDA Device Driver Mode (TCC or WDDM):         WDDM (Windows Display Driver Model)
  Device supports Unified Addressing (UVA):      Yes
  Device supports Compute Preemption:            Yes
  Supports Cooperative Kernel Launch:            Yes
  Supports MultiDevice Co-op Kernel Launch:      No
  Device PCI Domain ID / Bus ID / location ID:   0 / 1 / 0
  Compute Mode:
     < Default (multiple host threads can use ::cudaSetDevice() with device simultaneously) >

deviceQuery, CUDA Driver = CUDART, CUDA Driver Version = 12.7, CUDA Runtime Version = 12.4, NumDevs = 1, Device0 = NVIDIA GeForce RTX 4060 Laptop GPU
Result = PASS
```

## OpenCL

### NVIDIA

在安装 CUDA 的时候 OpenCL 依赖已经安装，分别位于

```powershell
C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\include\CL
C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\lib\Win32\OpenCL.lib
C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4\lib\x64\OpenCL.lib
```

将 `\CL` 目录与两个 `OpenCL.lib` 文件复制，形成如下目录结构

```powershell
OpenCL
├─include
│  └─CL
│          cl.h
│          cl.hpp
│          cl_d3d10.h
│          cl_d3d10_ext.h
│          cl_d3d11.h
│          cl_d3d11_ext.h
│          cl_d3d9_ext.h
│          cl_dx9_media_sharing.h
│          cl_egl.h
│          cl_ext.h
│          cl_gl.h
│          cl_gl_ext.h
│          cl_platform.h
│          cl_version.h
│          opencl.h
│
└─lib
    ├─Win32
    │      OpenCL.lib
    │
    └─x64
            OpenCL.lib
```

> [点击此处](https://cloud.189.cn/web/share?code=zUNRfaF3aYBz) 下载 OpenCL 库文件，来源于 NVIDIA CUDA v12.4 库（访问码：j1qe）

将得到的 `OpenCL` 目录复制到 Visual Studio 工程目录中，并在 Solution 中配置依赖：

> 注：Visual Studio 中的相对路径是相对于 `.vcxproj` 文件。

- [Properties] → [VC++ Directories] → [Include Directories] 填入 `..\OpenCL\include`
- [Properties] → [VC++ Directories] → [Library Directories] 填入 `..\OpenCL\lib`

- [Properties] → [Linker] → [Input] → [Additional Dependencies] 填入

```powershell
..\OpenCL\lib\x64\OpenCL.lib
..\OpenCL\lib\Win32\OpenCL.lib
```

### AMD GPU



## 参考资料

[CUDA 春训营](https://alex-mcavoy.github.io/categories/nvidia/cuda-spring-bootcamp/)
