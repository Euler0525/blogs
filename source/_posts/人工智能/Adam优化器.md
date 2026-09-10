---
title: Adam 优化器
description: 从随机梯度下降的局限性引出 Adam 优化器，并分析其实现机制、优势与限制。
tags:
  - 梯度下降
  - Adam
categories:
  - 人工智能
  - 大模型训练
abbrlink: e31a6d4c
date: 2026-09-11 09:34:22
---

# Adam 优化器

## 梯度下降

假设模型参数是 $\theta$，损失函数是 $f(\theta)$。我们希望不断调整 $\theta$，让损失变小。

梯度 $g_t$ 表示当前位置损失增长最快的方向，因此朝梯度的反方向移动，就有机会让损失下降：

$$
g_t =\nabla_\theta f_t(\theta_{t-1}),
$$

$$
\theta_t =\theta_{t-1}-\alpha g_t.
$$

这里 $\alpha$ 是学习率。可以把它理解成“每一步迈多大”。如果只有一个参数，那么这件事非常直观：梯度为正就向左走，梯度为负就向右走，梯度绝对值越大说明当前位置越陡。

但神经网络有成千上万甚至数十亿个参数，而且每一步通常只看一个 mini-batch。于是实际得到的 $g_t$ 并不是完整数据集上的精确梯度，而只是一个带噪声的估计。Dropout、数据增强等机制还会进一步增加这种随机性。这时，最朴素的 SGD 会逐渐暴露出两个核心问题。

- 当前梯度不一定是可靠方向：假设某个参数连续几步得到的梯度一直正负交替。SGD 每一步都会立刻相信当前梯度，于是参数会不断左右摇摆。这并不一定意味着模型完全不知该往哪走，而可能只是 mini-batch 噪声导致单步梯度不稳定。因此我们希望优化器不要只看“这一刻”，还要参考最近几步的方向。

- 不同参数的梯度尺度可能差很多：不同层、不同参数的数值尺度、激活范围和曲率可能完全不同。所有参数不能都共享一个固定学习率，因此 **优化器最好能根据每个参数自己的历史梯度尺度，自动调整它的有效步长。**

| 问题 | 我们希望优化器学到什么 |
| --- | --- |
| 单步梯度方向很抖 | 最近一段时间整体往哪边走 |
| 不同参数梯度尺度差很多 | 每个参数通常有多大的梯度 |

Adam 的两个核心状态 $m_t$ 和 $v_t$，本质上就是分别回答这两个问题。

## Momentum：把“方向”变得稳定

Momentum 的想法非常简单：**不要完全相信当前梯度，把最近一段时间的梯度做一个平滑平均。**

它维护一个状态 $m_t$：

$$
m_t =\beta_1m_{t-1}+(1-\beta_1)g_t.
$$

然后不再直接用 $g_t$ 更新，而是使用 $m_t$：

$$
\theta_t =\theta_{t-1}-\alpha m_t.
$$

如果 $\beta_1=0.9$，可以把它理解成：新的 $m_t$ 有 90% 来自过去的趋势，10% 来自当前梯度。

把递推展开：

$$
m_t =(1-\beta_1)\sum_{i = 1}^{t}\beta_1^{t-i}g_i.
$$

这就是指数滑动平均（Exponential Moving Average，EMA）。越新的梯度权重越高，越旧的梯度影响按指数衰减。

它带来的效果很符合直觉：

- 如果连续很多步梯度方向一致，这些方向会不断积累，$m_t$ 会稳定地指向同一边；
- 如果梯度不断正负震荡，它们会在平均过程中互相抵消，参数不会跟着每个 mini-batch 左右乱跳。

因此 Momentum 主要解决的是 **方向稳定性**。但它还没有解决第二个问题：如果不同参数的梯度尺度相差几十倍、几百倍，Momentum 仍然使用同一个全局学习率 $\alpha$。

## AdaGrad：让每个参数拥有自己的有效步长

如果一个参数长期梯度都很大，我们可能应该对它谨慎一点；如果另一个参数很少得到非零梯度，则不应该因为其他参数梯度大就一起缩小步长。

AdaGrad 的做法是为每个参数累计历史平方梯度：

