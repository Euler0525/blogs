---
title: m序列
tags:
  - 伪随机数
categories: 基础知识
mathjax: true
abbrlink: ecd1c85d
date: 2024-08-09 20:37:54
---

## 原理

m 序列长度为 $2^n-1$，具有强自相关性和低互相关性，具体体现为对极化之后相关运算的峰均比。

m 序列由线性反馈移位寄存器（Linear Feedback Shift Register，LFSR）生成，，取决于 LFSR 的阶数和生成种子（寄存器初始状态）。

- **阶数**

例如阶数为 $6$ 时，[本原多项式](https://baike.baidu.com/item/%E6%9C%AC%E5%8E%9F%E5%A4%9A%E9%A1%B9%E5%BC%8F/3246261) 为 $x^6+x+1$，则多项式共有 $7$ 位，对应 **LSFR** 有 $6$ 个寄存器，

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/others/m_serial.webp" alt="m_serial" width="100%;" height="100%" style="zoom:;" />

<center> <small> 阶数为 6 的 LFSR </small> </center>

- **生成种子**

生成种子不能为全 $0$，否则输出永远是 $0$.

## MATLAB 仿真

```matlab
function [pn] = mseq(coe)
    len = 2 ^ (length(coe) - 1)-1;
    pn = zeros(1, len);

    lfsr = randi([0 1], 1, (length(coe) - 1));
    % lfsr = [zeros(1, length(coe) - 2) 1];
    for i = 1: len
        pn(i) = lfsr(end);
        lfsr_front = 0;
        for j = (length(coe) - 1): -1: 1
            lfsr_front = lfsr_front + coe(j + 1) * lfsr(j);
        end
        lfsr_front = mod(sum(lfsr_front), 2);
        lfsr = [lfsr_front lfsr(1: end - 1)];
    end
end
```
