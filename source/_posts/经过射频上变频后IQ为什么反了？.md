---
title: 经过射频上变频后IQ为什么反了？
tags:
  - 射频
categories: 射频
mathjax: true
abbrlink: 586c4b23
date: 2025-07-11 11:06:48
---

## 数学原理

<img src="https://cdn.jsdelivr.net/gh/Euler0525/tube/ct/superheterodyne_transmitter.webp" alt="superheterodyne_transmitter" width="90%" height="80%"/>

设数字域信号为 $s = I + jQ$，经过中频上变频，DAC 发射信号为

$$
\begin{aligned}
s_{IF} &= \text{real}\left\{(I + jQ)\cdot(\cos 2\pi f_{IF}t + j\sin 2\pi f_{IF}t)\right\}\\
&= I\cos 2\pi f_{IF}t - Q\sin 2\pi f_{IF}t\\
\end{aligned}
$$

频域表示为

$$
s_{IF}(f) = \dfrac{1}{2}S(f-f_{IF}) + \dfrac{1}{2}S^*(-(f + f_{IF}))\\
$$


经过射频的上变频，最终发射信号表示为

$$
\begin{aligned}
s_{RF} &= s_{IF} \cdot \cos(2 \pi f_{RF} t)\\
&= (I\cos 2\pi f_{IF}t - Q\sin 2\pi f_{IF}t) \cdot \cos(2 \pi f_{RF} t)\\
\end{aligned}
$$


## 仿真(MATLAB)

```matlab
close all; clear; clc;

%% System Parameters
fs = 24.576e3;       % 24.576MHz
fc = 10;             % 10kHz
f_if = 50;           % 50kHz
f_rf1 = 450;         % 450kHz
f_rf2 = 550;         % 550kHz

N = 2 ^ 20;
t = 0: 1/fs : 500;   % 500s
f = (-N/2 : N/2-1) * (fs/N);

%% Digital Baseband Signal
i = cos(2 * pi * fc * t);
q = 0.5 * sin(2 * pi * fc * t);
s = i + 1j * q;

S = 10 * log10(fftshift(fft(s, N)));

% Plot Digital Baseband Signal
figure;
subplot(2, 2, 1);
plot(t(1:32768), real(s(1:32768)));
title('Digital Baseband Signal - Real Part');
xlabel('Time (s)');
ylabel('Amplitude');

subplot(2, 2, 3);
plot(t(1:32768), imag(s(1:32768)));
title('Digital Baseband Signal - Imaginary Part');
xlabel('Time (s)');
ylabel('Amplitude');

subplot(2, 2, 2);
plot(f, real(S));
title('Digital Baseband Signal Spectrum - Real Part');
xlabel('Frequency (Hz)');
ylabel('Magnitude (dB)');

subplot(2, 2, 4);
plot(f, imag(S));
title('Digital Baseband Signal Spectrum - Imaginary Part');
xlabel('Frequency (Hz)');
ylabel('Magnitude (dB)');

%% Digital to IF Conversion
s_if = real(s .* (cos(2 * pi * f_if * t) + 1j * sin(2 * pi * f_if * t)));
S_if = 10 * log10(fftshift(fft(s_if, N)));

% Plot IF Signal
figure;
subplot(2, 1, 1);
plot(t(1:32768), s_if(1:32768));
title('Intermediate Frequency (IF) Signal Waveform');
xlabel('Time (s)');
ylabel('Amplitude');

subplot(2, 1, 2);
plot(f, real(S_if));
title('IF Signal Spectrum');
xlabel('Frequency (Hz)');
ylabel('Magnitude (dB)');

%% IF to RF Conversion
s_rf1 = s_if .* cos(2 * pi * f_rf1 * t);
S_rf1 = 10 * log10(fftshift(fft(s_rf1, N)));
s_rf2 = s_if .* cos(2 * pi * f_rf2 * t);
S_rf2 = 10 * log10(fftshift(fft(s_rf2, N)));

% Plot RF Signals
figure;
subplot(2, 2, 1);
plot(t(1:32768), s_rf1(1:32768));
title(['RF Signal @ ', num2str(f_rf1), 'kHz - Waveform']);
xlabel('Time (s)');
ylabel('Amplitude');

subplot(2, 2, 3);
plot(f, real(S_rf1));
title(['RF Signal @ ', num2str(f_rf1), 'kHz - Spectrum']);
xlabel('Frequency (Hz)');
ylabel('Magnitude (dB)');

subplot(2, 2, 2);
plot(t(1:32768), s_rf2(1:32768));
title(['RF Signal @ ', num2str(f_rf2), 'kHz - Waveform']);
xlabel('Time (s)');
ylabel('Amplitude');

subplot(2, 2, 4);
plot(f, real(S_rf2));
title(['RF Signal @ ', num2str(f_rf2), 'kHz - Spectrum']);
xlabel('Frequency (Hz)');
ylabel('Magnitude (dB)');
```
