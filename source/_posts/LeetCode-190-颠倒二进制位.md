---
title: LeetCode 190. 颠倒二进制位
tags:
  - LeetCode
  - 位运算
  - 分治
categories: 算法
mathjax: true
abbrlink: 4b67a096
date: 2025-07-29 15:35:34
---

# [【LeetCode】 190. 颠倒二进制位](https://leetcode.cn/problems/reverse-bits/)

## 算法

以 8 比特为例，`abcdefgh`，每次运算交换“奇偶位”，即 `[badcfehg]` → `[dcbahgfe]` → `hgfedcba`

```c++
class Solution {
public:
    unsigned reverseBits(unsigned n) const {
        n = n >> 1 & M1   | (n & M1)  << 1;
        n = n >> 2 & M2   | (n & M2)  << 2;
        n = n >> 4 & M4   | (n & M4)  << 4;
        n = n >> 8 & M8   | (n & M8)  << 8;
        // n = n >> 16 & M16 | (n & M16) << 16;

        return n >> 16 | n << 16;
    }
private:
    const uint32_t M1  = 0x55555555;  // 01010101010101010101010101010101
    const uint32_t M2  = 0x33333333;  // 00110011001100110011001100110011
    const uint32_t M4  = 0x0f0f0f0f;  // 00001111000011110000111100001111
    const uint32_t M8  = 0x00ff00ff;  // 00000000111111110000000011111111
    // const uint32_t M16 = 0x0000ffff;  // 00000000000000001111111111111111
};
```

## 复杂度分析

- 时间复杂度：$O(1)$；
- 空间复杂度：$O(1)$；
