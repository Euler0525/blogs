---
title: Cramér–Rao界的推导
tags:
  - 阵列信号处理
  - 统计信号处理
categories: 信号处理
mathjax: true
abbrlink: '807e8038'
date: 2025-12-04 17:13:17
---

> 本文的推导基于以下假设：
>
> 信号到达方向对于各个阵元是一致的；信号扫过阵列的过程中只考虑相移，忽略包络的变化。

设阵元数为 $M$，快拍数为 $N$，观测数据为

$$
x(t) = \mathbf{A}(\theta)\mathbf{s}(t) + \boldsymbol{\omega}(t) \quad t = 1,2,\cdots, N
$$

其中

- $\mathbf{s}(t) \in \mathbb{C}^{M\times 1}$，表示信号矢量；
- $\boldsymbol{\omega}(t)\in \mathbb{C}^{M\times 1}$，复加性高斯白噪声，各个阵元的噪声独立，且时间上互不相关，满足分布 $\boldsymbol{\omega}(t)\sim \mathcal{CN}(0, \sigma^2\mathbf{I_M})$；
- $\mathbf{x}(t) \in \mathbb{C}^{M\times 1}$，表示含噪声的接收数据矢量，满足分布 $\mathbf{x}(t)\sim \mathcal{CN}(\mathbf{A}(\theta)\mathbf{s}(t), \sigma^2\mathbf{I_M})$.

## 复高斯随机变量概率密度函数的推导

设复随机变量

$$
Z = X + jY\\
$$

其中 $X$ 与 $Y$ 均为实值随机变量，若 $Z$ 是一个复原对称高斯随机变量，则

- $X$ 与 $Y$ 相互独立；
- $X$ 与 $Y$ 满足 $X\sim \mathcal{N}(\mu, \dfrac{\sigma^2}{2}), Y\sim \mathcal{N}(\mu, \dfrac{\sigma^2}{2})$

- $Z$ 的均值表示为 $\mu = \mu_{X} + j\mu_{Y}$；

下面推导其概率密度函数（PDF），本质上是其 **实部与虚部的二维联合 PDF**。

因为 $X$ 与 $Y$ 独立，则联合密度为

$$
f_{X, Y}(x, y) = f_{X}(x) f_{Y}(y)
$$

其中

$$
\begin{aligned}
f_{X}(x) = \dfrac{1}{\sqrt{\pi\sigma^2}}\exp{\left( -\dfrac{(x-\mu_{X})^2}{\sigma^2} \right)}\\
f_{Y}(y) = \dfrac{1}{\sqrt{\pi\sigma^2}}\exp{\left( -\dfrac{(y-\mu_{Y})^2}{\sigma^2} \right)}\\
\end{aligned}
$$

因此

$$
\begin{aligned}
f_{X, Y}(x, y) &= f_{X}(x) f_{Y}(y)\\
&= \dfrac{1}{\pi\sigma^2}\exp{\left( -\dfrac{(x-\mu_{X})^2 + (y-\mu_{Y})^2}{\sigma^2} \right)}\\
\end{aligned}
$$

利用

$$
Z = X + jY, \mu = \mu_X + j\mu_Y
$$

得到

$$
|z - \mu|^2 = |(x-\mu_X) + j(y-\mu_Y)|^2 = (x-\mu_X)^2 + (y-\mu_Y)^2
$$

则

$$
\begin{aligned}
f_Z(z) &= f_{X, Y}(\Re{z}, \Im{z})\\
&= f_{X, Y}(x, y) = \dfrac{1}{\pi\sigma^2}\exp{\left( -\dfrac{(x-\mu_{X})^2 + (y-\mu_{Y})^2}{\sigma^2} \right)}\\
&= \dfrac{1}{\pi\sigma^2}\exp{\left(-\dfrac{|z-\mu|^2}{\sigma^2} \right)}\\
\end{aligned}
$$

得到了一维 **圆对称复高斯分布** 的概率密度函数。

对于 $m$ 维独立的复高斯随机变量，其联合概率密度函数为

$$
\begin{aligned}
p(\mathbf{z}) &= \prod_{i = 1}^m \dfrac{1}{\pi\sigma^2}\exp{\left(-\dfrac{|z-\mu|^2}{\sigma^2} \right)}\\
&= \prod_{i = 1}^m \dfrac{1}{(\pi\sigma^{2})^m}\exp{\left(-\dfrac{\sum_{i = 1}^m |z-\mu|^2}{\sigma^2} \right)}\\
&= \prod_{i = 1}^m \dfrac{1}{(\pi\sigma^{2})^m}\exp{\left(-\dfrac{||\mathbf{z} - \boldsymbol{\mu}||^2}{\sigma^2} \right)}\\
\end{aligned}
$$

