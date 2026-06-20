# Cloudflare Worker 部署指南

本项目部署为 Cloudflare Worker + Workers Static Assets，数据库使用 Cloudflare D1。

## 1. 安装依赖并登录

```powershell
npm install
npx wrangler login
```

## 2. 运行测试

```powershell
npm test
```

## 3. 创建 D1 数据库

```powershell
npx wrangler d1 create meter-usage
```

也可以在 Cloudflare Dashboard 中创建同名 D1 数据库。

## 4. 创建数据库表

远端数据库：

```powershell
npm run db:remote
```

本地数据库：

```powershell
npm run db:local
```

## 5. Dry Run

```powershell
npm run deploy:dry
```

这一步会检查 Worker 能否正常打包，但不会发布线上版本。

## 6. 部署 Worker

```powershell
npm run deploy
```

## 7. 在 Cloudflare Dashboard 绑定 D1

本仓库不在 `wrangler.toml` 中保存 D1 的 `database_id`。部署后请在 Cloudflare Dashboard 里绑定 D1：

1. 进入 **Workers & Pages**
2. 选择 Worker
3. 打开 **Settings** / **Bindings**
4. 添加 **D1 database**
5. Variable name 填 `DB`
6. 选择 D1 数据库 `meter-usage`
7. 保存并重新部署 Worker

Worker 代码使用 `env.DB`，所以绑定名必须是 `DB`。

## 8. 首次登录

打开 Worker URL 后使用：

```text
用户名：admin
密码：password
```

首次登录会强制修改密码。改密前，除认证接口以外的业务接口都会被拒绝。

## 9. 配置彩云天气和定位

进入设置页：

1. 填写结构化地址
2. 填写彩云天气 API token
3. 保存地址和天气设置
4. 如果地址解析失败，点击“使用当前位置”或手动填写经纬度
5. 保存经纬度
6. 在预测页点击“更新天气”

彩云 token 是敏感信息，不要写入仓库、提交记录或 `wrangler.toml`。本项目会把 token 保存在 D1，并在接口返回中隐藏明文。

## 常见问题

### `D1 database binding DB is missing`

Cloudflare Dashboard 还没有绑定 D1，或者绑定名不是 `DB`。

### 接口 500

通常是 D1 迁移还没有执行：

```powershell
npm run db:remote
```

### 忘记管理员密码

在 D1 中删除认证设置后会回到默认初始化登录：

```sql
DELETE FROM settings WHERE key = 'auth';
```

然后使用 `admin` / `password` 登录，并立即修改密码。
