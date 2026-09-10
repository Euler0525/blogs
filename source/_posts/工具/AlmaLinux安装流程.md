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

Windows 通过 WSL2 访问另一块硬盘上的 AlmaLinux 文件

- 在 Windows 中识别并连接 AlmaLinux 硬盘

```powershell
Get-CimInstance Win32_DiskDrive | Select-Object DeviceID, Model, Size
wsl --mount \\.\PHYSICALDRIVE1 --bare
```

- 在 WSL 中确认磁盘布局

```shell
lsblk -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINTS
sudo blkid
# sde                disk 931.5G
# ├─sde1             part   512M vfat
# ├─sde2             part     1G xfs
# └─sde3             part   930G LVM2_member
```

- 安装 lvm2

```shell
sudo apt update
sudo apt install lvm2

sudo pvs
sudo vgs
sudo lvs -a -o lv_path,lv_size,lv_attr
# PV         VG        Fmt  Attr PSize    PFree
# /dev/sde3  almalinux lvm2 a--  < 930.01g 8.00m
# VG        #PV #LV #SN Attr   VSize    VFree
# almalinux   1   2   0 wz--n- < 930.01g 8.00m
# Path                LSize   Attr
# /dev/almalinux/root 898.00g -wi-ao----
# /dev/almalinux/swap  32.00g -wi-a-----
```

- 激活

```shell
sudo vgchange -ay almalinux
lsblk -f
# sde
# ├─sde1             vfat        FAT32
# ├─sde2             xfs
# └─sde3             LVM2_member LVM2 001
#   ├─almalinux-root xfs
#   └─almalinux-swap swap        1
sudo lvs -a -o lv_path,lv_size,lv_attr
```

- 只读挂载根分区

```shell
sudo mkdir -p /mnt/almalinux
sudo mount -t xfs -o ro,norecovery /dev/almalinux/root /mnt/almalinux

findmnt /mnt/almalinux
# TARGET         SOURCE                     FSTYPE OPTIONS
# /mnt/almalinux /dev/mapper/almalinux-root xfs    ro, relatime, norecovery, inode64, logbufs = 8, logbsize = 32k, sunit = 64, swidth = 512, noquota
```

- 使用完毕后安全卸载

```shell
sudo umount /mnt/almalinux
sudo vgchange -an almalinux
```

Windows 中断开物理硬盘


```powershell
wsl --unmount \\.\PHYSICALDRIVE1
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

### 触摸板手势

```shell
cat /etc/almalinux-release  # AlmaLinux release 9.8 (Olive Jaguar)
echo $XDG_CURRENT_DESKTOP   # GNOME
echo $XDG_SESSION_TYPE      # x11
gnome-shell --version       # GNOME Shell 40.10

sudo dnf install -y epel-release dnf-plugins-core
sudo dnf config-manager --set-enabled crb
sudo dnf copr enable joseexposito/touchegg
```

[点击此处](https://github.com/JoseExposito/touchegg/releases/) 获取 `touchegg` 安装包 `rhel8_touchegg-<version>.x86_64.rpm`

```shell
sudo dnf install ./rhel8_touchegg-<version>.x86_64.rpm
```

配置文件（与 Windows 手势一致）如下

```xml
<! -- cat ~/.config/touchegg/touchegg.conf -->

<touchégg>
  <settings>
    <property name="animation_delay">150</property>
    <property name="action_execute_threshold">20</property>
  </settings>

  <application name="All">

    <gesture type="SWIPE" fingers="3" direction="LEFT">
      <action type="SEND_KEYS">
        <repeat>false</repeat>
        <modifiers>Alt_L</modifiers>
        <keys>Escape</keys>
        <on>begin</on>
      </action>
    </gesture>

    <gesture type="SWIPE" fingers="3" direction="RIGHT">
      <action type="SEND_KEYS">
        <repeat>false</repeat>
        <modifiers>Alt_L+Shift_L</modifiers>
        <keys>Escape</keys>
        <on>begin</on>
      </action>
    </gesture>

    <gesture type="SWIPE" fingers="4" direction="LEFT">
      <action type="SEND_KEYS">
        <repeat>false</repeat>
        <modifiers>Control_L+Alt_L</modifiers>
        <keys>Right</keys>
        <on>begin</on>
      </action>
    </gesture>

    <gesture type="SWIPE" fingers="4" direction="RIGHT">
      <action type="SEND_KEYS">
        <repeat>false</repeat>
        <modifiers>Control_L+Alt_L</modifiers>
        <keys>Left</keys>
        <on>begin</on>
      </action>
    </gesture>

  </application>
</touchégg>
```

下面配置开机启动

```shell
sudo systemctl enable --now touchegg
sudo systemctl start --now touchegg
systemctl status touchegg

mkdir -p ~/.config/autostart
cat > ~/.config/autostart/touchegg.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=Touchégg
Comment=Touchpad gesture service
Exec=touchegg
Terminal=false
Hidden=false
X-GNOME-Autostart-enabled=true
EOF

pgrep -af touchegg
# 同时存在以下两个进程
# /usr/bin/touchegg --daemon
# touchegg
```

### 输入法

- 中文输入法

```shell
sudo dnf makecache
sudo dnf install -y @input-methods langpacks-zh_CN       # 安装中文语言包
sudo dnf install -y ibus ibus-libpinyin langpacks-zh_CN  # 仅安装中文输入法

rpm -q ibus            # 检查是否安装成功
rpm -q ibus-libpinyin
ibus list-engine | grep -i pinyin
locale -a | grep zh_CN

sudo reboot
```

然后 [Settings] → [Keyboard] → [Input Sources]，添加 [Chinese (Intelligent Pinyin)]

完成之后，桌面右上角的输入源会显示

```shell
English (US)
Chinese (Intelligent Pinyin)
```

GNOME 切换输入源的默认快捷键是 `Super/Win + Space`

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

推荐在使用 `nvcc` 时指定 GPU 架构，参考 [CUDA GPU Compute Capability](https://developer.nvidia.com/cuda/gpus).

```shell
nvcc -arch=sm_89
```

### 其它工具

- `fsearch`：全局搜索文件

```shell
sudo dnf copr enable cboxdoerfer/fsearch
sudo dnf install -y fsearch
```



## 附录

[Notebookcheck | Benchmarks/Tech | NVIDIA GeForce RTX 4060 Laptop GPU](https://www.notebookcheck.net/NVIDIA-GeForce-RTX-4060-Laptop-GPU-Benchmarks-and-Specs.675692.0.html)
