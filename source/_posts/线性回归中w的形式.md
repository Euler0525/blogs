---
title: 线性回归中w的形式
tags:
  - 线性回归
  - 范数
categories: 人工智能
mathjax: true
abbrlink: a337f68a
date: 2024-01-18 16:54:51
---

> 线性回归中 $w$ 的闭合形式可以写成 $\hat{w}=(X^TX)^{-1}X^Ty$.我想搞清楚这个式子的具体含义~

网上查到了一些有关这个表达式形式的解释，整理如下：

## 无脑推导

### 欧几里得范数

在探究这个式子的含义前，先无脑地推导一下：从解方程组 $y=Xw+\varepsilon$ 开始，即

$$
\begin{bmatrix}
y^{(1)}\\y^{(2)}\\\vdots\\y^{(m)}\\
\end{bmatrix}
=
\begin{bmatrix}
x_{1}^{(1)} & x_{2}^{(1)} & \cdots & x_{n}^{(1)}\\
x_{1}^{(2)} & x_{2}^{(2)} & \cdots & x_{n}^{(2)}\\
\vdots      & \ddots      & \ddots & \vdots     \\
x_{1}^{(m)} & x_{2}^{(m)} & \cdots & x_{n}^{(m)}\\
\end{bmatrix}
\begin{bmatrix}
w^{(1)}\\w^{(2)}\\\vdots\\w^{(n)}\\
\end{bmatrix}
+
\begin{bmatrix}
\varepsilon^{(1)}\\\varepsilon^{(2)}\\\vdots\\\varepsilon^{(m)}\\
\end{bmatrix}
$$

假设矩阵 $X$ 是满秩的，我们的目的是使 $||\varepsilon||^2$ 最小，即最小化 $\varepsilon^T\varepsilon$，

$$
\begin{aligned}
\varepsilon^T\varepsilon
&=
\begin{bmatrix}
\varepsilon^{(1)} & \varepsilon^{(2)} & \cdots & \varepsilon^{(m)}\\
\end{bmatrix}
\cdot
\begin{bmatrix}
\varepsilon^{(1)}\\\varepsilon^{(2)}\\\vdots\\\varepsilon^{(m)}\\
\end{bmatrix}
=
\sum_{i = 1}^m{(\varepsilon^{(m)})^2}\\
&= (y-Xw)^T(y-Xw) = y^Ty+w^TX^TXw-y^TXw-w^TX^Ty\\
&= y^Ty+w^TX^TXw-2w^TX^Ty\quad\Leftarrow(w^TX^Ty)_{1\times1}=(w^TX^Ty)^T = (y^TXw)_{1\times1}\\

\end{aligned}
$$

接下来，令 $\dfrac{\partial(\varepsilon^T\varepsilon )}{\partial w}=0$，即

$$
\frac{\partial(\varepsilon^T\varepsilon )}{\partial w}= 2X^TXw-2X^Ty = 0
$$

得到 $w=(X^TX)^{-1}X^Ty$.

### 投影

误差 $\varepsilon=y-\hat{y}=y-Xw$，当它与 $X$ 正交时，误差是最小的，即

$$
\begin{aligned}
<X, \varepsilon> = X^T\varepsilon &= 0\\
 X^T(y-Xw) &= 0\\
X^Ty&= X^TXw\\
w&= (X^TX)^{-1}X^Ty\\
\end{aligned}
$$

其实道理和范数是相通的……但还是没有找到让我'满意'的解释，或者说将 $X^{-1}y$ 与 $(X^TX)^{-1}X^Ty$ 对比，该如何正向思考这种类似于正定的形式。

## 一点思考

直觉上，这个表达式的形式给我一种正定矩阵构造的内积的感觉

$(X^TX)^{-1}$ 要想存在，必须保证 $X^TX$ 是可逆的，也就是说损失函数是凸函数，没有局部最小值，而是有全局最小值。
