---
title: 理想AD的量化信噪比
tags:
  - 信噪比
  - AD
categories: 通信
mathjax: true
abbrlink: '176915e8'
date: 2025-11-22 13:31:28
---

设 AD 满量程输入范围为 $[-A_p, A_p]$，其中 $A_p$ 是峰值电压，ADC 每次采样输出的二进制位数为 $n$，有效量化等级数为 $L = 2^n$ 则量化步长为

$$
\Delta = \dfrac{2A_p}{2^n}\\
$$

量化误差假设为均匀分布在 $[-\dfrac{\Delta}{2}, \dfrac{\Delta}{2}]$ 之间，均值为零，则方差（量化噪声的功率）为

$$
\sigma^2 = \dfrac{\Delta^2}{12}\\
$$

*附：均匀分布 $x\sim U(a, b)$ 的方差为 $\sigma^2=\dfrac{(b-a)^2}{12}$.*

满幅的正弦信号

$$
\begin{aligned}
s(t) &= A_p \cos(\omega t)\\
A_{rms} &= \dfrac{A_p}{\sqrt{2}}\\
P_s &= A_{rms}^2 = \dfrac{A_p^2}{2}\\
\end{aligned}
$$

则理想的 SNR 为

$$
\begin{aligned}
SNR &= \dfrac{P_s}{\sigma^2} = \dfrac{3\times 2^{2n}}{2}\\
[SNR]_{dB} &= 6.02n+1.76
\end{aligned}
$$

物理上，$n$ 越大，表示量化步长 $\Delta$ 越精细，量化误差（噪声）越小，SNR 越高。由于器件噪声、非线性失真等因素，真实有效位数可能小于标称的位数，可以根据实际测得的 SNR 反推出真实的有效位数 $n$.
