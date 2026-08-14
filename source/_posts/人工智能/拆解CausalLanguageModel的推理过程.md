---
title: 拆解 Causal Language Model 的推理过程
description: 将 Hugging Face generate() 隐藏起来的核心生成流程拆解出来，便于理解每阶段的具体行为。
tags:
  - LLM
  - Prefill
  - Decode
  - Attention
series: AI Infra
series_order: 1
categories: 人工智能
mathjax: true
abbrlink: cbfdf342
date: 2026-08-14 20:52:37
---

> 本文实验使用 `Qwen2.5-0.5B-Instruct` 模型，固定版本为
>
> ```shell
> MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
> REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
> ```
>

本文尝试将 Hugging Face `generate()` 隐藏起来的核心生成流程拆解出来。理解它之后，大模型推理中的许多术语都会变得具体：Chat Template 到底做了什么，Tokenizer 为什么不是简单的按单词切分，`logits` 为什么是三维张量，Prefill 与 Decode 为什么要分成两个阶段，KV Cache 为什么能显著降低自回归生成的计算量，以及 Greedy Decoding 为什么只需要对最后一个位置做 `argmax`……

本文以 `Qwen/Qwen2.5-0.5B-Instruct` 为例，从代码执行路径出发，把一次 Decoder-only Causal Language Model 的推理过程还原到底层张量层面。整段代码可以浓缩为下面这条链路。

```text
messages
   ↓
Chat Template
   ↓
rendered_prompt
   ↓
Tokenizer
   ↓
input_ids + attention_mask
   ↓
Prefill
   ├── 对整个 Prompt 做一次 Transformer Forward
   ├── 得到每个位置的 logits
   └── 建立 Prompt 的 KV Cache
   ↓
取最后一个位置 logits
   ↓
argmax
   ↓
第 1 个生成 token
   ↓
Decode Loop
   ├── 每轮只输入刚刚生成的 1 个 token
   ├── 复用过去的 KV Cache
   ├── 得到新的最后位置 logits
   └── argmax 得到下一个 token
   ↓
EOS 或达到 max_new_tokens
   ↓
Tokenizer.decode
   ↓
最终文本
```

如果平时直接写：

```python
outputs = model.generate(**inputs, max_new_tokens=64)
```

Transformers 会替我们处理其中绝大多数细节。本文的价值在于没有调用 `generate()`，而是把生成循环手工展开，作为理解 LLM inference engine 的实验。

## Tokenizer

```python
tokenizer = AutoTokenizer.from_pretrained(
    MODEL_ID,
    revision=REVISION,
    local_files_only=True,
)
```

Tokenizer 的任务不是简单把句子按空格分词，而是把文本映射为模型词表中的离散整数 ID。

从模型角度看：

```text
"What's for lunch today?"
```

并不存在。Transformer 真正接收到的是类似下面的整数序列：

```text
[151644, 8948, 198, 2610, 525, 1207, 16948, ...]
```

每个整数对应词表中的一个 token。语言模型本质上处理的是离散 token 序列：

$$
x_1, x_2, \ldots, x_L
$$

其中每个：

$$
x_i \in \{0, 1, \ldots, V-1\}
$$

`V` 是词表大小。对于这里的 Qwen2.5-0.5B-Instruct，配置中的：

```text
vocab_size = 151936
```

因此合法 token ID 位于大约 `0 ~ 151935` 的范围内。


## 自回归

```python
model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    revision=REVISION,
    dtype=torch.bfloat16,
    local_files_only=True,
).to(device=DEVICE)
```

`AutoModelForCausalLM` 表示加载一个用于 **Causal Language Modeling** 的模型。核心约束是位置 `t` 预测下一个 token 时只能看当前位置之前的信息，不能偷看未来。自回归语言模型建模的是：

$$
P(x_1, x_2, \ldots, x_T)
=
\prod_{t = 1}^{T} P(x_t \mid x_{< t})
$$

其中：

$$
x_{< t} = x_1, x_2, \ldots, x_{t-1}
$$

因此“生成一句话”并不是一次性预测整句话，而是不断重复：

```text
根据已有上下文预测 1 个 token
把这个 token 接到上下文后面
再预测下 1 个 token
……
```

### Causal Mask

Transformer 的 Self-Attention 原始形式可以写成：

$$
\operatorname{Attention}(Q, K, V)
=
\operatorname{softmax}\left(
\frac{QK^T}{\sqrt{d_h}} + M
\right)V
$$

