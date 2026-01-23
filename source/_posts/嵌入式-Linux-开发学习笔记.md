---
title: 嵌入式 Linux 开发学习笔记
categories: 嵌入式
mathjax: true
abbrlink: 8c71bd19
date: 2026-05-25 14:40:42
tags:
---

## 环境配置

### 网络环境配置

目前具备一台虚拟机，配置如下

```shell
 OS: Ubuntu 24.04 noble
 Kernel: x86_64 Linux 6.14.0-29-generic
```

开发板选择 `TLT113-MiniEVM`，配置如下

```shell
2 x ARMv7 Processor rev 5 (v7l)
```

---

下面需要利用 **桥接模式(Bridged)** 将虚拟机与开发板配置在同一个网段

1. [Edit] → [Virtual Network Editor] → [VMnet0 Bridged to Wifi]
2. [Network Adapter] → [Custom: Specific virtual network] → [VMnet0]

### 调试环境配置

- 优化标志

| 标志  |   优化级别   | 特点                                               |
| :---: | :----------: | -------------------------------------------------- |
| `-O0` |    无优化    | 保留调试信息                                       |
| `-O1` |   基础优化   | 平衡编译速度与性能，优化代码大小和执行效率         |
| `-O2` |   高级优化   | 启用更多优化（如循环展开、函数内联），发布版本使用 |
| `-O3` |   极致优化   | 在 `-O2` 基础上增加激进优化                        |
| `-Os` | 优化代码大小 | 适合嵌入式场景，优先减小可执行文件体积             |

- 警告标志

|    标志    | 作用                                     |
| :--------: | ---------------------------------------- |
|  `-Wall`   | 启用常见警告（如未使用变量、类型不匹配） |
| `-Wextra`  | 额外警告（如无意义的比较、未初始化变量） |
| `-Werror`  | 将警告视为错误（强制修复所有警告）       |

#### 交叉编译

要在 ARM 架构上运行在 AMD（x86_64）机器上编译的 C 程序，需要对其进行 **交叉编译**。

`gcc-arm-linux-gnueabi` 和 `gcc-arm-linux-gnueabihf` 都是 ARM 32 位 Linux 交叉编译器，主要区别在于 **浮点参数传递 ABI** 不同。

|          工具链           |        编译器命令         |   浮点 ABI    |     含义     |
| :-----------------------: | :-----------------------: | :-----------: | :----------: |
|  `gcc-arm-linux-gnueabi`  |  `arm-linux-gnueabi-gcc`  | soft / softfp | 软件浮点 ABI |
| `gcc-arm-linux-gnueabihf` | `arm-linux-gnueabihf-gcc` |     hard      |  硬浮点 ABI  |

`gcc-arm-linux-gnueabi` 默认使用 soft-float ABI，浮点参数通过普通 ARM 寄存器传递。

- 兼容性较好

- 不要求目标系统必须支持硬浮点 ABI

- 可以运行在没有 FPU 的 ARM 设备上

不过即使 CPU 有 FPU，也不一定按 hard-float ABI 调用。

`gcc-arm-linux-gnueabihf` 使用 hard-float ABI，浮点参数通过 VFP 浮点寄存器传递。

- 浮点性能更好

- 需要目标 CPU 支持 FPU

- 目标系统的用户态库也必须是 hard-float ABI

- 与 soft-float ABI 的库通常不能混用

---

在目标板上查看系统架构

```shell
❯ uname -m           # armv7l
❯ ls /lib/ld-linux*  # /lib/ld-linux.so.3
```

如果是 `/lib/ld-linux-armhf.so.3`，则表示支持 hard-float

---

执行下面指令，在 AMD 机器上安装面向 ARM 处理器的编译器

```shell
❯ sudo apt update
❯ sudo apt install binutils-arm-linux-gnueabi
❯ sudo apt install gcc-arm-linux-gnueabi g++-arm-linux-gnueabi
❯ sudo apt install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf  # 针对 32 位 ARM 开发板
❯ sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu      # 针对 64 位 ARM 开发板
❯ sudo apt install gdb-multiarch

❯ arm-linux-gnueabi-gcc main.c -o main_arm32 -g
```

编译得到可执行二进制文件

```shell
❯ file main_arm32
main_arm32: ELF 32-bit LSB executable, ARM, EABI5 version 1 (GNU/Linux), statically linked, BuildID[sha1]=05545e04fa24e60e06c4b239350e1bdcf6a62515, for GNU/Linux 3.2.0, not stripped
❯ arm-linux-gnueabihf-objdump -S main_arm32  # 混合查看 C 语言源码与汇编(如果是静态编译, 汇编代码会很长...)
```

#### 远程调试

- 嵌入式设备

```shell
❯ gdbserver <vmware-ubuntu_ip_addr>:12345 main_arm32
```

- 开发设备

```shell
❯ gdb-multiarch -q main_arm32
(gdb) target remote <embedded-dev_ip_addr>:12345
Remote debugging using <embedded-dev_ip_addr>:12345
0x00010340 in _start ()
(gdb) b main
Breakpoint 1 at 0x10462: file main.c, line 7.
(gdb) c
Continuing.
```

## 编译内核

### 编译环境配置

```shell
❯ sudo apt install make build-essential bison flex bc libncurses-dev libelf-dev libssl-dev libdw-dev u-boot-tools dwarves
```

### 下载内核源代码

