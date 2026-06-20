# Cloudflare Worker 部署指南

这个项目部署为 Cloudflare Worker + Workers Static Assets，数据库使用 Cloudflare D1。

## 目录结构

```text
.
├─ public/               # 前端页面、样式、脚本
├─ src/worker.js         # Worker API
├─ migrations/           # D1 数据库迁移 SQL
├─ wrangler.toml         # Cloudflare 配置
└─ package.json          # 本地脚本
```

## 1. 安装依赖并登录

```powershell
npm install
npx wrangler login
```

## 2. 创建 D1 数据库

```powershell
npx wrangler d1 create meter-usage
```

命令会输出类似下面的配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "meter-usage"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

把输出里的 `database_id` 复制到 `wrangler.toml`，替换：

```toml
database_id = "replace-with-your-d1-database-id"
```

## 3. 创建数据库表

本地开发数据库：

```powershell
npm run db:local
```

线上 D1 数据库：

```powershell
npm run db:remote
```

## 4. 本地运行

```powershell
npm run dev
```

Wrangler 会启动本地 Worker，并同时服务 `public/` 静态页面和 `/api/*` 接口。

## 5. 部署到 Cloudflare

```powershell
npm run deploy
```

部署后打开 Wrangler 输出的 `workers.dev` 地址即可使用。

## 6. 首次使用

1. 打开页面后，先录入电表和燃气表的初始日期、初始累计读数。
2. 在设置页填写结构化地址：省/市/区/街道/详细地址。
3. 填写彩云天气 API 密钥。
4. 保存设置后，Worker 会根据结构化地址解析经纬度，并由 Worker 调用彩云天气。

## 说明

- 读数和设置保存在 Cloudflare D1，不再依赖浏览器本地存储。
- 彩云天气 API 密钥保存在 D1，前端只会看到“已保存”状态，不会拿到明文密钥。
- 地址转经纬度当前使用 OpenStreetMap Nominatim；如果你的地址解析不稳定，可以在 `src/worker.js` 的 `geocodeAddress()` 中替换为高德、腾讯或 Google Geocoding API。
- 电表单位为 `kWh`，燃气单位为 `m³`。
- 未来用电预测只针对电表，依据最近用电均值和未来最高温做简化估算。

## 常见问题

### 部署时报 `D1 database binding DB is missing`

检查 `wrangler.toml` 中的 D1 绑定是否保留了：

```toml
[[d1_databases]]
binding = "DB"
```

Worker 代码中使用的是 `env.DB`，所以绑定名必须是 `DB`。

### 页面能打开，但接口 500

通常是迁移还没执行：

```powershell
npm run db:remote
```

### 想换数据库名

可以改 `wrangler.toml` 的 `database_name`，但 `database_id` 必须和 Cloudflare 创建出来的数据库一致。