其中 `M` 是 mask。Causal LM 会用上三角方向被屏蔽的 causal mask，使位置 `i` 不能读取 `j > i` 的未来 token。于是 Prompt 中每个位置都只能基于自己之前的上下文形成预测。


## 推理模式

加载后执行：

```python
model.eval()
```

之后真正 forward 时使用：

```python
with torch.inference_mode():
    ...
```

- `model.eval()` 把 PyTorch Module 切换到 evaluation mode。它主要影响那些训练和推理行为不同的层，例如 Dropout、BatchNorm 等。对于典型 LLM，最直观的是 Dropout。推理时我们不希望模型每次随机丢弃不同神经元，因此应进入 eval mode。

- `torch.inference_mode()` 主要告诉 PyTorch 这段代码只做推理，不需要构建反向传播所需的 Autograd bookkeeping。它可以进一步减少：gradient tracking；version counter 等额外记录；与反向传播相关的内存和运行时开销

但是 `model.eval() != torch.inference_mode()`，`inference_mode()` 不会自动把模型设置为 eval，所以两者同时使用是合理的。


## Chat Template

原始消息定义为：

```python
messages = [
    {"role": "user", "content": PROMPT},
]
```

这是一个面向应用层的结构化表示。模型本身并不知道 Python 字典中的 `role="user"` 是什么意思。

因此需要：

```python
rendered_prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
)
```

Chat Template 的作用就是把：

```python
{"role": "user", "content": "What's for lunch today?"}
```

转换成模型训练时熟悉的对话格式。对于这里固定的 Qwen revision，在没有显式 system message 时，模板会自动加入默认 system prompt。其结构大致为：

```text
<|im_start|>system
You are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>
<|im_start|>user
What's for lunch today?<|im_end|>
<|im_start|>assistant
```

这里的 `<|im_start|>` 和 `<|im_end|>` 是 tokenizer 注册的特殊 token。

对应配置中：

```text
<|im_start|> -> 151644
<|im_end|>   -> 151645
```

并且：

```text
eos_token = <|im_end|>
```

所以生成过程中一旦模型输出 `<|im_end|>`，就意味着当前 assistant response 已经结束。最后追加：

```text
<|im_start|>assistant\n
```

它相当于告诉模型 **前面的 system 和 user 消息都结束了，接下来轮到 assistant 继续写**。如果缺少这一段，模型看到的上下文分布可能和 instruction tuning 时不一致，生成行为就可能明显变差。因此 Chat Template 的作用是把应用程序中的消息对象编码成模型训练时使用的 token 协议。


## 两阶段编码

代码首先：

```python
rendered_prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
)
```

得到字符串，然后：

```python
inputs = tokenizer(
    rendered_prompt,
    return_tensors="pt",
).to(device=DEVICE)
```

为了方便打印观察内容上面分两步执行，实际也可以一步完成，例如：

```python
inputs = tokenizer.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    return_dict=True,
    return_tensors="pt",
).to(DEVICE)
```

## 模型输入

```python
inputs = tokenizer(
    rendered_prompt,
    return_tensors="pt",
).to(device=DEVICE)
```

典型结果是一个 `BatchEncoding`，至少包含：

```python
{
    "input_ids": ...,
    "attention_mask": ...,
}
```

如果 batch size 为 `B`，序列长度为 `L`，那么：

```text
input_ids.shape      = [B, L]
attention_mask.shape = [B, L]
```

本文的例子只有一个输入，因此 `B = 1`

`input_ids`：`input_ids[b, i]` 是第 `b` 个样本第 `i` 个 token 的词表 ID。

`attention_mask`：

```text
1 -> 这个位置是真实 token
0 -> 这个位置是 padding
单样本、无 padding 时通常全是 1
```

> - `attention_mask` 主要描述哪些输入位置有效
> - causal mask 保证当前位置不能看未来
>
> 模型内部通常会结合两者得到最终 attention masking 行为。


## Token 与 ID

代码执行：

```python
token_ids = inputs.input_ids[0].tolist()
tokens = tokenizer.convert_ids_to_tokens(token_ids)
```

需要特别注意，`tokenizer.convert_ids_to_tokens()` 返回的是 tokenizer 内部 token 表示，而 `tokenizer.decode([token_id])` 返回的是更接近最终用户文本的解码结果。两者并不保证字符串形式完全相同。某些 tokenizer 会在内部 token 中使用特殊字符表示前导空格、字节片段或 subword 边界。

