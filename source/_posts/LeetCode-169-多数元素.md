---
title: LeetCode 169. 多数元素
tags:
  - 排序
  - LeetCode
categories: 算法
mathjax: true
abbrlink: a22febf0
date: 2025-06-29 13:18:36
---

# [【LeetCode】 169. 多数元素](https://leetcode.cn/problems/majority-element/)

## 哈希表

### 算法

用哈希表存储每个元素以及其出现的次数。

```c++
class Solution {
public:
    int majorityElement(vector<int>& nums) {
        int res = 0;
        int cnt = 0;
        for (const auto & num : nums) {
            ++mp[num];
            if (mp[num] > cnt) {
                res = num;
                cnt = mp[num];
            }
        }

        return res;
    }
private:
    unordered_map<int, int> mp;
};
```

### 复杂度分析

- **时间复杂度**：$O(n)$，遍历数组`nums`一次，插入哈希表需要常数时间；
- **空间复杂度**：$O(n)$，题目中说明给定的数组总是存在多数元素，且多数元素的出现次数大于$\dfrac{n}{2}$，则哈希表最多包含$n-\lfloor\dfrac{n}{2}\rfloor$个键值对；

---

## 排序

### 算法

将数组（按单调递增或递减的顺序）排序，则下标为$\lfloor\dfrac{n}{2}\rfloor$的元素一定为题目要求的多数元素。

```c++
class Solution {
public:
    int majorityElement(vector<int> &nums) {
        sort(nums.begin(), nums.end());
        return nums[nums.size() / 2];
    }
};
```

### 复杂度分析

> 使用C++语言自带的排序算法

- **时间复杂度**：$O(n\log{n})$；
- **空间复杂度**：$O(\log{n})$；

---

## Boyer-Moore投票法

### 算法

如果当前的候选人不是“多数元素”，它会和其它非候选人一起投反对票，由于“多数元素”更多，所以非候选人一定会下台；如果当前候选人是“多数元素”，其它非候选人会反对，但是“多数元素”票数会超过一般，则“多数元素”一定会当选。

```c++
class Solution {
public:
    int majorityElement(vector<int>& nums) {
        int m = -1;
        unsigned cnt = 0;
        for (const auto &num : nums) {
            if (num == m) {
                ++cnt;
            } else if (--cnt < 0) {
                m = num;
                ++cnt;
            }
        }

        return m;
    }
};
```

### 复杂度分析

- **时间复杂度**：$O(n)$，只需遍历一次数组；
- **空间复杂度**：$O(1)$，只需要常数级额外存储；
