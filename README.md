# ELCS 能耗控制台

ELCS 是一个部署在 Cloudflare Pages 上的家庭电表 / 燃气表统计工具。前端使用原生 HTML/CSS/JavaScript，后端通过 Pages Functions 运行 API，数据保存在 Cloudflare D1。

## 功能

- 登录保护家庭读数和天气配置
- 默认账号 `admin`，初始密码 `password`
- 首次登录后强制修改密码
- 记录电表和燃气表累计读数
- 自动按相邻读数计算每日消耗
- 查看近 30 天消耗趋势
- 导出 CSV
- 保存结构化地址、彩云天气 API 密钥和经纬度
- 结构化地址无法解析时，可使用浏览器当前位置或手动经纬度
- 使用彩云天气预测未来 7 天用电
- 使用 Cloudflare D1 保存设置、读数、认证哈希和会话

## 项目结构

```text
public/               前端页面、样式、脚本和本地图标运行时
functions/api/        Cloudflare Pages Functions API 入口
src/worker.js         API 业务逻辑
migrations/           D1 建表 SQL
test/                 Node 内置测试
package.json          常用命令
DEPLOY.md             部署步骤
```

## 本地准备

```powershell
npm install
```

## 本地运行

先执行本地 D1 迁移：

```powershell
npm run db:local
```

启动 Pages 本地开发服务：

```powershell
npm run dev
```

打开 Wrangler 输出的地址，例如：

```text
http://127.0.0.1:8787
```

首次登录：

```text
用户名：admin
密码：password
```

登录后页面会要求立即修改初始密码。修改前，读数、设置、天气等业务接口都会返回 `PASSWORD_CHANGE_REQUIRED`。

## 测试

```powershell
npm test
```

当前测试覆盖：

- 未登录业务 API 返回 401
- 默认账号登录后强制改密
- 改密后旧密码失效、新密码可用
- 登录 session 可以访问业务 API
- 手动经纬度保存
- UI 静态结构、本地 lucide、无 `unpkg.com` 运行时依赖

## 创建 D1 数据库

可以用 Wrangler 创建：

```powershell
npx wrangler d1 create elcs
```

也可以直接在 Cloudflare Dashboard 创建 D1 数据库，数据库名建议为：

```text
elcs
```

## 创建数据表

远端数据库执行迁移：

```powershell
npm run db:remote
```

本地数据库执行迁移：

```powershell
npm run db:local
```

## 绑定 D1

Cloudflare Pages 项目可以在 Dashboard 中绑定 D1，不需要把 `database_id` 写入仓库。绑定保存在 Pages 项目配置里，后续 Git 自动部署会继续沿用。

1. 打开 Cloudflare Dashboard
2. 进入 **Workers & Pages**
3. 选择 Pages 项目 `elcs`
4. 打开 **Settings** / **Functions** / **D1 database bindings**
5. 添加 D1 database binding
6. Variable name 填 `DB`
7. 选择你的 D1 数据库，例如 `elcs`
8. 保存后重新部署 Pages

绑定名必须是 `DB`，因为 API 代码使用的是 `env.DB`。

## 部署

部署前可以先做 dry run：

```powershell
npm run deploy:dry
```

正式部署：

```powershell
npm run deploy
```

Cloudflare Pages Git 构建建议配置：

```text
Framework preset: None
Build command: npm test
Build output directory: public
Root directory: /
```

Pages Functions 位于 `functions/api/[[path]].js`，会自动处理 `/api/*` 请求。

## 首次使用

1. 打开 Pages URL
2. 使用 `admin` / `password` 登录
3. 按页面要求修改初始密码
4. 录入电表初始读数
5. 录入燃气表初始读数
6. 进入设置页
7. 填写结构化地址和彩云天气 API 密钥
8. 保存设置
9. 如果结构化地址无法解析经纬度，点击“使用当前位置”或手动填写经纬度并保存
10. 点击“更新天气”查看未来 7 天预测

## 彩云天气 Token

彩云天气 token 不应写入仓库、README 或提交记录。推荐在页面设置中填写，后端会保存到 D1，并且 `/api/state` 只返回掩码和 `hasCaiyunApiKey`。

彩云 API 使用经纬度顺序：

```text
longitude,latitude
```

本项目的 Pages Function 会在后端调用彩云天气，浏览器不会收到明文 token。

## 常用命令

```powershell
npm test          # 运行测试
npm run dev       # 本地开发
npm run deploy:dry # 创建 Pages 预览部署
npm run deploy    # 部署到 Cloudflare Pages
npm run db:local  # 本地 D1 迁移
npm run db:remote # 远端 D1 迁移
```

## 常见问题

### 页面能打开，但接口提示 `D1 database binding DB is missing`

Cloudflare Pages 项目还没有绑定 D1，或者绑定名不是 `DB`。去 Pages 项目的 **Settings / Functions / D1 database bindings** 添加 D1 database，变量名必须是 `DB`。

### 页面能打开，但接口 500

通常是远端 D1 还没有建表，执行：

```powershell
npm run db:remote
```

### 无法根据结构化地址获取经纬度

这是地址解析服务可能无法识别中文门牌地址导致的。进入设置页，使用以下任一方式保存坐标：

- 点击“使用当前位置”
- 手动填写纬度和经度后点击“保存经纬度”

保存坐标后，彩云天气预测即可使用。

### 忘记修改后的管理员密码

认证信息保存在 D1 的 `settings` 表中，key 为 `auth`。确认要重置时，可以在 D1 中删除该 key，下一次登录会恢复默认初始化流程：

```sql
DELETE FROM settings WHERE key = 'auth';
```

重置后请立即用 `admin` / `password` 登录并修改密码。