## Prefill

真正第一次调用模型：

```python
with torch.inference_mode():
    outputs = model(**inputs, use_cache=True)
```

这一步通常被称为 **Prefill**。假设 Prompt 长度为 `L`

```text
x1, x2, x3, ..., xL
```

第一次 forward 会把整个 Prompt 一起输入 Transformer，使模型完成两件关键事情：

1. 计算这 `L` 个位置的 hidden states 和 logits
2. 为每一层 Attention 建立这 `L` 个 token 的 KV Cache

先一次性把已有上下文灌进模型，然后后续生成阶段只需要增量计算新 token，这也是 Prefill 与 Decode 的分界。

### 模型输出

对于 Causal LM，输出通常类似 `CausalLMOutputWithPast`，其中最重要的是：

```python
outputs.logits
outputs.past_key_values
```

`outputs.logits` 的其形状为：

```text
[batch, sequence, vocabulary]
[B, L, V]
B = 1 V = 151936
```

因此如果 Prompt 一共 tokenized 成 `L` 个 token，`outputs.logits.shape` 就是 `[1, L, 151936]`，这意味着 **Prompt 中每一个序列位置，都对应整个词表的一组候选分数**。


### 词表维度

对于位置 `t` 的最后 hidden state：

$$
h_t \in \mathbb{R}^{d_{model}}
$$

语言模型头会把它映射到词表维度：

$$
z_t = W_{lm}h_t + b
$$

其中：

$$
z_t \in \mathbb{R}^{V}
$$

这里：

$$
V = 151936
$$

所以 `z_t` 中的第 `i` 个值表示词表 token `i` 的未归一化预测分数。这个向量就是 logits。完整 Prompt 有 `L` 个位置，因此组合起来就是：

$$
Z \in \mathbb{R}^{B \times L \times V}
$$


### Logit

`logits` 是 Softmax 之前的分数。如果最后一个位置的 logits 为：

$$
z = (z_1, z_2, \ldots, z_V)
$$

对应概率为：

$$
P(i)
=
\frac{e^{z_i}}{\sum_{j = 1}^{V} e^{z_j}}
$$

本文的实现没有显式执行 Softmax：

```python
next_token_id = last_logits.argmax(dim=-1).item()
```

因为 Softmax 是单调变换：

$$
\operatorname*{argmax}_i z_i
=
\operatorname*{argmax}_i \operatorname{softmax}(z)_i
$$

如果只需要找概率最大的 token，没必要先计算完整 Softmax。


### 最后位置

```python
last_logits = outputs.logits[:, -1, :]
```

原始形状 `[B, L, V]` 取 `[:, -1, :]` 后得到 `[B, V]`

因为 causal LM 在位置 `t` 的输出对应的是 **给定截至当前位置的上下文，下一 token 应该是什么**。Prompt 最后位置包含完整 Prompt 上下文，因此真正要生成的第一个新 token 来自 **最后一个 Prompt 位置的 next-token distribution**


## Greedy Decoding

第一个 token 通过：

```python
next_token_id = last_logits.argmax(dim=-1).item()
```

得到。这就是 Greedy Decoding：

$$
x_{t+1}
=
\operatorname*{argmax}_{v \in \mathcal{V}}
P(v \mid x_{\le t})
$$

由于 `argmax(logits) = argmax(probability)`，实际直接对 logits 取最大值。

Greedy 的特点是：

- 完全确定性
- 每一步只保留局部最高概率 token
- 不保证得到全局最高概率整句
- 文本通常比 sampling 更保守、更容易重复

> Greedy 每一步都选择当前概率最大的 token：
>
> $$
> x_t^* = \arg\max_x P(x\mid x_{< t})
> $$
>
> 但一整个序列的概率是条件概率的乘积：
>
> $$
> P(x_{1: T})
> =
> \prod_t P(x_t\mid x_{< t})
> $$
>
> 局部第一步最优，不代表最终整条路径乘积最大。例如第一步：
>
> ```text
> A: 0.51
> B: 0.49
> ```
>
> Greedy 会选择 A。但后续可能：
>
> ```text
> P(A2 | A) = 0.10
> P(B2 | B) = 0.90
> ```
>
> 两步联合概率：
>
> ```text
> A 路径 = 0.51 × 0.10 = 0.051
> B 路径 = 0.49 × 0.90 = 0.441
> ```
>
> 因此 Greedy 的优势是低开销和确定性，而不是全局序列最优化。

它和常见的：

