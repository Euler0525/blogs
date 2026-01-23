---
title: AlmaLinux 安装流程
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
