---
title: DDS Compiler
tags:
  - DDS
  - IP Catalog
  - Xilinx
categories: 电子电路
mathjax: true
abbrlink: c8c59f13
date: 2024-07-22 20:08:28
---

## 设计原理

一个正弦波 $A\cos(\omega_ct+\varphi)$ 的幅度不是随时间 $t$ 线性变化的，但是相位 $\omega_ct+\varphi$ 是时间 $t$ 的线性函数。因此可以考虑用一个线性递增的变量存储相位，再将相位转换成相应的正弦波幅度。

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/ic/dds_phase.webp" width="80%" height="60%"/>

首先存储一个周期的正弦波，然后将相位 $2\pi$ 用 $N$ 比特量化，即平均分成 $2^N$ 份，以 $f_{clk}$ 的频率每始终周期转动 $\Delta\theta$，则可以得到输出频率为 $f_{out}$ 的信号，

$$
\begin{aligned}
f_{out} &= \dfrac{f_{clk}\Delta \theta}{2^{B_{\theta(n)}}}\\
\Delta \theta &= \dfrac{f_{out} 2^{B_{\theta(n)}}}{f_{clk}}
\end{aligned}
$$


可以看出，输出频率 $f_{out}$ 是参考时钟频率 $f_{clk}$、相位量化位宽 $B_{\theta(n)}$、和相位增量（频率控制字）$\Delta \theta$ 的函数。增加频率控制字，将得到更高频率的信号。

> 根据奈奎斯特采样定律，为了使波形不失真，需要满足 $f_{clk}\geq f_{out}$，则有
>
> $$
> \begin{aligned}
> \Delta \theta &\leq 2^{B_{\theta(n)}-1}\\
> f_{out} &\leq \dfrac{f_{clk}}{2}\\
> \end{aligned}
> $$
>
> $f_{out}$ 始终小于 $f_{clk}$，不妨将其看成是一个分频器，通过修改频率控制字分频参考时钟 $f_{clk}$，获得所需要的频率。

## 组成结构

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/ic/dds.webp" width="90%" height="60%"/>

如图，直接式数字频率合成器（Direct Digital Synthesizer，DDS）主要由 **相位累加器**、**波形查找表**、**数模转换器和低通滤波器** 等部分组成。

其中的核心部分是相位累加器，由一个 $B_{\theta(n)}$ 位累加器和 $B_{\theta(n)}$ 位寄存器构成，在每个参考时钟上升沿，累加器将频率控制字与累加寄存器的输出相加，结果作为寄存器新的输入。如此反复， 当累加器累加满时， 就会发生溢出，完成一个周期， 即 DDS 合成信号的一个频率周期。

波形查找表（Lookup Table，LUT）中存储了正弦波的数字幅度信息，每个地址对应一个相位点，每个相位点对应正弦波的一个幅度值。将相位累加寄存器的输出与相位控制字相加，作为波形查找表的输入地址，地址映射为正弦波幅度，输出到 D/A 转换器。

D/A 转换器将数字信号转换成模拟信号，再经低通滤波器滤除不需要的取样分量，最终得到所需信号。

## 量化性能

> 理想的 DDS 应满足：
>
> - 稳定的参考时钟
>
> - 波形查找表地址的位数等于相位累加器的位数；
> - 相位累加器位宽无限大，且都输出到查找表，没有截断；
> - 波形查找表幅度无量化误差，即幅值位数为 $\infty$；
> - D/A 转换器无误差、低通滤波器是理想的；

相位累加器的输出相位为 $\varPhi(n)=\mod(n\Delta\theta, 2^{B_{\theta(n)}})$，周期 $T_{\varPhi} = \dfrac{2^{B_{\theta(n)}}}{\gcd(2^{B_{\theta(n)}}, \Delta\theta)}$，则波形查找表输出的幅度序列为

$$
s(n) = \cos(2\pi\frac{n\Delta\theta}{2^{B_{\theta(n)}}}), n = 1,2,\cdots
$$

经过 D/A 转换器后