```text
temperature
top-k sampling
top-p sampling
beam search
```

不是同一种解码策略。本文用 Greedy 是因为这样最容易暴露“模型 forward”和“解码策略”之间的边界。


## KV Cache

Prefill 调用显式设置：

```python
outputs = model(**inputs, use_cache=True)
```

随后：

```python
past_key_values = outputs.past_key_values
```

这就是 KV Cache。

对某层输入 hidden states `X`，Attention 会做线性投影：

$$
Q = XW_Q
$$

$$
K = XW_K
$$

$$
V = XW_V
$$

然后计算：

$$
\operatorname{softmax}\left(
\frac{QK^T}{\sqrt{d_h}}
\right)V
$$

当模型生成下一个 token 时，过去所有 token 的 `K` 和 `V` 并不会因为未来多了一个 token 就发生变化。因此没有必要每次生成新 token，都要重新计算所有旧 token 的 K 和 V。推理引擎需要缓存它们。

假设 Prompt 是：

```text
A B C D
```

得到第一个生成 token `E` 后，要继续预测 `F`。

如果没有 KV Cache，一种朴素做法是重新输入：

```text
A B C D E
```

模型从头重新计算这五个 token 的全部 Transformer layers。

再得到 `F` 后，又输入：

```text
A B C D E F
```

大量计算会被重复执行。

假设 Prefill 已经缓存：

```text
A B C D 的 K/V
```

生成 `E` 后，下一轮只输入：

```text
E
```

模型只需要计算 `E` 自己的：

```text
Q_E
K_E
V_E
```

然后：

```text
Q_E
```

去 attention：

```text
[K_A, K_B, K_C, K_D, K_E]
```

并读取：

```text
[V_A, V_B, V_C, V_D, V_E]
```

旧 token 的 K/V 全部直接从 cache 读取，即 `past_key_values`


### K/V 缓存

生成当前 token 时，Query 的作用是“当前这个位置要去查询过去哪些信息”。旧 token 的 Query 在它们自己的位置计算完成后，未来生成的新 token 不需要再使用这些旧 Query。但旧 token 的 Key 和 Value 仍然需要被未来 token 查询，所以必须保留。

因此缓存对象叫 **Key-Value Cache** 而不是 **Query-Key-Value Cache**.


## Decode

进入循环后：

```python
decode_input_ids = torch.tensor(
    [[generated_token_ids[-1]]],
    dtype=inputs.input_ids.dtype,
    device=DEVICE,
)
```

其 shape 为：

```text
[1, 1]
batch = 1 sequence = 1
```

这一行直接体现了 KV Cache 的价值。我们不再输入整个 Prompt + 已生成文本，而只输入上一轮刚生成的 1 个 token，过去上下文已经存在 `past_key_values` 中。

于是后面的 forward：

```python
decode_outputs = model(
    input_ids=decode_input_ids,
    attention_mask=decode_attention_mask,
    past_key_values=past_key_values,
    use_cache=True,
)
```

虽然 `input_ids` 只有一个 token，但模型仍然拥有完整历史上下文。


### Decode Logits

因为本轮只输入一个新 token：

```text
input_ids.shape = [1, 1]
```

因此只为这个新位置产生一份输出 logits：

```text
logits.shape = [1, 1, 151936]
```

然后：

```python
decode_last_logits = decode_outputs.logits[:, -1, :]
```

得到：

```text
[1, 151936]
```

再进行一次 `argmax`，生成下一个 token。这就是自回归循环。


## Attention Mask

代码初始化：

```python
decode_attention_mask = inputs.attention_mask
```

每生成一个 token，就扩展一位：

```python
decode_attention_mask = torch.cat(
    [
        decode_attention_mask,
        torch.ones(
            (1, 1),
            dtype=decode_attention_mask.dtype,
            device=DEVICE,
        ),
    ],
    dim=-1,
)
```

假设 Prompt 有 10 个 token，那么第一次 decode 前：

```text
attention_mask.shape = [1, 10]
```

加入新 token 后：

```text
[1, 11]
```

下一轮：

```text
[1, 12]
```

虽然本轮 `input_ids` 只有 `[1, 1]`，`attention_mask` 描述的却是 **整个可见 key/value 序列**。

对于本文单样本且没有 padding 的情况，它一直是 `[1, 1, 1, 1, ...]`，因此看起来有些多余。但一旦进入 batch inference，不同样本具有不同 prompt 长度并使用 padding，这个 mask 就非常重要。


