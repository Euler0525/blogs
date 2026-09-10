---
title: Kubernetes 学习笔记
description: 从 minikube 开始部署 k8s 环境，学习其架构与运行原理。
tags:
  - k8s
  - Kubernetes
  - Docker
categories: 计算机系统
abbrlink: 7f42a634
date: 2026-10-09 18:42:28
---

![kubernetes](https://cdn.jsdelivr.net/gh/Euler0525/tube/it/k8s_architecture.webp)

## 环境配置

```shell
OS: Kali Linux (on the Windows Subsystem for Linux)
Kernel: x86_64 Linux 6.18.40.1-microsoft-standard-WSL2
Shell: zsh 5.9.2
Resolution: No X Server
WM: Not Found
Disk: 1.4T / 3.9T (37%)
CPU: Intel Core i9-14900HX @ 32x 2.419GHz
GPU: NVIDIA GeForce RTX 4060 Laptop GPU
RAM: 2121MiB / 15851MiB
```

### minikube

```shell
curl -LO https://github.com/kubernetes/minikube/releases/latest/download/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
rm minikube-linux-amd64

minikube version
# minikube version: v1.39.0
# commit: 7a9f6a841470a207de8cf4bafcccee0969d8ba10

minikube start --vm-driver docker --container-runtime=docker

minikube status
# minikube
# type: Control Plane
# host: Running
# kubelet: Running
# apiserver: Running
# kubeconfig: Configured
```

### kubectl

```shell
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo chmod +x kubectl
sudo mv kubectl /usr/local/bin/kubectl
```

| 命令                           | 作用                     |
| ------------------------------ | ------------------------ |
| `kubectl get nodes`            | 查看集群节点             |
| `kubectl get pods -A`          | 查看所有命名空间里的 Pod |
| `kubectl get svc -A`           | 查看 Service             |
| `kubectl get deploy -A`        | 查看 Deployment          |
| `kubectl describe pod POD名称` | 查看 Pod 详细信息和事件  |
| `kubectl logs POD名称`         | 查看容器日志             |
| `kubectl get events -A`        | 查看集群事件             |
| `kubectl explain deployment`   | 查看资源字段说明         |

### helm

```shell
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4
sudo chmod +x get_helm.sh
./get_helm.sh

helm version
```

## minikube 部署

```shell
minikube delete -p minikube
minikube start \
  --driver=docker \
  --container-runtime=containerd \
  --cpus=2 \
  --memory=4096

minikube profile list
# ┌──────────┬────────┬────────────┬──────────────┬─────────┬────────┬───────┬────────────────┬────────────────────┐
# │ PROFILE  │ DRIVER │  RUNTIME   │      IP      │ VERSION │ STATUS │ NODES │ ACTIVE PROFILE │ ACTIVE KUBECONTEXT │
# ├──────────┼────────┼────────────┼──────────────┼─────────┼────────┼───────┼────────────────┼────────────────────┤
# │ minikube │ docker │ containerd │ 192.168.49.2 │ v1.37.0 │ OK     │ 1     │ *              │ *                  │
# └──────────┴────────┴────────────┴──────────────┴─────────┴────────┴───────┴────────────────┴────────────────────┘
```

> 运行下面指令发现
>
> ```shell
> kubectl get pods -n kube-system -o wide
> NAME                               READY   STATUS    RESTARTS   AGE   IP             NODE       NOMINATED NODE   READINESS GATES
> coredns-559f6c778d-v8kc8           1/1     Running   0          57s   10.244.0.2     minikube   <none>           <none>
> etcd-minikube                      1/1     Running   0          63s   192.168.49.2   minikube   <none>           <none>
> kindnet-gvv4t                      1/1     Running   0          57s   192.168.49.2   minikube   <none>           <none>
> kube-apiserver-minikube            1/1     Running   0          63s   192.168.49.2   minikube   <none>           <none>
> kube-controller-manager-minikube   1/1     Running   0          63s   192.168.49.2   minikube   <none>           <none>
> kube-proxy-8p8x8                   1/1     Running   0          57s   192.168.49.2   minikube   <none>           <none>
> kube-scheduler-minikube            1/1     Running   0          63s   192.168.49.2   minikube   <none>           <none>
> storage-provisioner                1/1     Running   0          62s   192.168.49.2   minikube   <none>           <none>
> ```
>
> | Pod 名称                           | 组件                | 主要作用                                       |
> | :--------------------------------- | :------------------ | :--------------------------------------------- |
> | `coredns-559f6c778d-v8kc8`         | CoreDNS             | 集群内部 DNS 服务，负责 Service 域名解析       |
> | `etcd-minikube`                    | etcd                | Kubernetes 的数据库，保存集群状态和配置        |
> | `kindnet-gvv4t`                    | kindnet             | CNI 网络组件，负责 Pod 网络连通性              |
> | `kube-apiserver-minikube`          | API Server          | Kubernetes API 入口，处理所有集群管理请求      |
> | `kube-controller-manager-minikube` | Controller Manager  | 控制器管理器，确保集群实际状态逐渐达到期望状态 |
> | `kube-proxy-8p8x8`                 | kube-proxy          | 实现 Service 到后端 Pod 的网络转发             |
> | `kube-scheduler-minikube`          | Scheduler           | 调度器，决定新 Pod 应该运行在哪个 Node 上      |
> | `storage-provisioner`              | Storage Provisioner | 为 PVC 动态创建本地持久化存储                  |

---

在本地 Kubernetes 集群中运行 Nginx，创建多个副本，并从 Windows 浏览器访问它

```shell
mkdir -p k8s-lab
cd k8s-lab
vim nginx.yaml  # 见附录

# 下面部署 Nginx
kubectl apply -f nginx.yaml
# namespace/lab created
# deployment.apps/web created
# service/web created

kubectl -n lab get deployments
kubectl -n lab get pods -o wide
kubectl -n lab get services

# 等待应用就绪
kubectl -n lab rollout status deployment/web

# 浏览器访问
minikube service web -n lab --url  # http://127.0.0.1: XXXXX
```

创建完成后

```shell
Kubernetes Cluster
├── default
├── kube-system
└── lab
    ├── Deployment/web
    ├── Service/web
    └── Pod/...
```

## 附录

- `nginx.yaml`：这份文件定义了三个资源：一个 `Namespace`、一个具有两个副本的 `Deployment`，以及一个 `NodePort` 类型的 `Service`。

```yaml

apiVersion: v1
kind: Namespace
metadata:
  name: lab
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: lab
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:stable
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: lab
spec:
  type: NodePort
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
```

