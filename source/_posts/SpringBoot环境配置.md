---
title: SpringBoot环境配置
tags:
  - 环境配置
categories: 编程
mathjax: true
abbrlink: 23335ee9
date: 2025-07-15 16:42:57
---

## Windows

> 操作系统：**Windows 11 Pro 24H2**
>
> 安装包路径
>
> - [Java(TM)SE Development Kit 24.0.1(64-bit)](https://www.oracle.com/cn/java/technologies/downloads/#jdk24-windows)
> - [IntelliJ IDEA Community Ultimate 2025.1.3](https://www.jetbrains.com/idea/download/?section=windows)
> - [Apache Maven 3.9.10](https://maven.apache.org/download.cgi)（下载 `.zip` 文件并解压）

### 添加环境变量

1. 新建 **系统变量**：
    - 变量名为 `JAVA_HOME`，变量值为 `C:\Software\Java\jdk-24`
    - 变量名为 `MAVEN_HOME`，变量值为 `C:\Software\Java\Maven`

2. 系统变量 Path 中添加 `C:\Software\Java\jdk-24\bin` 和 `C:\Software\Java\Maven\bin`

添加完成后打开 PowerShell，执行 `java --version`，显示如下

```powershell
❯ java --version
Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8
java 24.0.1 2025-04-15
Java(TM) SE Runtime Environment (build 24.0.1+9-30)
Java HotSpot(TM) 64-Bit Server VM (build 24.0.1+9-30, mixed mode, sharing)
```

执行 `mvn -v`，显示如下

```powershell
❯ mvn -v
Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8
Apache Maven 3.9.10 (5f519b97e944483d878815739f519b2eade0a91d)
Maven home: C:\Software\Java\Maven
Java version: 24.0.1, vendor: Oracle Corporation, runtime: C:\Software\Java\jdk-24
Default locale: en_US, platform encoding: UTF-8
OS name: "windows 11", version: "10.0", arch: "amd64", family: "windows"
```

### 配置 Maven 本地仓库

将 `C:\Software\Java\Maven\conf\settings.xml` 文件第 53 行的 `localRepository` 修改为

```xml
  <!-- localRepository
   | The path to the local repository maven will use to store artifacts.
   |
   | Default: ${user.home}/.m2/repository
  -->
  <localRepository>C:\Software\Java\Maven\repo</localRepository>
```

修改第 147 行的 `mirrors` 节点为

```xml
  <mirrors>
    <!-- mirror
     | Specifies a repository mirror site to use instead of a given repository. The repository that
     | this mirror serves has an ID that matches the mirrorOf element of this mirror. IDs are used
     | for inheritance and direct lookup purposes, and must be unique across the set of mirrors.
     |
    <mirror>
      <id>mirrorId</id>
      <mirrorOf>repositoryId</mirrorOf>
      <name>Human Readable Name for this Mirror.</name>
      <url>http://my.repository.com/repo/path</url>
    </mirror>

    <mirror>
      <id>maven-default-http-blocker</id>
      <mirrorOf>external:http:*</mirrorOf>
      <name>Pseudo repository to mirror external repositories initially using HTTP.</name>
      <url>http://0.0.0.0/</url>
      <blocked>true</blocked>
    </mirror>
    |-->
    <mirror>
      <id>alimaven</id>
      <name>aliyun maven</name>
      <url>http://maven.aliyun.com/nexus/content/groups/public/</url>
      <mirrorOf>central</mirrorOf>
    </mirror>
    <mirror>
      <id>alimaven</id>
      <mirrorOf>central</mirrorOf>
      <name>aliyun maven</name>
      <url>http://maven.aliyun.com/nexus/content/repositories/central/</url>
    </mirror>
  </mirrors>
```

### 配置 Intellij IDEA

[Settings] → [Build, Execution, Deployment] → [Build Tools] → [Maven]

配置 Maven 路径为

- `[Maven home path]`: `C:\Software\Java\Maven`
- `[User settings file]`: `C:\Software\Java\Maven\conf\settings.xml`
- `[Local repository]`: `C:\Software\Java\Maven\repo`