## Cache 增长

```python
past_key_values = decode_outputs.past_key_values
```

第一轮 Prefill 后 cache 包含：

```text
Prompt tokens 的 K/V
```

第一次 Decode 后应该变成：

```text
Prompt + generated token 1
```

第二轮后变成：

```text
Prompt + generated token 1 + generated token 2
```

因此 cache 会随着生成序列逐步增长。

概念上：

```text
KV_0
  ↓ append token 1
KV_1
  ↓ append token 2
KV_2
  ↓ append token 3
KV_3
```

具体 Transformers 版本中，Cache 可能由对象内部原地更新，也可能表现为返回新的 cache state。手动写生成循环时，最安全、语义最清晰的写法就是像这里一样始终使用 forward 返回的 `decode_outputs.past_key_values` 作为下一轮输入。


## KV Cache 显存

这一点可以直接从模型结构推导，Qwen2.5-0.5B 的典型配置中：

```text
num_hidden_layers   = 24
hidden_size         = 896
num_attention_heads = 14
num_key_value_heads = 2
```

因此每个 attention head 的维度：

$$
d_h = \frac{896}{14} = 64
$$

模型使用 GQA，所以 Query head 有 14 个，但真正需要存储的 KV head 只有 2 个。对 batch size 为 `B`、缓存长度为 `L`，KV Cache 的理论主体大小可以近似写成：

$$
M_{KV}
=
B \times L \times N_{layers}
\times 2
\times N_{kv\_heads}
\times d_h
\times s
$$

其中中间的 `2` 表示同时保存 Key 和 Value，`s` 是每个元素所占字节数。

BF16：

$$
s = 2\ \text{bytes}
$$

代入 batch size `B=1`：

$$
M_{KV/token}
=
24 \times 2 \times 2 \times 64 \times 2
= 12288\ \text{bytes}
$$

也就是每缓存 1 个 token，大约：

$$
12\ \text{KiB}
$$

所以粗略估计：

```text
1K tokens   -> 约 12 MiB
8K tokens   -> 约 96 MiB
32K tokens  -> 约 384 MiB
```

这是 batch size 为 1 的 KV tensor 主体理论值，真实进程显存还会包含模型权重、CUDA allocator、临时 workspace、logits、其他 activations 和框架开销。这个公式也解释了为什么线上 LLM serving 中“上下文长度”和“并发 batch size”会迅速吞掉显存。


## GQA

如果模型使用标准 Multi-Head Attention，并且 KV head 数与 Query head 数相同，这里本来需要存 14 个 KV heads。

Qwen2.5-0.5B 配置中只有：

```text
num_key_value_heads = 2
```

这属于 Grouped Query Attention 的思路：多个 Query heads 共享更少的 Key/Value heads。如果其他条件不变，KV Cache 大小与：

$$
N_{kv\_heads}
$$

近似成正比。因此从 14 个 KV heads 降到 2 个，理论 cache 主体会显著缩小。


## 性能特征

理解推理性能时，需要把 Prefill 和 Decode 分开看。

### Prefill

Prompt 长度为 `L` 时，一次性输入整个序列。Self-Attention 需要处理 token 之间的成对关系，其经典计算项包含：

$$
O(L^2)
$$

因此长 Prompt 会显著增加 Prefill 成本。但 Prefill 同时处理很多 token，矩阵规模大，GPU 往往更容易获得高利用率。

### Decode

Decode 每一轮通常只有：

```text
query length = 1
```

它会用当前 Query 与长度不断增长的 KV Cache 做 attention。对第 `t` 个生成 token，attention 需要读取大约 **Prompt length + 已生成长度** 对应的 KV。因此单步 attention 成本会随着上下文长度近似线性增长。生成 `T` 个 token 时，只看 attention 对历史 KV 的读取量，累计量级可以近似看成：

$$
O(TL + T^2)
$$

其中 `L` 是原始 Prompt 长度。所以 serving 系统中常分别关注：

```text
TTFT  -> Time To First Token，主要受 Prefill 影响
TPOT  -> Time Per Output Token，主要受 Decode 影响
```

第一个 token 是 `outputs = model(**inputs)` 之后才出现，而后面的 token 都来自 while decode loop。


## 首个 Token

代码先执行 Prefill：

```python
outputs = model(**inputs, use_cache=True)
```

然后直接利用：

```python
last_logits = outputs.logits[:, -1, :]
next_token_id = last_logits.argmax(dim=-1).item()
```

