---
title: Codex 客户端免手机号验证
description: '记录在 Codex 客户端中复用 ChatGPT 登录会话的配置流程，包括会话信息导出、格式转换和本地认证文件处理。'
tags:
  - Codex
categories: 工具
mathjax: true
abbrlink: f1aa593e
date: 2026-07-05 11:00:53
---

> 首先关闭 Codex 客户端，结束所有相关进程，并且删除缓存目录 `%USERPROFILE%\.codex\cache`

## 操作步骤

- 进入 [https://chatgpt.com/api/auth/session](https://chatgpt.com/api/auth/session)，保存内容至本地，形如

```json
{
  "user": {
    "id": "",
    "email": ""
  },
  "expires": "",
  "account": {
    "id": "",
    "planType": "plus",
    "structure": "personal",
  },
  "accessToken": "",
  "authProvider": "openai",
  "sessionToken": ""
}
```

- 使用附录脚本转换为 Codex 能够识别的格式，形如

```json
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "",
    "access_token": "",
    "refresh_token": "",
    "account_id": ""
  },
  "last_refresh": ""
}
```

- 将转换结果另存为 `%USERPROFILE%\.codex\auth.json`

- 启动 Codex 客户端

## 附录

### `auth.json` 格式转换脚本

- [点击此处](https://github.com/Euler0525/scripts/blob/master/python/codex-auth.py) 获取 Python 脚本

```powershell
python .\codex-auth.py .\input.json -o auth.json
```

- [点击此处](https://github.com/Euler0525/scripts/blob/master/javascript/codex-auth.js) 获取 JavaScript 脚本

```powershell
node .\codex-auth.js .\input.json -o auth.json
```