$$
G_t =\sum_{i = 1}^{t}g_i^2.
$$

这里的平方是逐元素平方。更新变为

$$
\theta_t =\theta_{t-1}-\alpha\frac{g_t}{\sqrt{G_t}+\epsilon}.
$$

因为我们现在关心的是“梯度通常有多大”，而不是方向。平方后无论梯度为正还是为负，都变成正数。

如果某个参数经常出现大梯度，它的 $G_t$ 会越来越大，分母也越来越大，于是有效学习率自动减小；如果某个参数只偶尔得到梯度，它的累计值较小，就能保留相对较大的更新。这就是“逐参数自适应学习率”的基本思想。

但是，AdaGrad 的 $G_t$ 从训练开始一直累加：

$$
G_t = g_1^2+g_2^2+\cdots+g_t^2.
$$

只要梯度不全为零，$G_t$ 通常就会越来越大，分母只增不减。训练足够久以后，有效学习率可能被压得非常小，参数几乎走不动。问题不在于“根据历史调整步长”这个方向错了，而在于它把太久以前的历史也永久保留了下来。

---

RMSProp 对 AdaGrad 做了一个关键修改：**不再永久累计所有平方梯度，而是像 Momentum 一样使用指数滑动平均。**

它维护

$$
v_t =\beta_2v_{t-1}+(1-\beta_2)g_t^2,
$$

并使用

$$
\theta_t =\theta_{t-1}-\alpha\frac{g_t}{\sqrt{v_t}+\epsilon}.
$$

$v_t$ 可以理解成“最近一段时间，这个参数的梯度平方通常有多大”。

这样一来：

- 梯度长期很大的参数，$v_t$ 较大，更新会被压小；
- 梯度长期较小的参数，$v_t$ 较小，可以获得更大的相对步长；
- 很久以前的大梯度会逐渐被遗忘，不会像 AdaGrad 那样永远留在分母里。

至此

- Momentum 在平均 $g_t$，目的是估计 **方向**；
- RMSProp 在平均 $g_t^2$，目的是估计 **尺度**。

## Adam：同时估计“方向”和“尺度”

**先用 Momentum 的方式估计最近整体往哪里走，再用 RMSProp 的方式估计每个参数最近的梯度尺度，最后用后者去归一化前者。**

第 $t$ 步先计算当前梯度

$$
g_t =\nabla_\theta f_t(\theta_{t-1}).
$$

然后维护两个状态。

第一个状态是梯度的指数滑动平均：

$$
m_t =\beta_1m_{t-1}+(1-\beta_1)g_t.
$$

它告诉我们：**最近的梯度整体想往哪里走？**

第二个状态是平方梯度的指数滑动平均：

$$
v_t =\beta_2v_{t-1}+(1-\beta_2)g_t^2.
$$

它告诉我们：**这个参数最近的梯度通常有多大？**

如果暂时忽略初始化偏差修正，Adam 的核心更新思想就是

$$
\theta_t\approx\theta_{t-1}-\alpha\frac{m_t}{\sqrt{v_t}+\epsilon}.
$$

这个式子已经足够建立最重要的直觉：

- 分子 $m_t$ 决定“往哪走”；
- 分母 $\sqrt{v_t}$ 决定“这个坐标要把步子缩放到什么程度”；
- $\alpha$ 决定所有参数共享的基础步长量级。

在论文和框架文档里，经常会看到“一阶矩估计”和“二阶原始矩估计”。初学时不要先被术语吓到。$m_t$ 本质上就是对梯度 $g$ 做 EMA，它近似在估计梯度的平均值，所以称为一阶矩估计。$v_t$ 是对 $g^2$ 做 EMA，它近似在估计平方梯度的平均值，所以称为二阶原始矩估计。

注：$v_t$ 不是梯度的方差。方差通常涉及 $\mathbb E[g^2]-\mathbb E[g]^2$，而 Adam 直接使用的是平方梯度的平均。

---

Adam 通常从

$$
m_0 = 0,\qquad v_0 = 0
$$

开始。再做 bias correction：

$$
\hat m_t =\frac{m_t}{1-\beta_1^t},
$$