这已经生成了第一个新 token。因此：

```python
generated_token_ids = [next_token_id]
```

while loop 负责的是第 2 个及之后的 token。


## EOS

```python
eos_token_id = tokenizer.eos_token_id
```

对于这个 Qwen tokenizer revision：

```text
eos_token = <|im_end|>
eos_token_id = 151645
```

生成每个 token 后都检查：

```python
if next_token_id == eos_token_id:
    stop_reason = "eos"
```

因此模型并不是由 Python 根据句号判断结束，而是模型自己预测一个特殊 token：

```text
<|im_end|>
```

从概率建模角度，它和普通 token 一样，也参与下一 token 预测。只不过推理程序赋予它特殊控制语义：

```text
一旦生成这个 ID，就停止当前 assistant turn。
```


## 长度上限

while 条件：

```python
len(generated_token_ids) < MAX_NEW_TOKENS
```

即使模型一直不生成 EOS，程序也最多生成 64 个新 token。最终：

```python
if stop_reason is None:
    stop_reason = "max_new_tokens"
```

所以终止原因只有两类：

- `eos` 表示模型主动认为 response 已完成
- `max_new_tokens` 表示外部系统强制截断


## 特殊 Token

最终：

```python
generated_text = tokenizer.decode(
    generated_token_ids,
    skip_special_tokens=True,
)
```

如果生成序列最后包含：

```text
<|im_end|>
```

它是协议控制 token，而不是应该展示给用户的正文，所以通过：

```python
skip_special_tokens=True
```

把它过滤掉。需要注意，程序内部仍然保留完整的：

```python
generated_token_ids
```

## 显存统计

代码在 Prefill 前调用：

```python
torch.cuda.reset_peak_memory_stats()
```

最后读取：

```python
torch.cuda.max_memory_allocated()
```

并转换为 MiB：

```python
torch.cuda.max_memory_allocated() / 1024**2
```

`max_memory_allocated()` 统计的是 PyTorch CUDA allocator 中由 tensor 实际占用的最大 allocated memory。它和 **nvidia-smi 显示的进程显存** 不是同一个指标，因为后者还可能包含 CUDA context、allocator reserved memory、第三方 CUDA library workspace 等。

`reset_peak_memory_stats()` 只是重置 peak 统计的起点，不会删除模型权重，清空 KV Cache，调用 `empty_cache()` 或释放当前已分配 Tensor。因此调用 reset 时模型已经驻留 GPU，这段程序得到的 peak 值不能简单理解成“本次 forward 新增了多少 MiB”。

如果想测“forward 相比 baseline 额外增加多少显存”，更合理的方法是同时记录：

```python
before = torch.cuda.memory_allocated()
torch.cuda.reset_peak_memory_stats()
...
peak = torch.cuda.max_memory_allocated()
delta = peak - before
```

而如果关心 PyTorch caching allocator 管理的峰值，还可以同时观察：

```python
torch.cuda.max_memory_reserved()
```


## Logits 显存

Prefill 输出：

```text
[B, L, V]
```

其中：

```text
V = 151936
```

假设 logits 使用 2 字节 dtype，单 batch 的 logits 理论主体大小约为：

$$
M_{logits}
=
L \times 151936 \times 2
$$

如果 `L=1024`：

$$
M_{logits}
\approx
296.75\ \text{MiB}
$$

而生成下一 token 实际只需要：

```text
最后一个位置的 logits
```

也就是：

```text
[1, 151936]
```

因此高性能推理框架经常尽量避免保留不需要的 full-sequence logits。


## 总结

理解完原理后，可以把代码重新压缩成下面几个阶段。

```python
### 文本协议
messages = [{"role": "user", "content": PROMPT}]
rendered_prompt = tokenizer.apply_chat_template(...)
inputs = tokenizer(rendered_prompt, return_tensors="pt").to("cuda")

### Prefill
outputs = model(**inputs, use_cache=True)

### 首个 Token
last_logits = outputs.logits[:, -1, :]
next_token_id = last_logits.argmax(dim=-1).item()

### KV Cache
past_key_values = outputs.past_key_values

### Decode
while not stop:
    # 只输入上一轮刚产生的 token
    decode_input_ids = [[next_token_id]]

    # 复用历史 KV
    outputs = model(
        input_ids=decode_input_ids,
        past_key_values=past_key_values,
        use_cache=True,
        ...,
    )

    # 更新 cache
    past_key_values = outputs.past_key_values

    # 再选一个 token
    next_token_id = outputs.logits[:, -1, :].argmax(...)
```

