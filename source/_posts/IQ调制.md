---
title: IQ调制
tags:
  - QPSK
categories: 通信
mathjax: true
abbrlink: bd1f7a33
date: 2024-08-02 19:06:43
---

假设要发送的基带码元为 $I+jQ$，其中 $I$ 是同相分量，$Q$ 是正交分量。首先对码元做上变频

$$
\begin{aligned}
(I+jQ)e^{j\omega_c t} &= (I+jQ)(\cos\omega_c t + j\sin\omega_ct)\\
&=(I\cos\omega_ct - Q\sin\omega_ct) + j(I\sin\omega_ct+Q\cos\omega_ct)
\end{aligned}
$$

取其实部得到调制后的信号为

$$
s(t) = I\cos\omega_ct-Q\sin\omega_ct
$$

---

接收端收到的信号为

$$
\begin{aligned}
r(t) &= I\cos\omega_ct-Q\sin\omega_ct\\
&=\frac{1}{2}I(e^{j\omega_ct}+e^{-j\omega_ct})+\frac{j}{2}Q(e^{j\omega_ct}-e^{-j\omega_ct})\\
\end{aligned}
$$

进行下变频

$$
\begin{aligned}
r(t)e^{-j\omega_ct} &= [\frac{1}{2}I(e^{j\omega_ct}+e^{-j\omega_ct})+\frac{j}{2}Q(e^{j\omega_ct}-e^{-j\omega_ct})] e^{-j\omega_ct}\\
&= \frac{1}{2}(I + jQ) + \frac{1}{2}(I-jQ)e^{-2\omega_ct}
\end{aligned}
$$

再通过积分器或者低通滤波器

$$
\frac{2}{T}\int_T\frac{1}{2}(I + jQ) + \frac{1}{2}(I-jQ)e^{-2\omega_ct}= I+jQ
$$

得到原始码元 $I+jQ$.
