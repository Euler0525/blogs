---
title: 延时函数HAL_Delay的1ms误差
tags:
  - STM32
categories: 编程
mathjax: true
abbrlink: c5322b12
date: 2025-10-02 23:25:00
---

```c
/**
 * @brief This function provides minimum delay (in milliseconds) based
 *        on variable incremented.
 * @note In the default implementation , SysTick timer is the source of time
 * base. It is used to generate interrupts at regular time intervals where
 * uwTick is incremented.
 * @note This function is declared as __weak to be overwritten in case of other
 *       implementations in user file.
 * @param Delay specifies the delay time length, in milliseconds.
 * @retval None
 */
__weak void HAL_Delay(uint32_t Delay) {
    uint32_t tickstart = HAL_GetTick();
    uint32_t wait = Delay;

    /* Add a freq to guarantee minimum wait */
    if (wait < HAL_MAX_DELAY) {
        wait += (uint32_t)(uwTickFreq);
    }

    while ((HAL_GetTick() - tickstart) < wait) {
    }
}
```

`HAL_Delay` 函数依赖 **SysTick 定时器**，该定时器的周期为 `1ms`（由函数 `HAL_InitTick()` 配置，见附录），也就是说 SysTick 每 1ms 触发一次中断，并且增加一次全局记数；`HAL_Delay` 的工作原理是读取当前 SysTick 计数值，等待累加 N 个周期后返回。

例如调用 `HAL_Delay(5)` 时，SysTick 从 K 变到 K+1，那么

- 起始时刻：tickstart = K + 1；
- 目标时刻：(K + 1) + 5；

```
毫秒计数:   K-1  |   K   |  K+1  |  K+2  |  K+3  |  K+4  |  K+5  |  K+6
时间流动: -------|-------|-------|-------|-------|-------|-------|------
调用点：          ^（由于SysTick在整1ms处触发中断，所以需要等到K→K+1时作为起始点）
起始点：                 ^
目标点：                                                         ^
```

循环等待超过 K + 6 才退出，实际的延时时间为 5 个完整的 1ms 周期 + 调用前 0~1ms 的残余。

综上所述，延时函数 `HAL_Delay` 的 1ms 误差本质上是由于 `HAL_Delay()` 不是以调用瞬间为精确起点，而是以 **调用时刻的毫秒计数值** 为起点，等待这个计数增加 N 才退出。


## 参考资料

[Delay is 1ms longer than required](http://www.efton.sk/STM32/gotcha/g13.html)

## 附录

`HAL_TICK_FREQ_DEFAULT` 与 `HAL_InitTick()` 的定义

```c
/** @defgroup HAL_TICK_FREQ Tick Frequency
 * @{
 */
typedef enum {
    HAL_TICK_FREQ_10HZ = 100U,
    HAL_TICK_FREQ_100HZ = 10U,
    HAL_TICK_FREQ_1KHZ = 1U,
    HAL_TICK_FREQ_DEFAULT = HAL_TICK_FREQ_1KHZ
} HAL_TickFreqTypeDef;

/**
 * @brief This function configures the source of the time base.
 *        The time source is configured  to have 1ms time base with a dedicated
 *        Tick interrupt priority.
 * @note This function is called  automatically at the beginning of program
 * after reset by HAL_Init() or at any time when clock is reconfigured  by
 * HAL_RCC_ClockConfig().
 * @note In the default implementation, SysTick timer is the source of time
 * base. It is used to generate interrupts at regular time intervals. Care must
 * be taken if HAL_Delay() is called from a peripheral ISR process, The SysTick
 * interrupt must have higher priority (numerically lower) than the peripheral
 * interrupt. Otherwise the caller ISR process will be blocked. The function is
 * declared as __weak  to be overwritten  in case of other implementation  in
 * user file.
 * @param TickPriority Tick interrupt priority.
 * @retval HAL status
 */
__weak HAL_StatusTypeDef HAL_InitTick(uint32_t TickPriority) {
    /* Configure the SysTick to have interrupt in 1ms time basis*/
    if (HAL_SYSTICK_Config(SystemCoreClock / (1000U / uwTickFreq)) > 0U) {
        return HAL_ERROR;
    }

    /* Configure the SysTick IRQ priority */
    if (TickPriority < (1UL << __NVIC_PRIO_BITS)) {
        HAL_NVIC_SetPriority(SysTick_IRQn, TickPriority, 0U);
        uwTickPrio = TickPriority;
    } else {
        return HAL_ERROR;
    }

    /* Return function status */
    return HAL_OK;
}
```