## 对数似然函数的推导

观测数据 $\mathbf{x}(t)$ 满足分布 $\mathbf{x}(t)\sim \mathcal{CN}(\mathbf{A}(\theta)\mathbf{s}(t), \sigma^2\mathbf{I_M})$，均值向量为 $\boldsymbol{\mu}(t) = \mathbf{A}(\theta)\mathbf{s}(t)$，带入上式，得到单个快拍的 PDF 为

$$
p(\mathbf{x}(t)|\theta) = \dfrac{1}{(\pi \sigma^2)^{M}} \exp{\left(-\dfrac{1}{\sigma^2}||\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)||^2\right)}
$$

由于 $N$ 个快拍在时间上相互独立，则似然函数为各快拍 PDF 的乘积，即

$$
\begin{aligned}
\mathcal{L}(\theta) &= \prod_{t = 1}^N p(\mathbf{x}(t)|\theta)\\
&= \dfrac{1}{(\pi \sigma^2)^{MN}} \exp{\left(-\dfrac{1}{\sigma^2}\sum_{t = 1}^{N}||\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)||^2\right)}
\end{aligned}
$$

最终的对数似然函数为

$$
\ln \mathcal{L}(\theta) = -MN \ln{\pi\sigma^2} - \dfrac{1}{\sigma^2}\sum_{t = 1}^{N}||\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)||^2
$$

## Fisher 矩阵的推导

对于单个参数 $\theta$，Fisher 矩阵为

$$
\mathcal{I}(\theta) = -\mathrm{E}\left [\dfrac{\partial^2}{\partial\theta^2}\ln\mathcal{L}(\theta)\right]
$$

对于矢量参数 $\boldsymbol{\theta}\in \mathbb{R}^p$，Fisher 矩阵为

$$
\mathcal{I}_{ij}(\boldsymbol{\theta}) = -\mathrm{E}\left [\dfrac{\partial^2}{\partial\theta_i\partial \theta_j}\ln\mathcal{L}(\boldsymbol{\theta})\right]
$$

---

首先计算对数似然函数的一阶导数（忽略常数项）

$$
\begin{aligned}
\ln \mathcal{L}(\theta) &= C - \dfrac{1}{\sigma^2}\sum_{t = 1}^{N}||\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)||^2\\
&= C - \dfrac{1}{\sigma^2}\sum_{t = 1}^{N}\left(\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)\right)^{\dagger}\left(\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)\right)\\
\end{aligned}
$$

令 $z=\mathbf{x}(t),z_0(\theta) = \mathbf{A}(\theta)\mathbf{s}(t), e = z-z_0$，关注和参数 $\theta$ 有关的部分，

$$
\begin{aligned}
\mathcal{J}(\theta) &= - \dfrac{1}{\sigma^2}\sum_{t = 1}^{N}\left(\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)\right)^{\dagger}\left(\mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t)\right)\\
&= - \dfrac{1}{\sigma^2}\sum_{t = 1}^{N}e^{\dagger}e\\
\end{aligned}
$$

则有

$$
\begin{aligned}
\dfrac{\partial e^{\dagger}e}{\partial \theta} &= \left(-\dfrac{\partial z_0}{\partial \theta}\right)^{\dagger}e + e^{\dagger}\left(-\dfrac{\partial z_0}{\partial \theta}\right)\\
&= \left(-\dfrac{\partial z_0}{\partial \theta}\right)^{\dagger}e + \left [\left(-\dfrac{\partial z_0}{\partial \theta}\right)^{\dagger}e\right]^*\\
&= -2\Re{\left(\dfrac{\partial z_0}{\partial \theta}\right)^{\dagger}e}\\
&= -2\Re{\left(\dfrac{\partial z_0}{\partial \theta}\right)^{\dagger}(z-z_0)}\\
\end{aligned}
$$

令 $\mathbf{d}_{\theta}(t) = \dfrac{\partial z_0}{\partial \theta}= \dfrac{\partial \mathbf{A}(\theta)\mathbf{s}(t)}{\partial \theta}$ 代入到对数似然函数的导数中

$$
\dfrac{\ln\mathcal{L}(\theta)}{\partial \theta} = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\mathbf{d}^{\dagger}_{\theta}(t)\left [ \mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t) \right]}
$$

---

下面计算对数似然函数的二阶导数

已经得到一阶导数为