$$
\begin{aligned}
s(t)
&= [\sum_{n =-\infty}^{+\infty}s(n)\delta(t-nT_{clk})]*[u(t)-u(t-T_{clk})]\\
&= [\sum_{n =-\infty}^{+\infty}\cos(2\pi\frac{n\Delta\theta}{2^{B_{\theta(n)}}})\delta(t-nT_{clk})]*[u(t)-u(t-T_{clk})]\\
&(f_{out} = \dfrac{f_{clk}\Delta \theta}{2^{B_{\theta(n)}}})\\
&= [\sum_{n =-\infty}^{+\infty}\cos(2\pi f_{out}nT_{clk})\delta(t-nT_{clk})]*[u(t)-u(t-T_{clk})]\\
&= [\sum_{n =-\infty}^{+\infty}\cos(2\pi f_{out}t)\delta(t-nT_{clk})]*[u(t)-u(t-T_{clk})]\\
\end{aligned}
$$

令 $f(t) = \sum_{n=-\infty}^{+\infty}\cos(2\pi f_{out}t)\delta(t-nT_{clk})$，是 $\cos(2\pi f_{out}t)$ 的理想采样信号，令 $h(t) = u(t)-u(t-T_{clk})$。

则有 $f(t)$ 的频谱是 $\cos(2\pi f_{out}t)$ 的频谱以 $f_{clk}$ 为周期的延拓，得到 $s(t)$ 的频谱即理想的 DDS 输出频谱为

$$
\begin{aligned}
S(j\omega) &= \sum_{n =-\infty}^{+\infty} \pi [\delta(\omega+2\pi f_{out}-2\pi nf_{clk}) + \delta(\omega - 2\pi f_{out} -2\pi nf_{clk})] sin(\frac{\omega T_{clk}}{2})e^{-j\frac{\omega T_{clk}}{2}}\\
S(f)&=\sum_{n =-\infty}^{+\infty} \pi sinc\frac{\pi(nf_{clk}-f_{out})}{f_{clk}}e^{-j\pi\frac{nf_{clk}-f_{out}}{f_{clk}}}\delta(\omega+2\pi f_{out}-2\pi nf_{clk})\\
&+\sum_{n =-\infty}^{+\infty} \pi sinc\frac{\pi(nf_{clk}+f_{out})}{f_{clk}}e^{-j\pi\frac{nf_{clk}+f_{out}}{f_{clk}}}\delta(\omega-2\pi f_{out}-2\pi nf_{clk})
\end{aligned}
$$

由输出频谱的表达式可以看出，它的谱线分布在 $nf_{clk}\pm f_{out}$ 处，即 DDS 输出信号频谱的镜像分量总是在参考频率 $f_{clk}$ 的附近。因此，理想条件下，在 MATLAB 绘制的 $(0,\frac{f_{clk}}{2})$ 的功率谱密度图像中不应该存在其它的频率分量，如图（左）所示

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/ic/dds_error.webp" width="90%" height="60%"/>

<center> <small> DDS 的量化性能分析 </small> </center>

### DDS 的幅度量化误差

相位对应的幅度值是小数时，波形查找表不能够精确的存储，导致幅度的量化误差，DDS 输出的信号是周期性的，这种误差也具有周期性，体现在频谱上是周期性的频率分量。

为探究 DDS 幅度的量化误差对载波信号的影响，设定采样频率为 160MHz，载波频率为 21MHz，幅度的量化位数分别为 8 位和 16 位，得到的载波功率谱密度如上图（左、右）所示，右图对应的量化位数为 8 位，量化误差较大，因此存在很多高频分量，左图对应的量化位数为 16 位，精度较高，几乎没有高频分量。

### DDS 的相位截断误差

频率分辨率 $\dfrac{f_{clk}}{2^{\theta(n)}}$ 不可能无穷小，$\Delta\theta = \dfrac{f_{out}2^{B_{\theta(n)}}}{f_{clk}}$ 可能是小数，用二进整数表示时小数位要被去掉，造成误差；波形查找表的位数有限，会带来幅度量化误差；相位累加器的位数有限，则相位值会被截断，导致相位不连续和周期性误差，会在输出频谱中产生杂散。

控制变量“幅度的量化位数”8 位不变，改变相位量化位宽，得到功率谱密度图像如图所示，上图对应的相位量化位宽为 16 位，右图对应的相位量化位宽为 32 位。

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube@master/ic/dds_error.webp" width="90%" height="60%"/>

