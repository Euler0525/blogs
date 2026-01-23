---
title: CTF工具安装流程
tags:
  - Pwn
  - Web
  - Reverse
  - Misc
categories: 工具
mathjax: true
abbrlink: b3b69404
date: 2025-09-26 22:43:58
---

## Pwn

### [IDA Pro](https://pan.baidu.com/s/1IMTKHORAK8rNjjPZBVivmw?pwd=qcas)

> 版本号：v9.1 x64，[点击此处](https://cloud.189.cn/web/share?code=Zn2MrqJZrYZb) 获取安装包（访问码：3j1b）

运行安装包 `ida-pro_91_x64win.exe`，按提示完成安装，然后复制 `keygen_patch` 目录中的文件 `keygen.py` 和 `idapro.hexlic` 文件到 IDA Pro 主目录下（自定义修改 `keygen.py` 中的 `name`、`email` 字段），保存修改并运行 `keygen.py` 脚本。

运行 `keygen.py` 后会生成 patch 后的文件 `ida.dll.patched` 与 `ida32.dll.patched`。将原先的文件 `ida.dll` 和 `ida32.dll` 删除，然后将补丁文件 `ida.dll.patched` 与 `ida32.dll.patched` 分别重新命名为 `ida.dll` 和 `ida32.dll`。

然后运行下面脚本指定 Python 版本

```powershell
idapyswitch --force-path C:\Software\Anaconda\python3.dll
idapyswitch  # 再次运行，选择0即可
```

打开 IDA Pro 软件，[Help] → [License manager...]，勾选第一个即可，到此完成软件的激活，下面是插件的安装。

| 插件               | 功能                                                         |
| :----------------- | :----------------------------------------------------------- |
| BinDiff 8          | 文件对比                                                     |
| findcrypt-yara     | 识别常见加密算法                                             |
| keypatch           | patch 代码指令                                               |
| Hrtng              | 解密字符串，反混淆，括号高亮等。                             |
| classinformer      | 反编译 C++时，可以根据 RTTI 等信息综合恢复类 Class 的相关信息，例如继承信息，类名等。 |
| deREferencing      | 调试时增强显示寄存器和堆栈数据                               |
| HexRaysCodeXplorer | 自动识别结构体，显示 C++虚函数，生成函数结构树等             |

- **BinDiff 8**：运行 `bindiff8.msi`，然后将 `bindiff8_ida64.dll` 和 `binexport12_ida64.dll` 复制到目录 `C:\Users\Euler0525\AppData\Roaming\Hex-Rays\IDA Pro\plugins` 中（原本有残余文件需提前删除）；
- **findcrypt-yara**：将 `findcrypt3.py` 和 `findcrypt3.rules` 复制到 `C:\Software\IDA\plugins` 中，执行

```powershell
pip install yara-python -i https://pypi.tuna.tsinghua.edu.cn/simple
```

- **keypatch**：将 `keypatch.py` 复制到 `C:\Software\IDA\plugins` 中，执行

```powershell
pip install keystone-engine  -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install six -i https://pypi.tuna.tsinghua.edu.cn/simple
```

- **Hrtng**：将 `hrtng.dll` 复制到 `C:\Software\IDA\plugins` 中；
- **classinformer**：将 `ClassInformer64.dll` 复制到 `C:\Software\IDA\plugins` 中；
- **deREferencing**：将的 `dereferencing.py` 和文件夹 `dereferencing` 复制到 `C:\Software\IDA\plugins` 中；
- **HexRaysCodeXplorer**：将 `HexRaysCodeXplorer64.dll` 复制到 `C:\Software\IDA\plugins` 中；

## Web

### [Burpsuite](https://github.com/Euler0525/Burpsuite-Professional)

> ```powershell
> git clone git@github.com:xiv3r/Burpsuite-Professional.git
> ```

克隆仓库到本地作为安装路径，进入目录后以管理员身份运行 PowerShell，并执行

```powershell
Set-ExecutionPolicy -ExecutionPolicy bypass -Scope process
./install.ps1
```

脚本依次安装 jdk-21，jre1.8，BurpSuite Pro，然后进入注册流程：

填入 License 后选择 [Manual activation]，将弹出的第二栏中的内容 [Copy Request]，粘贴到 [Activation Request] 一栏中，最后将弹出的 [Activation Response] 粘贴到 [Paste  response] 一栏中，选择下一步完成激活。

## 参考资料

[IDA Pro](https://mrx.hk/posts/f66fa9e6643dec79c46f35361986b601/)

[BurpSuite](https://github.com/xiv3r/Burpsuite-Professional)