Linux 内核源代码托管在 [The Linux Kernel Archieves](https://kernel.org/) 平台

```shell
❯ wget https://cdn.kernel.org/pub/linux/kernel/v7.x/linux-7.0.10.tar.xz
❯ tar -xf linux-7.0.10.tar.xz
```

也可以直接克隆稳定版源代码

```shell
❯ git clone https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git
❯ cd linux
❯ git checkout v7.0.10
```

### 内核配置

配置工具包括以下几种，可以根据需求选择启动/禁用某些特性

|     工具     |                命令                 |       特点        |
| :----------: | :---------------------------------: | :---------------: |
| `defconfig`  | 使用默认配置（适合嵌入式/极简场景） | `make defconfig`  |
| `menuconfig` |       文本界面，支持键盘导航        | `make menuconfig` |
|  `nconfig`   |     增强版文本界面（支持搜索）      |  `make nconfig`   |
| `oldconfig`  |    基于现有 `.config` 更新新选项    | `make oldconfig`  |

虚拟机的 `.config` 文件位于 `/boot` 目录下，可以复用避免从零开始

注：Ubuntu 的内核配置里引用了发行版自己的证书文件，但新下载的原版 Linux 源码目录里没有这个文件，因此需要将证书配置清空

```shell
❯ cp /boot/config-$(uname -r) .config
❯ scripts/config --set-str SYSTEM_TRUSTED_KEYS ""
❯ scripts/config --set-str SYSTEM_REVOCATION_KEYS ""
❯ make oldconfig     # 更新配置以适配新内核版本
❯ make olddefconfig  # 自动对新选项采用默认值, 不需要手动回答
```

> 如果需要启用调试功能，在 `make nemuconfig` 之后，在 `Kernel hacking` 选项中勾选 `CONFIG_DEBUG_INFO`（生成调试信息）和 CONFIG_KASAN`（内存错误检测）
>
> 然后可以使用 gdb 工具 调试 `vmlinux`

### 编译内核

```shell
❯ make -j$(nproc)           # 编译内核镜像, 模块等文件(并行编译, CPU 核心数+1)
❯ make modules -j$(nproc)   # 仅编译内核模块
```

### 清理编译产物

```shell
# 编译完成后 Kernel: arch/x86/boot/bzImage is ready  (#1)
❯ make clean     # 清理编译产物
❯ make mrproper  # 清理编译产物与 .config 文件
```

### 安装内核

```shell
❯ sudo make modules_install  # 安装内核模块到 /lib/module
❯ sudo make install          # 安装内核镜像, 符号表及配置文件到 /boot
```

主要包括以下功能

- 复制内核镜像 `bzImage` 到 `/boot/vmlinuz-<kernel_version>`
- 复制符号表 `System.map` 到 `/boot/System.map-<kernel_version>`
- 复制配置文件 `.config` 到 `/boot/config-<kernel_version>`
- 更新启动加载器 grub 配置。

### GRUB 更新

```shell
❯ sudo update-grub
```

扫描整个 `/boot` 目录，自动将新内核添加到引导菜单。

### 验证安装

```shell
❯ reboot
❯ uname -r  # 查看内核版本
❯ lsmod     # 查看加载的模块
```

---

> 交叉编译：为其他架构（如 ARM、RISC-V）编译内核，需指定架构和交叉编译器
>
> ```shell
> make ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu- defconfig
> make -j$(nproc) ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-
> ```

## Linux 应用开发

### 命令行参数解析

- 短选项字符串 `g_shortopts`，`:n:vh`
    - `:` 表示如果缺少必要的参数，返回 `:` 而不是默认的 `?`，便于自定义错误提示；
    - `n:` 表示 `-n` 后面需要参数；
    - `vh` 表示 `-n, -h` 后面不需要参数；

|              错误场景               |          `:n:vh` (首字符为 `:`)          |          `n:vh` (首字符不为 `:`)           |
| :---------------------------------: | :----------------------------------------: | :------------------------------------------: |
|     遇到未知选项 (如 `-x`)      |        返回 `?` 不打印错误信息         | 返回 `?` 自动打印错误信息到 stderr |
| 缺少必需参数 (如 `-n` 后无参数) |       返回 `:` 不打印错误信息        | 返回 `?` 自动打印错误信息到 stderr |
|        全局变量 `optopt`        | 保存导致错误的选项字符 (如 `x` 或 `n`) |  保存导致错误的选项字符 (如 `x` 或 `n`)  |

- 长选项字符串`getopt_long`

```c
static const struct option g_longopts[] = {
    {"number", required_argument, NULL, 'n'},
    {"version", no_argument, NULL, 'v'},
    {"help", no_argument, NULL, 'h'},
    {0, 0, 0, 0}  // 约定结束标志
};
```

---

被信号处理函数修改的全局变量加`volatile`关键字，随时可能被改变，不能缓存，每次都要去内存读取。

```c
static volatile sig_atomic_t g_quit = 0;

static void sig_handle(int sig) {
    (void)sig; /* suppress unused-parameter warning */
    g_quit = 1;
}

int main(int argc, char **argv) {
    /* sigaction gives more predictable behavior than signal() */
    struct sigaction sa = {
        .sa_handler = sig_handle,
        .sa_flags = 0,
    };
    sigemptyset(&sa.sa_mask);
    if (sigaction(SIGINT, &sa, NULL) < 0) {
        perror("sigaction");
        exit(EXIT_FAILURE);
    }
}
```

## 参考资料

- [TLT113-MiniEVM 工业评估板规格书](https://www.tronlong.com/download/L1VwbG9hZHMvMjAyNDA0LzY2MWU0NmQwMGJjNzgucGRm/VExUMTEzLU1pbmlFVk3lt6XkuJror4TkvLDmnb_op4TmoLzkuaYucGRm)

- [The Linux Kernel documentation](https://www.kernel.org/doc/html/latest/)

- [Linux 内核编译详解：从源码到启动的完整指南](https://geek-blogs.com/blog/linux-kernel-build/)

- [Linux 编译器详解：从基础原理到高级实践](https://geek-blogs.com/blog/linux-compiler/)