<center> <small> DDS 的量化性能分析 </small> </center>

DDS 的配置中用二进制整数表示频率控制字。由频率控制字的计算公式 $\Delta\theta = \dfrac{f_{out}2^{B_{\theta(n)}}}{f_{clk}}$ 可知，当参考频率为 $160MHz$，输出频率为 $21MHz$，相位量化位宽数为 16 或 32 时，需要的频率控制字不是整数，因此会带来相位截断误差。体现在频谱上，是信号频谱的杂散分量，随着相位量化位数增加，频率分辨率和相位精度提高，减少了因为相位截断造成的上图的杂散谱线

> 与 **[PLL](https://euler0525.github.io/blogs/posts/7f38126d/)** 相比：
>
> DDS 的频率分辨率高，可以生成多种波形；在高频段由较多的杂散分量
>
> PLL 输出频率更稳定，相位噪声更低

## MATLAB 仿真

```matlab
close all; clear; clc;

tic;

% FIXME System Parameters
fs = 160e3;
f_out = 10e3;                           % f_out < 80e3
phase_width = 16; N = 2 ^ phase_width;  % Phase width quantization (frequency resolution = fs / N;)
output_width = 16;                      % Magnitude quantization
phase_offset = 0;
phase_increment = f_out * N / fs;

n = 0 : 1/N : 1/4 - 1/N;
cos_rom = cos(2 * pi * n);
len_lut = length(cos_rom);

figure;
stem(cos_rom(1:len_lut));
xlabel("Points"); ylabel("Amplitude");
xlim([0, len_lut]); ylim([0, 1]);
title("Look-up Table (1/4 cos)"); grid on;


t_total = 1;
t = 0 : 1/fs : t_total - 1/fs;
dds_dout_len = length(t);

dds_dout = zeros(1, dds_dout_len);
phase_acc = phase_offset;

for i = 1:dds_dout_len
    idx = floor(mod(phase_acc, N));
    if idx == 0
        dds_dout(i) = 1;
    elseif idx > 0 && idx <= len_lut
        idx_new = idx;
        dds_dout(i) = 1 * cos_rom(idx_new);
    elseif idx > len_lut && idx <= len_lut * 2
        idx_new = 2 * len_lut + 1 - idx;
        dds_dout(i) = -1 * cos_rom(idx_new);
    elseif idx > len_lut * 2 && idx <= len_lut * 3
        idx_new = idx - 2 * len_lut;
        dds_dout(i) = -1 * cos_rom(idx_new);
    else
        idx_new = 4 * len_lut + 1 - idx;
        dds_dout(i) = 1 * cos_rom(idx_new);
    end
    phase_acc = phase_acc + phase_increment;
end

dds_dout = floor(dds_dout / max(dds_dout) * 2 ^ (output_width - 1));

figure;
subplot(2, 1, 1);
plot(t(1:2048), dds_dout(1:2048));
xlabel('Time (s)'); ylabel('Amplitude');
title('DDS Generated Signal'); grid on;
subplot(2, 1, 2);
pwelch(dds_dout);

sgtitle("Simulation of the Quantization Performance of DDS");

toc;
```

## IP Catalog 配置

详见 [Euler0525@Wiki/zynq/DDS Compiler](https://euler0525.github.io/wiki/zynq/#dds-compiler)

## 参考资料

- [A digital frequency synthesizer](https://ieeexplore.ieee.org/document/1162151)
- [PG141-DDS_Compiler](https://docs.amd.com/r/en-US/pg141-dds-compiler)
- [孙月.基于直接数字频率合成技术的信号发生器设计[D].西安电子科技大学,2015.DOI: 10.7666/d.D01067984.](https://kns.cnki.net/kcms2/article/abstract?v = kHMw6kznbppmhxTq-PrfPJFtHU8dEKHZ1Rq1l1ECYwrKqAitmkvYCWab3ga7R98VCY0fakkTWH6ZyKuqMOxkPqO-wE9zOAYvM8_xNqzxZ2A-f9Z7WMuiY3mnTDBD--yae0nDWqFo0WdcB5eaTZs_8IZOtGPh0pdaLzJ4wt_awm8tpT3JjdxwNqW2C2qzJQKBZlBilVlnwDI =&uniplatform = NZKPT&language = CHS)