其中

- Tokenizer 解决“文字如何进入模型”
- Chat Template 解决“聊天协议如何编码”
- Prefill 解决“已有上下文如何一次性计算”
- logits 解决“模型如何表达下一个 token 的偏好”
- Greedy 解决“从偏好中选哪个 token”
- KV Cache 解决“历史计算如何复用”
- Decode 解决“如何逐 token 延续序列”
- EOS / max_new_tokens 解决“什么时候停止”


## 参考资料

[Euler0525@Blog｜LLM 在线推理系统](https://euler0525.github.io/blogs//posts/5e9dc74b/)

[Hugging Face | Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct/commit/7ae557604adf67be50417f59c2c2f167def9a775)

[Hugging Face transformers](https://qwen.readthedocs.io/en/v2.5/inference/chat.html)

## 附录

### 数据类型对照表

| 类型 |   位数   |  每元素   | 指数位 | 尾数位 | 精度 |  范围  | 常见用途              |
| :--: | :------: | :-------: | :----: | :----: | :--: | :----: | --------------------- |
| FP64 |    64    |    8 B    |   11   |   52   | 极高 |  极大  | 科学计算              |
| FP32 |    32    |    4 B    |   8    |   23   |  高  |  很大  | 训练、参考计算        |
| TF32 | 计算格式 | FP32 存储 |   8    | 约 10  |  中  |  很大  | NVIDIA FP32 矩阵计算  |
| FP16 |    16    |    2 B    |   5    |   10   |  中  |  较小  | 训练、推理            |
| BF16 |    16    |    2 B    |   8    |   7    | 较低 |  很大  | LLM 训练、推理        |
| FP8  |    8     |    1 B    | 依格式 | 依格式 |  低  | 依格式 | 新一代 LLM 训练、推理 |
| INT8 |    8     |    1 B    |   —    |   —    | 量化 |   —    | 推理量化              |
| INT4 |    4     |   0.5 B   |   —    |   —    | 更低 |   —    | 低显存推理            |

```shell
FP32 高精度 + 大范围 + 4 Byte
FP16 较高精度 + 小范围 + 2 Byte
BF16 较低精度 + 大范围 + 2 Byte
FP8  更低精度 + 1 Byte
INT8 整数量化 + 1 Byte
INT4 整数低比特量化 + 0.5 Byte
```

### 参考代码

```python
import json
from pathlib import Path

import torch
import transformers
from transformers import AutoModelForCausalLM, AutoTokenizer


MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
PROMPT = "What's for lunch today?"
DEVICE = "cuda"
MAX_NEW_TOKENS = 64

if not torch.cuda.is_available():
    raise RuntimeError("NO available NVIDIA GPU with CUDA.")

# Load Tokenizer and Model
tokenizer = AutoTokenizer.from_pretrained(
    MODEL_ID,
    revision=REVISION,
    local_files_only=True,
)

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    revision=REVISION,
    dtype=torch.bfloat16,
    local_files_only=True,
).to(device=DEVICE)

model.eval()

# Eval
messages = [
    {"role": "user", "content": PROMPT},
]

print("message:\n", messages)
print()

rendered_prompt = tokenizer.apply_chat_template(
    messages,
    tokenize=False,
    add_generation_prompt=True,
)

print("rendered_prompt:\n", rendered_prompt)

inputs = tokenizer(
    rendered_prompt,
    return_tensors="pt",
).to(device=DEVICE)

print("inputs:\n", inputs, "\t", inputs.input_ids.shape)
print()

token_ids = inputs.input_ids[0].tolist()
tokens = tokenizer.convert_ids_to_tokens(token_ids)

print("token                    -> token id:")
i = 1
for token, token_id in zip(tokens, token_ids):
    print(f"[{i:2d}]{repr(token):20s} -> {token_id}")
    i += 1
print()

torch.cuda.reset_peak_memory_stats()

with torch.inference_mode():
    outputs = model(**inputs, use_cache=True)

# [batch, sequence, vocabulary]  Qwen2.5-0.5B 的词表大小是 151936，所以每个序列位置都会得到 151936 个候选分数
print("outputs:\n", outputs, "\t", outputs.logits.shape)
print()

last_logits = outputs.logits[:, -1, :]
print("last_logits:\n", last_logits, "\t", last_logits.shape)
print()

next_token_id = last_logits.argmax(dim=-1).item()
top_values, top_indices = torch.topk(last_logits[0], k=5)
top_k = [
    {
        "token_id": token_id,
        "logit": logit,
        "text": tokenizer.decode([token_id]),
    }
    for token_id, logit in zip(
        top_indices.tolist(),
        top_values.tolist(),
    )
]
print("top 5:\n", top_k)
print()

print("next token:\n", tokenizer.decode([next_token_id]))
print()

# Greedy Decoding
eos_token_id = tokenizer.eos_token_id
generated_token_ids = [next_token_id]
past_key_values = outputs.past_key_values
decode_attention_mask = inputs.attention_mask
stop_reason = None

print(
    f"[prefill -> token 1] "
    f"id={next_token_id}, "
    f"text={repr(tokenizer.decode([next_token_id]))}"
    "\n"
)

if next_token_id == eos_token_id:
    stop_reason = "eos"

with torch.inference_mode():
    while (
        stop_reason is None
        and len(generated_token_ids) < MAX_NEW_TOKENS
    ):
        decode_input_ids = torch.tensor(
            [[generated_token_ids[-1]]],
            dtype=inputs.input_ids.dtype,
            device=DEVICE,
        )

        decode_attention_mask = torch.cat(
            [
                decode_attention_mask,
                torch.ones(
                    (1, 1),
                    dtype=decode_attention_mask.dtype,
                    device=DEVICE,
                ),
            ],
            dim=-1,
        )

        decode_outputs = model(
            input_ids=decode_input_ids,
            attention_mask=decode_attention_mask,
            past_key_values=past_key_values,
            use_cache=True,
        )

        # Update KV Cache
        past_key_values = decode_outputs.past_key_values

        decode_last_logits = decode_outputs.logits[:, -1, :]

        # Greedy
        next_token_id = (
            decode_last_logits.argmax(dim=-1).item()
        )

        generated_token_ids.append(next_token_id)

        print(
            f"[decode -> token {len(generated_token_ids)}]\t"
            f"input_shape={list(decode_input_ids.shape)}, "
            f"logits_shape={list(decode_outputs.logits.shape)}, "
            f"id={next_token_id}, "
            f"text={repr(tokenizer.decode([next_token_id]))}"
        )

        if next_token_id == eos_token_id:
            stop_reason = "eos"

if stop_reason is None:
    stop_reason = "max_new_tokens"

generated_text = tokenizer.decode(
    generated_token_ids,
    skip_special_tokens=True,
)

print()
print("generated token ids:\n", generated_token_ids)
print()
print("generated text:\n", generated_text)
print()
print("stop reason:", stop_reason)
print()


reference = {
    "gpu_name": torch.cuda.get_device_name(),
    "torch_version": torch.__version__,
    "cuda_version": torch.version.cuda,
    "transformers_version": transformers.__version__,
    "model_id": MODEL_ID,
    "revision": REVISION,
    "prompt": PROMPT,
    "rendered_prompt": rendered_prompt,
    "input_ids": inputs.input_ids.cpu().tolist(),
    "input_shape": list(inputs.input_ids.shape),
    "full_logits_shape": list(outputs.logits.shape),
    "last_logits_shape": list(last_logits.shape),
    "top_k": top_k,
    "generated_token_ids": generated_token_ids,
    "generated_text": generated_text,
    "stop_reason": stop_reason,
    "max_new_tokens": MAX_NEW_TOKENS,
    "peak_allocated_mib": round(
        torch.cuda.max_memory_allocated() / 1024**2,
        2,
    ),
    "eos_token_id": tokenizer.eos_token_id,
    "prompt_tokens": inputs.input_ids.shape[-1],
    "generated_tokens": len(generated_token_ids),
}

output_path = (
    Path(__file__).parent
    / "fixtures"
    / "01_forward.json"
)

output_path.parent.mkdir(
    parents=True,
    exist_ok=True,
)

output_path.write_text(
    json.dumps(
        reference,
        ensure_ascii=False,
        indent=2,
    )
    + "\n",
    encoding="utf-8",
)

print("reference saved to:", output_path)


"""
Tokenizer
    ↓
Chat Template
    ↓
Token IDs
    ↓
Prefill
    ├── Full logits
    ├── Next-token prediction
    └── KV Cache
           ↓
        Decode
           ↓
        Greedy argmax
           ↓
        Next token
           ↓
       Update KV Cache
           ↓
        Decode...
           ↓
    EOS / max_new_tokens
           ↓
          Stop
"""
```