$$
\begin{aligned}
\dfrac{\partial \ln\mathcal{L}(\theta)}{\partial \theta} &= \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\mathbf{d}^{\dagger}_{\theta}(t)\left [ \mathbf{x}(t) - \mathbf{A}(\theta)\mathbf{s}(t) \right]}\\
&= \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\mathbf{d}^{\dagger}_{\theta}(t)\boldsymbol{\omega}(t)}\\
\end{aligned}
$$

对于复加性高斯白噪声，$\boldsymbol{\omega}(t)\sim \mathcal{CN}(0, \sigma^2\mathbf{I_M})$，因此

$$
\mathrm{E}(\boldsymbol{\omega}(t)) = 0, \space \mathrm{E}(\boldsymbol{\omega}(t)\boldsymbol{\omega}(t)^{\dagger}) = \boldsymbol{\sigma}^2I_M
$$

并且

$$
\mathrm{E}(\mathbf{d}_{\theta}(t)^{\dagger}\boldsymbol{\omega}(t)) = 0, \space \mathrm{E}(\boldsymbol{\omega}(t)^{\dagger}\mathbf{d}_{\theta}(t)) = 0
$$

于是似然函数的二阶导为

$$
\dfrac{\partial^2 \ln\mathcal{L}(\theta)}{\partial \theta^2} = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\dfrac{\partial}{\partial \theta}\left[\mathbf{d}^{\dagger}_{\theta}(t)\boldsymbol{\omega}(t)\right]}\\
$$

其中

$$
\begin{aligned}
\dfrac{\partial \boldsymbol{\omega}(t)}{\partial \theta} &= -\mathbf{d}_{\theta}(t)\\
\dfrac{\partial}{\partial \theta}\left[\mathbf{d}^{\dagger}_{\theta}(t)\boldsymbol{\omega}(t)\right] &= \left(\dfrac{\partial \mathbf{d}_{\theta}(t)}{\partial \theta}\right)^{\dagger}\boldsymbol{\omega}(t) + \mathbf{d}^{\dagger}_{\theta}(t)(-\mathbf{d}_{\theta}(t))
\end{aligned}
$$

代入对数似然函数二阶导数的表达式得到

$$
\begin{aligned}
\dfrac{\partial^2 \ln\mathcal{L}(\theta)}{\partial \theta^2} &= \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\dfrac{\partial}{\partial \theta}\left[\mathbf{d}^{\dagger}_{\theta}(t)\boldsymbol{\omega}(t)\right]}\\
&= \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}
\Re{\left(\dfrac{\partial \mathbf{d}_{\theta}(t)}{\partial \theta}\right)^{\dagger}\boldsymbol{\omega}(t) - \mathbf{d}^{\dagger}_{\theta}(t)\mathbf{d}_{\theta}(t)}\\
\end{aligned}
$$

其中 $\mathbf{d}_{\theta}(t) = \dfrac{\partial \mathbf{A}(\theta)\mathbf{s}(t)}{\partial \theta}$.

---

下面取期望得到 Fisher 信息

$$
\mathcal{I}(\theta) = -\mathrm{E}\left [\dfrac{\partial^2}{\partial\theta^2}\ln\mathcal{L}(\theta)\right]
$$

对数似然函数的二阶表达式中

$$
\begin{aligned}
\mathrm{E}\left[ \left(\dfrac{\partial \mathbf{d}_{\theta}(t)}{\partial \theta}\right)^{\dagger}\boldsymbol{\omega}(t) \right] &= 0\\
\mathrm{E}\left [ \mathbf{d}^{\dagger}_{\theta}(t)\mathbf{d}_{\theta}(t) \right] &= \mathbf{d}^{\dagger}_{\theta}(t)\mathbf{d}_{\theta}(t)
\end{aligned}
$$

那么

$$
\mathcal{I}(\theta) = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}||\mathbf{d}_{\theta}(t)||^2 = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}||\mathbf{A}'(\theta)\mathbf{s}(t)||^2
$$

对于多参数的情况，即 $\boldsymbol{\theta} = [\theta_1,\theta_2,\cdots, \theta_p]^{\top}$，

