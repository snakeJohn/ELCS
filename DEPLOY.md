# Cloudflare Pages 部署指南

本项目部署为 Cloudflare Pages + Pages Functions，数据库使用 Cloudflare D1。D1 绑定保存在 Pages 项目配置中，不需要把 `database_id` 写入仓库。

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
npx wrangler d1 create elcs
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

这一步会创建一个 Pages 预览部署，用于检查静态资源和 Functions 能否正常上传。

## 6. 部署 Pages

```powershell
npm run deploy
```

## 7. 在 Cloudflare Dashboard 绑定 D1

Pages 项目绑定 D1 后，后续 Git 自动部署会继续沿用这个绑定：

1. 进入 **Workers & Pages**
2. 选择 Pages 项目 `elcs`
3. 打开 **Settings** / **Functions** / **D1 database bindings**
4. 添加 D1 database binding
5. Variable name 填 `DB`
6. 选择 D1 数据库 `elcs`
7. 保存并重新部署 Pages

API 代码使用 `env.DB`，所以绑定名必须是 `DB`。

## 8. Git 自动部署设置

将仓库连接到 Cloudflare Pages，使用以下设置：

```text
Framework preset: None
Build command: npm test
Build output directory: public
Root directory: /
```

## 9. 首次登录

打开 Pages URL 后使用：

```text
用户名：admin
密码：password
```

首次登录会强制修改密码。改密前，除认证接口以外的业务接口都会被拒绝。

## 10. 配置彩云天气和定位

进入设置页：

1. 填写结构化地址
2. 填写彩云天气 API token
3. 保存地址和天气设置
4. 如果地址解析失败，点击“使用当前位置”或手动填写经纬度
5. 保存经纬度
6. 在预测页点击“更新天气”

彩云 token 是敏感信息，不要写入仓库或提交记录。本项目会把 token 保存在 D1，并在接口返回中隐藏明文。

## 常见问题

### `D1 database binding DB is missing`

Cloudflare Pages 项目还没有绑定 D1，或者绑定名不是 `DB`。

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
