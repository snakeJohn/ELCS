# Cloudflare Worker 部署指南

本项目部署为 Cloudflare Worker + Workers Static Assets，数据库使用 Cloudflare D1。

## 1. 安装依赖并登录

```powershell
npm install
npx wrangler login
```

## 2. 创建 D1 数据库

```powershell
npx wrangler d1 create meter-usage
```

也可以在 Cloudflare 控制台中创建同名 D1 数据库。

## 3. 创建数据库表

远端数据库：

```powershell
npm run db:remote
```

本地数据库：

```powershell
npm run db:local
```

## 4. 部署 Worker

```powershell
npm run deploy
```

## 5. 在 Cloudflare 控制台绑定 D1

本仓库不在 `wrangler.toml` 中保存 D1 的 `database_id`。部署后请在 Cloudflare Dashboard 里绑定 D1：

1. 进入 **Workers & Pages**
2. 选择 Worker
3. 打开 **Settings** / **Bindings**
4. 添加 **D1 database**
5. Variable name 填 `DB`
6. 选择 D1 数据库 `meter-usage`
7. 保存并重新部署 Worker

Worker 代码使用 `env.DB`，所以绑定名必须是 `DB`。

## 6. 首次使用

1. 打开 Worker URL
2. 录入电表和燃气表初始读数
3. 在设置页填写地址和彩云天气 API 密钥
4. 保存设置
5. 开始录入每日累计读数

## 常见问题

### `D1 database binding DB is missing`

Cloudflare 控制台还没有绑定 D1，或者绑定名不是 `DB`。

### 接口 500

通常是 D1 迁移还没有执行：

```powershell
npm run db:remote
```