$$
\hat v_t =\frac{v_t}{1-\beta_2^t}.
$$

> 为什么不能直接使用 $m_t$ 和 $v_t$？
>
> 因为 EMA 从 0 开始，训练最初会偏小。假设第一步只有一个梯度 $g_1$，那么
>
> $$
> m_1 =(1-\beta_1)g_1.
> $$
>
> 如果 $\beta_1=0.9$，就得到
>
> $$
> m_1 = 0.1g_1.
> $$
>
> 这并不是因为我们真的观察到“历史平均梯度只有 $0.1g_1$”，而只是因为在训练开始前没有历史数据，却人为把初始状态设成了 0。
>
> 同理，当 $\beta_2=0.999$ 时
>
> $$
> v_1 = 0.001g_1^2.
> $$
>
> 第一步的平方梯度统计量被严重压小。
>
> Adam 用
>
> $$
> \hat m_1 =\frac{(1-\beta_1)g_1}{1-\beta_1}= g_1,
> $$
>
> $$
> \hat v_1 =\frac{(1-\beta_2)g_1^2}{1-\beta_2}= g_1^2
> $$
>
> 把这部分因为从 0 启动而造成的低估消掉。
>
> 更一般的推导，以 $v_t$ 为例：
>
> $$
> v_t =\beta_2v_{t-1}+(1-\beta_2)g_t^2.
> $$
>
> 从 $v_0=0$ 展开得到
>
> $$
> v_t =(1-\beta_2)\sum_{i = 1}^{t}\beta_2^{t-i}g_i^2.
> $$
>
> 如果一段时间内梯度二阶矩近似平稳，即
>
> $$
> \mathbb E [g_i^2]\approx\mathbb E [g_t^2],
> $$
>
> 则
>
> $$
> \mathbb E [v_t]
> \approx
> (1-\beta_2^t)\mathbb E [g_t^2].
> $$
>
> 因此 $v_t$ 相比真正想估计的平方梯度平均少了一个 $1-\beta_2^t$，于是除以它：
>
> $$
> \hat v_t =\frac{v_t}{1-\beta_2^t}.
> $$
>
> $m_t$ 同理。当训练进行很多步以后，$\beta_1^t$ 和 $\beta_2^t$ 都会逐渐趋近于 0，偏差修正的影响自然变小。所以它主要是在训练早期发挥作用。

最终更新为

$$
\boxed{
\theta_t =\theta_{t-1}-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}
}
$$

原论文给出的经典默认值是

$$
\alpha = 10^{-3},\qquad
\beta_1 = 0.9,\qquad
\beta_2 = 0.999,\qquad
\epsilon = 10^{-8}.
$$

| 符号 | 含义 |
| :-: | --- |
| $g_t$ | 当前 mini-batch 给出的梯度 |
| $m_t$ | 最近一段时间的平均方向 |
| $v_t$ | 最近一段时间的梯度尺度 |
| $\hat m_t,\hat v_t$ | 修正了启动偏差后的统计量 |
| $\alpha$ | 整体基础步长 |
| $\epsilon$ | 防止分母过小的稳定项 |

### Adam 的有效步长

忽略 $\epsilon$，单个参数坐标的更新量可以写成

$$
\Delta_t =-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}}.
$$

这里最值得观察的是比值

$$
\frac{\hat m_t}{\sqrt{\hat v_t}}.
$$

如果最近很多步梯度方向一致，那么 $\hat m_t$ 不容易互相抵消；如果梯度方向一直正负乱跳，$\hat m_t$ 会变小。

与此同时，$\hat v_t$ 反映的是梯度整体幅度。于是这个比值在直觉上同时考虑了两件事：

- 方向是否持续一致；
- 梯度本身通常有多大。

原论文把它类比为一种 signal-to-noise ratio。可以把它理解为一种“方向可信度经过尺度归一化后的结果”。

因此：

- 方向稳定时，Adam 更愿意沿这个方向前进；
- 方向噪声很大时，$m_t$ 被抵消，更新自动缩小；
- 某个参数梯度长期很大时，$v_t$ 会增大，从而抑制它的有效步长。

### Adam 对梯度整体缩放近似不敏感