$$
\mathcal{I}_{ij} = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}\Re{\mathbf{d}^{\dagger}_{\theta}(t)\mathbf{d}_{\theta}(t)} = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}\Re{\mathbf{s}(t)^{\dagger}\left( \mathbf{A}'_{\theta_i}(t) \right)^{\dagger}\mathbf{A}'_{\theta_j}(t)\mathbf{s}(t)}
$$

## CRLB 的推导

对于实参数 $\theta$，其 **Cramér–Rao 下界** 为

$$
\mathrm{Var}(\hat{\theta}) \geq \dfrac{1}{\mathcal{I}(\theta)}\\
$$

则

$$
\mathrm{CRB}(\theta) = \dfrac{\sigma^2}{2\sum_{t = 1}^{N}||\mathbf{A}'(\theta)\mathbf{s}(t)||^2}
$$

### 单信号源+均匀线阵

下面考虑 **单信号源**，**ULA 阵列**，设阵元数为 $M$，阵元间距 $d=\dfrac{\lambda}{2}$，ULA 导向矢量为

$$
\mathbf{a}(\theta) =
\begin{bmatrix}
    1                                               \\
    e^{-j\frac{2\pi d\sin{\theta}}{\lambda}}      \\
    \vdots                                          \\
    e^{-j\frac{2\pi d(M-1)\sin{\theta}}{\lambda}} \\
\end{bmatrix}
$$

导向矢量对参数 $\theta$ 的导数为

$$
\dfrac{\partial a(\theta)}{\partial \theta} = -j\dfrac{2\pi d}{\lambda}\cos(\theta)
\begin{bmatrix}
    1                                               \\
    e^{-j\frac{2\pi d\sin{\theta}}{\lambda}}      \\
    \vdots                                          \\
    (M-1)e^{-j\frac{2\pi d(M-1)\sin{\theta}}{\lambda}} \\
\end{bmatrix}
$$

2-范数平方为

$$
\begin{aligned}
||a'(\theta)||^2 &= \left(\dfrac{2\pi d}{\lambda}\cos(\theta)\right)^2 \sum_{m = 0}^{M-1} m^2\\
&= \left(\dfrac{2\pi d}{\lambda}\cos(\theta)\right)^2 \dfrac{M(M-1)(2M-1)}{6}
\end{aligned}
$$

最终得到单信源， ULA 阵列的 **Cramér–Rao 下界** 为

$$
\begin{aligned}
\mathrm{CRB}(\theta) &= \dfrac{\sigma^2}{2\sum_{t = 1}^{N}||\mathbf{A}'(\theta)\mathbf{s}(t)||^2}\\
&= \dfrac{\sigma^2}{2N|\mathbf{s}(t)|^2||a'(\theta)||^2}\\
&= \dfrac{3\lambda^2}{N\cdot\mathrm{SNR}\cdot\left(2\pi d\cos(\theta)\right)^2 M(M-1)(2M-1)}
\end{aligned}
$$

### 单信号源+均匀面阵

下面考虑 **单信号源**，**UPA 阵列**，设水平方向阵元数为 $M$，垂直方向阵元数为 $N$，则总阵元数为 $MN$，设入射角的俯仰角为 $\phi$，方位角为 $\theta$，则 UPA 的导向矢量表示为

$$
a(\theta, \phi) = e^{-j\frac{2\pi d}{\lambda}(m\sin\theta\cos\phi + n\sin\theta\sin\phi)}
$$

其中，

$$
\left\{
\begin{aligned}
m &= 0,1,\cdots, M - 1\\
n &= 0,1,\cdots, N - 1\\
\end{aligned}
\right.
$$

导向矢量对方位角和俯仰角求偏导

$$
\begin{aligned}
\dfrac{\partial a_{m, n}}{\partial \theta} &= -j\dfrac{2\pi d}{\lambda}(m\cos\theta\cos\phi + n\cos\theta\sin\phi) a_{m, n}\\
\dfrac{\partial a_{m, n}}{\partial \phi} &= -j\dfrac{2\pi d}{\lambda}(-m\sin\theta\sin\phi + n\sin\theta\cos\phi) a_{m, n}\\
\end{aligned}
$$

下面求 Fisher 矩阵，对于二维参数 $\boldsymbol{\theta} = [\theta, \phi]$，

$$
\mathcal{I} = \begin{bmatrix}
\mathcal{I}_{\theta\theta} & \mathcal{I}_{\theta\phi}\\
\mathcal{I}_{\phi\theta} & \mathcal{I}_{\phi\phi}\\
\end{bmatrix}
$$


其中

$$
\mathcal{I}_{ij} = \dfrac{2}{\sigma^2} \sum_{t = 1}^{N}\Re{\mathbf{d}^{\dagger}_{\theta}(t)\mathbf{d}_{\theta}(t)} = \dfrac{2N|s(t)|^2}{\sigma^2} \Re{((a_i')^{\dagger}a_j'}\\
$$

对于方位角 $\theta$

$$
\mathcal{I}_{\theta\theta} = \dfrac{2N|s(t)|^2}{\sigma^2} \Re{\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)^{\dagger}\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)}\\
$$

$$
\left| \dfrac{\partial a_{m, n}}{\partial \theta} \right|^2
= \left(\dfrac{2\pi d}{\lambda}\right)^2\cos^2\theta(m\cos\phi + n\sin\phi)^2
$$

则

$$
\begin{aligned}
\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)^{\dagger}\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)
&= \left(\dfrac{2\pi d}{\lambda}\right)^2\cos^2\theta \sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1} (m\cos\phi + n\sin\phi)^2\\
&= \left(\dfrac{2\pi d}{\lambda}\right)^2\cos^2\theta \sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1} (m^2\cos^2\phi + n^2\sin^2\phi + 2mn\cos\phi\sin\phi)\\
\end{aligned}
$$

其中

$$
\begin{aligned}
\sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1}m^2\cos^2\phi &= N\cos^2\phi\dfrac{M(M-1)(2M-1)}{6}\\
\sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1}n^2\sin^2\phi &= M\sin^2\phi\dfrac{N(N-1)(2N-1)}{6}\\
\sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1}2mn\cos\phi\sin\phi &= 2\cos\phi\sin\phi\dfrac{M(M-1)}{2}\dfrac{N(N-1)}{2}\\
\end{aligned}
$$

