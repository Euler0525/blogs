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

### 控制器与声明式管理

#### Deployment 实现自愈

一个终端持续观察 Pod

```shell
kubectl -n lab get pods -w
```

另一个终端删除一个由 Deployment 管理的 Pod

```shell
kubectl -n lab get pods -l app=web
kubectl -n lab delete pod <POD_NAME>
```

观察第一个终端，旧的 Pod 终止，新的 Pod 被创建

```shell
❯ kubectl -n lab get pods -w
NAME                  READY   STATUS              RESTARTS       AGE
web-77d77d44b-fllwp   1/1     Running             2 (77s ago)    22h
web-77d77d44b-nbc5r   1/1     Running             2 (77s ago)    22h
web-77d77d44b-nbc5r   1/1     Terminating         2 (2m1s ago)   22h
web-77d77d44b-lvkfq   0/1     Pending             0              0s
web-77d77d44b-nbc5r   1/1     Terminating         2 (2m1s ago)   22h
web-77d77d44b-lvkfq   0/1     Pending             0              0s
web-77d77d44b-lvkfq   0/1     ContainerCreating   0              0s
web-77d77d44b-nbc5r   0/1     Completed           2 (2m1s ago)   22h
web-77d77d44b-lvkfq   0/1     ContainerCreating   0              1s
web-77d77d44b-lvkfq   1/1     Running             0              1s
web-77d77d44b-nbc5r   0/1     Completed           2 (2m2s ago)   22h
web-77d77d44b-nbc5r   0/1     Completed           2 (2m2s ago)   22
```

接下来查看

```shell
❯ kubectl -n lab get deployment
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
web    2/2     2            2           24h
❯ kubectl -n lab get replicasets
NAME            DESIRED   CURRENT   READY   AGE
web-6cbdc5c6    0         0         0       24h
web-77d77d44b   2         2         2       22h
❯ kubectl -n lab get pods -o wide
NAME                  READY   STATUS    RESTARTS      AGE     IP           NODE       NOMINATED NODE   READINESS GATES
web-77d77d44b-fllwp   1/1     Running   2 (10m ago)   22h     10.244.0.2   minikube   <none>           <none>
web-77d77d44b-lvkfq   1/1     Running   0             8m18s   10.244.0.5   minikube   <none>           <none
```

上面演示了 Kubernetes 的 Reconciliation（调谐）机制：Deployment 期望 replicas = 2，但是 ReplicaSet Controller 发现实际 Pod 数量不足，于是创建替代的 Pod.

#### 滚动更新与故障恢复

首先备份

```shell
kubectl -n lab get deployment web -o yaml > web-backup.yaml
kubectl -n lab get deployment web \
  -o jsonpath='{.spec.template.spec.containers[*].name}{"\n"}{.spec.template.spec.containers[*].image}{"\n"}'
```

故意更新为不存在的镜像

```shell
    kubectl -n lab set image deployment/web nginx=nginx:this-tag-does-not-exist
```

检查发现新的 Pod 提示镜像拉取失败 `ImagePullBackOff`

```shell
kubectl -n lab get pods
kubectl -n lab get replicasets
kubectl -n lab rollout history deployment/web
kubectl -n lab get events --sort-by=.lastTimestamp
```

尝试检查本次更新

```shell
kubectl -n lab rollout status deployment/web --timeout=30s
```

由于镜像不存在，无法完成滚动更新。下面执行回滚

```shell
kubectl -n lab rollout undo deployment/web
kubectl -n lab rollout status deployment/web
kubectl -n lab get pods
```

### 服务发现与网络

#### Service DNS 与 Pod 通信

在 Kubenetes 中，Pod 的 IP 地址可能随着重建、调度而变化，因此不直接使用 Pod IP 访问应用，而是通过 Service 提供稳定的访问入口。Kubenetes 还提供集群内部 DNS 服务，使 Pod 可以通过 Service 名称访问其它应用，不比关心其实际 IP 地址。

下面通过实验验证

- **Service 发现**：查看 Service 的 ClusterIP、端口以及关联的后端 Pod；
- **DNS 解析**：验证集群 DNS 能否将 Service 域名解析为对应的 ClusterIP；
- **Pod 间通信**：从一个 Pod 通过 Service 访问另一个 Pod 中运行的 Nginx；

先观察已有的 Nginx Service 的地址以及后端

```shell
kubectl -n lab get svc web -o wide
kubectl -n lab get endpointslices -l kubernetes.io/service-name=web
```

然后创建一个临时网络调试 Pod

```shell
kubectl -n lab run dns-debug \
  --image=busybox:1.36 \
  --restart=Never \
  --command -- sleep 3600

kubectl -n lab wait pod/dns-debug --for=condition=Ready --timeout=120s
```

测试

```shell
# 测试 DNS
kubectl -n lab exec dns-debug -- nslookup web.lab.svc.cluster.local
# 测试 Nginx
kubectl -n lab exec dns-debug -- wget -qO- http://web.lab.svc.cluster.local
```

预期 `nslookup` 能够成功解析 `web.lab.svc.cluster.local`，并返回与前面 `kubectl get svc web` 查询到的 ClusterIP 一致的地址。然后通过 HHTP 请求访问 Nginx，请求的逻辑路径可以概括为 `dns-debug Pod → Service 域名解析 → Service ClusterIP → Nginx Pod`

最后清理掉临时用的 Pod

```shell
kubectl -n lab delete pod dns-debug
```

### 配置、存储与应用生命周期

### 应用工程化部署

### 运维与可观测性

### 多节点与云原生安全

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