如果某个坐标上的所有梯度都乘以常数 $c$：

$$
g_t'= cg_t,
$$

那么一阶矩也乘以 $c$：

$$
\hat m_t'= c\hat m_t,
$$

二阶矩则乘以 $c^2$：

$$
\hat v_t'= c^2\hat v_t.
$$

忽略 $\epsilon$ 时

$$
\frac{\hat m_t'}{\sqrt{\hat v_t'}}
=
\frac{c\hat m_t}{\sqrt{c^2\hat v_t}}
\approx
\frac{\hat m_t}{\sqrt{\hat v_t}}.
$$

这说明单纯把某个坐标的梯度整体放大，并不会让 Adam 的更新同比例放大。

## 超参数

- 学习率 $\alpha$

经典默认值是 `1e-3`。它决定整个优化器的基础更新量级。Adam 会对不同参数做自适应缩放，但它并没有取消学习率。可以理解成：Adam 在 $\alpha$ 给定的总尺度上，再针对不同参数进行相对调整。所以如果学习率大几个数量级，Adam 一样可能发散。

- $\beta_1$

经典默认值是 `0.9`：

$$
m_t = 0.9m_{t-1}+0.1g_t.
$$

它控制“方向记忆”有多长。

$\beta_1$ 越大，方向越平滑，但对新变化反应越慢；越小，则越接近直接相信当前梯度。

- $\beta_2$

经典默认值是 `0.999`：

$$
v_t = 0.999v_{t-1}+0.001g_t^2.
$$

它控制“梯度尺度记忆”有多长。

$\beta_2=0.999$ 意味着 $v_t$ 变化非常慢，这能避免一次异常大的 mini-batch 梯度立刻把尺度估计完全改变。对稀疏梯度而言，更长的统计窗口也有助于得到稳定尺度。但 $\beta_2$ 越接近 1，从 0 初始化产生的启动偏差持续得越久，因此 bias correction 也越重要。

- $\epsilon$

经典默认值是 `1e-8`：

$$
\theta_t =\theta_{t-1}-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}.
$$

它最直接的作用是防止分母为 0。但当 $\hat v_t$ 很小时，$\epsilon$ 也会直接影响有效步长，所以它并不总是一个完全可以忽略的装饰项。

## SGD、Momentum、AdaGrad、RMSProp、Adam 的关系

| 方法 | 是否平滑方向 | 是否统计梯度尺度 | 是否逐参数调步长 | 主要问题或特点 |
| :-: | :-: | :-: | :-: | --- |
| SGD | 否 | 否 | 否 | 简单，但直接相信当前梯度 |
| Momentum | 是 | 否 | 否 | 减少方向震荡 |
| AdaGrad | 否 | 累积平方梯度 | 是 | 稀疏梯度友好，但步长可能不断衰减 |
| RMSProp | 否 | 平方梯度 EMA | 是 | 只关注近期尺度，适合非平稳目标 |
| Adam | 是 | 平方梯度 EMA | 是 | 同时估计方向与尺度，并做 bias correction |

Adam 的更新可以写成

$$
D_t =
\operatorname{diag}
\left(
\frac{1}{\sqrt{\hat v_t}+\epsilon}
\right),
$$

$$
\theta_t =\theta_{t-1}-\alpha D_t\hat m_t.
$$

$D_t$ 是一个对角矩阵。它为每个参数坐标分配不同的缩放系数。因此，Adam 不只是“带 Momentum 的 SGD”。它还在根据历史平方梯度动态改变参数空间不同坐标轴的尺度。

从优化角度看，这可以理解为一种廉价的 **对角预条件器（diagonal preconditioner）**。它不需要构造完整 Hessian，也不需要矩阵求逆，却能利用每个坐标自己的历史统计信息改变更新尺度。原论文还把 $\hat v_t$ 与 Fisher 信息矩阵的对角近似联系起来。不过 Adam 仍然是一阶、对角近似方法，不能等同于完整自然梯度或真正的二阶优化。

## PyTorch 里如何使用 Adam

理解公式以后，再看框架 API。典型初始化为

```python
optimizer = torch.optim.Adam(
    model.parameters(),
    lr=1e-3,
    betas=(0.9, 0.999),
    eps=1e-8,
)
```