得到

$$
\begin{aligned}
\mathcal{I}_{\theta\theta} &= \dfrac{2N|s(t)|^2}{\sigma^2} \Re{\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)^{\dagger}\left(\dfrac{\partial \mathbf{a}}{\partial \theta}\right)}\\
&= \dfrac{2N|s(t)|^2}{\sigma^2} \left\{ \left(\dfrac{2\pi d}{\lambda}\right)^2\cos^2\theta \sum_{m = 0}^{M-1}\sum_{n = 0}^{N-1} (m^2\cos^2\phi + n^2\sin^2\phi + 2mn\cos\phi\sin\phi) \right\}\\
&= \dfrac{2N|s(t)|^2}{\sigma^2}  \left(\dfrac{2\pi d}{\lambda}\right)^2\cos^2\theta
\left( \cos^2\phi\dfrac{MN(M-1)(2M-1)}{6} + \sin^2\phi\dfrac{MN(N-1)(2N-1)}{6} + \cos\phi\sin\phi\dfrac{MN(M-1)(N-1)}{2} \right)\\
\end{aligned}
$$

同理，可以求得

$$
\begin{aligned}
\mathcal{I}_{\phi\phi} &= \dfrac{2N|s(t)|^2}{\sigma^2}  \left(\dfrac{2\pi d}{\lambda}\right)^2\sin^2\theta
\left( \sin^2\phi\dfrac{MN(M-1)(2M-1)}{6} + \cos^2\phi\dfrac{MN(N-1)(2N-1)}{6}
- \cos\phi\sin\phi\dfrac{MN(M-1)(N-1)}{2} \right)\\

\mathcal{I}_{\theta\phi} &= \dfrac{2N|s(t)|^2}{\sigma^2}  \left(\dfrac{2\pi d}{\lambda}\right)^2\dfrac{\sin2\theta}{24}\cdot MN\cdot
\left(\sin2\phi \left [(N-1)(2N-1) - (M-1)(2M-1)\right] + 3\cos2\phi(M-1)(N-1) \right)
\end{aligned}
$$

最终的 **Fisher** 矩阵

$$
\mathcal{I} = \begin{bmatrix}
\mathcal{I}_{\theta\theta} & \mathcal{I}_{\theta\phi}\\
\mathcal{I}_{\theta\phi} & \mathcal{I}_{\phi\phi}\\
\end{bmatrix}
$$

最终的 **CRLB** 表示为

$$
\begin{aligned}
\mathrm{CRLB}_{\theta} &= [\mathcal{I}^{-1}]_{\theta\theta} = \dfrac{\mathcal{I}_{\phi\phi}}{\mathcal{I}_{\theta\theta}\mathcal{I}_{\phi\phi}-\mathcal{I}^2_{\theta\phi}}\\
\mathrm{CRLB}_{\phi} &= [\mathcal{I}^{-1}]_{\phi\phi} = \dfrac{\mathcal{I}_{\theta\theta}}{\mathcal{I}_{\theta\theta}\mathcal{I}_{\phi\phi}-\mathcal{I}^2_{\theta\phi}}\\
\end{aligned}
$$
