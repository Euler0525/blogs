---
title: AlmaLinux 安装流程
description: '记录 AlmaLinux 双系统安装后的配置过程，包括修复 Windows 启动项、挂载 NTFS 硬盘、切换软件源，以及安装 Xilinx、MATLAB、CUDA 等开发工具。'
tags:
  - Linux
categories: 工具
mathjax: true
abbrlink: 1dc8999e
date: 2026-05-17 15:52:13
---

> 点击进入 [AlmaLinux 镜像](https://almalinux.org/get-almalinux/) 下载地址

## 双系统

在 AlmaLinux 系统中设置 GRUB 默认启动 Windows

```shell
sudo awk -F"'" '/menuentry / {print $2}' /boot/grub2/grub.cfg
##################
Windows Boot Manager (on /dev/nvme1n1p1)
UEFI Firmware Settings
##################

sudo grub2-set-default 'Windows Boot Manager (on /dev/nvme1n1p1)'
sudo grub2-editenv list
##################
saved_entry=Windows Boot Manager (on /dev/nvme1n1p1)
##################

sudo reboot  # 重启验证, 倒计时结束后进入 Windows 系统
```

## 硬盘

以读/写模式挂载 NTFS 驱动器

```shell
# 1. 启用 EPEL 存储库
sudo dnf install epel-release
# 2. 安装 ntfs-3g 驱动
sudo dnf install ntfs-3g
```

## 软件

### 换源

```shell
# 阿里云源
sudo cp -r /etc/yum.repos.d/ /etc/yum.repos.d.bak
sudo sed -e 's|^mirrorlist=|#mirrorlist =|g' -e 's|^# baseurl = https://repo.almalinux.org|baseurl = https://mirrors.aliyun.com|g' -i.bak /etc/yum.repos.d/almalinux*.repo

sudo dnf clean all
sudo dnf makecache
sudo dnf upgrade -y
```

### AMD Xilinx

```shell
sudo dnf install -y ncurses-libs ncurses-devel ncurses-compat-libs
sudo dnf install -y gtk2  # for Xilinx SDK 2019.1
```

### MATLAB

```ini
// 图形界面快捷方式 /usr/share/applications/MATLAB.desktop
[Desktop Entry]
Version=1.0
Type=Application
Terminal=false
Exec=/opt/MATLAB/R2024b/bin/matlab -desktop
Name=MATLAB R2024b
Icon=/opt/MATLAB/R2024b/ui/webgui/src/favicon.ico
Catefories=Math;Science
Comment=Scientific Computing Envirenment
StartNotify=true
StartupWMClass=com-mathworks-util-PostVMInit
```

### VS Code

```shell
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc &&
echo -e "[code]\nname=Visual Studio Code\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\nenabled=1\nautorefresh=1\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://packages.microsoft.com/keys/microsoft.asc" | sudo tee /etc/yum.repos.d/vscode.repo > /dev/null
dnf check-update
sudo dnf install code # or code-insiders
```

### CUDA

```shell
# AlmaLinux
         'c:.
        lkkkx, ..       ..   ,cc,           ----------------------
        okkkk:ckkx'  .lxkkx.okkkkd          OS: AlmaLinux 9.8 (Olive Jaguar) x86_64
        .:llcokkx'  :kkkxkko:xkkd,
      .xkkkkdood:  ;kx,  .lkxlll;           Kernel: Linux 5.14.0-687.24.1.el9_8.x86_64
       xkkx.       xk'     xkkkkk:
       'xkx.       xd      .....,.
      .. :xkl'     :c      ..''..           Shell: bash 5.1.8
    .dkx'  .:ldl:'. '  ':lollldkkxo;
  .''lkkko'                     ckkkx.      DE: GNOME 40.10
'xkkkd:kkd.       ..  ;'        :kkxo.      WM: Mutter (Wayland)
,xkkkd;kk'      ,d;    ld.   ':dkd::cc,     WM Theme: Adwaita
 .,,.;xkko'.';lxo.      dx,  :kkk'xkkkkc    Theme: Adwaita [GTK2/3/4]
     'dkkkkkxo:.        ;kx  .kkk:;xkkd.    Icons: Adwaita [GTK2/3/4]
       .....   .;dk:.   lkk.  :;,
             :kkkkkkkdoxkkx
              ,c,,;;;:xkkd.                 Terminal: GNOME Terminal 3.40.3
                ;kkkkl...                   Terminal Font: Monospace (18pt)
                ;kkkkl                      CPU: Intel(R) Core(TM) i9-14900HX (32) @ 5.80 GHz
                 ,od;                       GPU 1: NVIDIA GeForce RTX 4060 Max-Q / Mobile [Discrete]
                                            GPU 2: Intel Raptor Lake-S UHD Graphics @ 1.65 GHz [Integrated]
```

- 安装基础工具

```shell
sudo dnf upgrade -y
lspci | grep -i nvidia
# 01:00.0 VGA compatible controller: NVIDIA Corporation AD107M [GeForce RTX 4060 Max-Q / Mobile] (rev a1)
# 01:00.1 Audio device: NVIDIA Corporation AD107 High Definition Audio Controller (rev a1)
sudo dnf install -y gcc gcc-c++ make kernel-devel-$(uname -r) kernel-headers-$(uname -r) dkms pciutils
```

- 添加 NVIDIA CUDA 仓库

```shell
rpm -E %rhel
sudo dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo
sudo dnf clean expire-cache
sudo dnf makecache
dnf repolist | grep -i cuda  # cuda-rhel9-x86_64   cuda-rhel9-x86_64
```

- 禁用 Nouveau 驱动

```shell
sudo tee /etc/modprobe.d/blacklist-nouveau.conf >/dev/null <<'EOF'
blacklist nouveau
options nouveau modeset=0
EOF

sudo grubby --update-kernel=ALL --args="rd.driver.blacklist=nouveau modprobe.blacklist=nouveau nouveau.modeset=0"
# 重新生成 initramfs
sudo dracut --force
sudo reboot

lsmod | grep nouveau  # 无输出
```

- 安装 NVIDIA 驱动

```shell
sudo dnf module reset nvidia-driver -y
sudo dnf module enable nvidia-driver:latest-dkms -y
sudo dnf install -y cuda-drivers
sudo reboot  # BIOS 关闭 Security Boot

nvidia-smi
# +-----------------------------------------------------------------------------------------+
# | NVIDIA-SMI 610.43.02              KMD Version: 610.43.02     CUDA UMD Version: 13.3     |
# +-----------------------------------------+------------------------+----------------------+
```

- 安装 CUDA Toolkit

```shell
dnf list --showduplicates 'cuda-toolkit*'  # 查看可用版本
sudo dnf install -y cuda-toolkit  # 安装默认版本
ls -ld /usr/local/cuda*

sudo tee /etc/profile.d/cuda.sh >/dev/null <<'EOF'
export CUDA_HOME=/usr/local/cuda
export PATH="${CUDA_HOME}/bin:${PATH}"
export LD_LIBRARY_PATH="${CUDA_HOME}/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
EOF
source /etc/profile.d/cuda.sh

# 验证安装完成
which nvcc
nvcc --version
echo "$CUDA_HOME"
```
