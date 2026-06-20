# 电表与燃气统计

一个部署在 Cloudflare Worker 上的家庭能耗统计工具。前端是原生 HTML/CSS/JavaScript，后端使用 Cloudflare Worker API，数据保存在 Cloudflare D1。

## 功能

- 记录电表和燃气表累计读数
- 自动计算每日消耗
- 查看近 30 天趋势
- 导出 CSV
- 保存结构化地址和天气 API 密钥
- 使用彩云天气做未来 7 天用电预测
- 通过 Cloudflare D1 保存数据

## 项目结构

```text
public/               前端页面、样式、脚本
src/worker.js         Cloudflare Worker API
migrations/           D1 建表 SQL
wrangler.toml         Worker 和静态资源配置
package.json          常用命令
```

## 本地准备

```powershell
npm install
npx wrangler login
```

## 创建 D1 数据库

在 Cloudflare 创建 D1 数据库：

```powershell
npx wrangler d1 create meter-usage
```

也可以直接在 Cloudflare 控制台创建 D1 数据库，数据库名建议使用：

```text
meter-usage
```

## 创建数据表

远端数据库执行迁移：

```powershell
npm run db:remote
```

如果你想先在本地测试迁移：

```powershell
npm run db:local
```

## 绑定 D1

本仓库不在 `wrangler.toml` 中保存 D1 的 `database_id`。

部署到 Cloudflare 后，在 Cloudflare 控制台手动绑定 D1：

1. 打开 Cloudflare Dashboard
2. 进入 **Workers & Pages**
3. 选择你的 Worker
4. 进入 **Settings** / **Bindings**
5. 添加 **D1 database**
6. Variable name 填：

```text
DB
```

7. 选择你的 D1 数据库，例如 `meter-usage`
8. 保存并重新部署 Worker

注意：绑定名必须是 `DB`，因为 Worker 代码使用的是 `env.DB`。

## 部署

```powershell
npm run deploy
```

部署成功后，打开 Wrangler 输出的 `workers.dev` 地址。

如果你使用 Cloudflare 的 GitHub 集成部署，也可以把仓库连接到 Cloudflare Workers，然后在控制台里配置 D1 绑定。

## 本地运行

```powershell
npm run dev
```

打开 Wrangler 输出的本地地址，例如：

```text
http://127.0.0.1:8787
```

接口检查：

```text
http://127.0.0.1:8787/api/state
```

如果本地没有 D1 绑定，`/api/state` 会提示 `D1 database binding DB is missing`。线上只要在 Cloudflare 控制台把 D1 绑定名设置为 `DB` 即可。

## 首次使用

1. 打开页面
2. 录入电表初始读数
3. 录入燃气表初始读数
4. 进入设置页
5. 填写地址
6. 填写彩云天气 API 密钥
7. 保存设置
8. 每天录入新的累计读数

## 常用命令

```powershell
npm run dev        # 本地开发
npm run deploy     # 部署到 Cloudflare Worker
npm run db:local   # 本地 D1 迁移
npm run db:remote  # 远端 D1 迁移
```

## 常见问题

### 页面能打开，但接口提示 DB missing

去 Cloudflare Worker 的 Settings / Bindings 添加 D1 database，变量名必须是：

```text
DB
```

### 页面能打开，但接口 500

通常是远端 D1 还没有建表，执行：

```powershell
npm run db:remote
```

### 彩云天气不可用

检查设置页是否已经填写彩云天气 API 密钥，并且地址已经成功解析出经纬度。