这里几乎可以和前面的数学符号一一对应：

| PyTorch 参数 | 数学含义 |
| :-: | --- |
| `lr` | $\alpha$ |
| `betas[0]` | $\beta_1$ |
| `betas[1]` | $\beta_2$ |
| `eps` | $\epsilon$ |
| `exp_avg` | $m_t$ 对应的一阶矩状态 |
| `exp_avg_sq` | $v_t$ 对应的二阶原始矩状态 |

## Adam 的显存占用

设模型有 $N$ 个参数。

裸 SGD 除了参数本身，主要需要梯度。Momentum 还需要保存一份与参数同规模的动量状态。

Adam 至少额外维护

$$
m_t\in\mathbb R^N,
\qquad
v_t\in\mathbb R^N.
$$

因此 optimizer state 本身至少多出两份参数规模的状态；如果启用 AMSGrad，还要再保存 $v_t^{\max}$。

从渐近复杂度看，每次 Adam 更新只是逐元素执行 EMA、平方、开方、除法和参数更新，所以计算复杂度仍然是 $O(N)$，远比完整 Hessian 或矩阵求逆便宜。但在大模型训练中，optimizer state 的显存/主存占用会变得非常重要。这也是 ZeRO、optimizer state sharding、8-bit optimizer 等技术要重点解决的问题之一。

## Adam 的优势与限制

Adam 的主要优势包括：

- 用 $m_t$ 平滑随机梯度方向，减少 mini-batch 噪声带来的震荡；
- 用 $v_t$ 为每个参数自适应调整有效步长；
- 对稀疏梯度和非平稳目标有明确的设计动机；
- bias correction 可以修复 EMA 从 0 初始化造成的启动偏差；
- 只需要一阶梯度，不需要完整 Hessian，单步计算复杂度仍是 $O(N)$；
- 经典默认超参数通常可以作为可靠起点。

限制包括：

- 相比 SGD/Momentum，需要额外维护至少两份参数规模的 optimizer state；
- “更容易优化”不等于“最终泛化一定更好”，一些任务上 SGD 可能得到更好的最终结果；
- Adam 不是无需调参，学习率、$\beta_2$、$\epsilon$ 和 weight decay 都可能明显影响训练；
- 在特殊噪声模式、稀疏模式或剧烈分布变化下，它也并不保证总是稳定或优于其他优化器。

Adam 不一定比 SGD 好，**Adam 用很低的工程复杂度，把方向平滑和逐坐标尺度适配组合成了一个非常实用的一阶随机优化器。**

## 总结

SGD 的第一类问题是当前梯度太抖，于是得到 Momentum：

$$
g_t
\longrightarrow
m_t.
$$

SGD 的第二类问题是不同参数梯度尺度差异很大，于是得到 AdaGrad，再改进成 RMSProp：

$$
g_t^2
\longrightarrow
v_t.
$$

然后 Adam 把两者合起来：

$$
\boxed{
\text{Adam}
=
\text{近期方向}
+
\text{逐坐标尺度}
+
\text{启动偏差修正}
}
$$

最终更新

$$
-\alpha\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}
$$

**沿着最近持续一致的方向前进，同时根据每个参数自己的历史梯度尺度调整步长，并修正训练刚开始时 EMA 从 0 启动造成的低估。**

如果再往工程实现映射：

$$
m_t
\rightarrow
\texttt{exp\_avg},
\qquad
v_t
\rightarrow
\texttt{exp\_avg\_sq},
$$

$$
(\beta_1,\beta_2)
\rightarrow
\texttt{betas},
\qquad
\alpha
\rightarrow
\texttt{lr}.
$$

## 参考资料

[Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980)

[PyTorch 2.14 documentation | Reference API > torch.optim.Adam](https://docs.pytorch.org/docs/2.14/generated/torch.optim.Adam.html)

[GeeksforGeeks | Introduction To Adam Optimizer](https://www.geeksforgeeks.org/deep-learning/adam-optimizer)

[Cornell University Computational Optimization Open Textbook | Optimization Wiki | Adam](https://optimization.cbe.cornell.edu/index.php?title=Adam)

