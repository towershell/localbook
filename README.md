# 📒 LocalBook

LocalBook 是一个纯前端、零依赖的本地工具。所有数据存储在浏览器 `localStorage` 中，无需注册账号、无需后端服务器。

在线地址：**[https://readchild.cloud/localbook/](https://readchild.cloud/localbook/)**

## 功能

| 功能 | 说明 |
|---|---|
| 登录 / 注册 | SHA-256 哈希认证，支持多用户 |
| 密码管理 | 新增、编辑、查看（解密）、删除各平台密码 |
| AES 加密 | AES-256-GCM + PBKDF2（10 万次迭代），加密令牌验证 |
| 数据迁移 | 导出 / 导入 JSON 文件，跨浏览器迁移 |
| 备忘录 | 日历视图、每日记录、农历日期显示 |
| 便签 | 彩色卡片便签，支持标题、7 种颜色、自由记录 |
| 联系人管理 | 姓名、昵称、手机、座机、邮箱、地址、年龄、性别、备注 |
| 联系人搜索 | 按姓名、昵称、手机等关键字搜索 |
| 记住密码 | 登录页可选记住用户名和密码 |
| 会话保持 | 刷新页面自动恢复登录 |
| 响应式 | 适配电脑和手机屏幕 |
| PWA | 支持添加到主屏幕，离线可访问 |

## 快速开始

### 电脑端

双击 `index.html` 在浏览器打开即可。

### 手机端（在线访问）

打开手机浏览器访问：

```
https://readchild.cloud/localbook/
```

#### Chrome（推荐）

1. 打开网址
2. 底部弹出「添加到主屏幕」提示 → 点确认
3. 或右上角菜单 → **添加到主屏幕**
4. 桌面出现 📒 图标，打开后全屏无地址栏

#### 小米浏览器

1. 打开网址
2. 底部菜单按钮（≡）→ **添加到桌面**
3. 桌面出现快捷图标（地址栏仍在）

> 小米浏览器不支持 PWA 全屏安装，推荐使用 Chrome 获得最佳体验。

#### iPhone / iPad Safari

1. 打开网址
2. 底部分享按钮（📤）
3. 向下滑动 → **添加到主屏幕**
4. 右上角「添加」

### 手机端（同一 Wi-Fi）

项目目录启动一个静态文件服务器：

```bash
# 方式一：Node.js（推荐）
npx serve .

# 方式二：Python 3
python -m http.server 8080

# 方式三：Python 2
python -m SimpleHTTPServer 8080
```

启动后手机浏览器访问 `http://电脑IP:端口`（电脑 IP 用 `ipconfig` 或 `ifconfig` 查看）。

## 使用流程

1. **注册** — 设置用户名 + 登录密码 + 加密令牌（Token），令牌用于加密存储的密码
2. **登录** — 输入用户名和密码
3. **密码管理** — 点击「新增密码」，输入名称/地址/用户名/密码，验证令牌后 AES 加密存储
4. **编辑密码** — 点击「编辑」修改名称和密码，需重新验证令牌
5. **查看密码** — 点击「解密」，输入令牌查看明文
6. **备忘录** — 切到「备忘录」tab，点击日历日期记录每日事项
7. **便签** — 切到「便签」tab，新增彩色便签自由记录
8. **联系人** — 切到「联系人」tab，管理通讯录，支持搜索
9. **备份** — 定期点击「导出」下载 JSON 文件；导入请在登录页操作

## 数据存储

所有数据位于浏览器的 `localStorage`，键名 `pbook_data`。

| 数据类型 | 是否加密 |
|---|---|
| 登录密码 | SHA-256 哈希 |
| 加密令牌 | SHA-256 哈希 |
| 存储密码 | AES-256-GCM 加密 |
| 备忘录 | 明文 |
| 便签 | 明文 |
| 联系人 | 明文 |

> 不同浏览器之间数据相互隔离。迁移数据请走「导出 → 导入」流程。

## 技术栈

- 原生 HTML + CSS + JavaScript
- Web Crypto API（AES-256-GCM, PBKDF2, SHA-256）
- Service Worker（离线缓存）
- 零依赖、零构建、离线运行

## 部署

项目为纯静态文件，可部署到任意 Web 服务器。

```bash
# 使用 pm2 + serve 长期运行
npm i -g serve pm2
pm2 start serve --name localbook -- . -p 8080
pm2 save
pm2 startup
```

**静态托管：** Vercel（`npx vercel --prod`）、Netlify、GitHub Pages 等均可。

## 文件结构

```
LocalBook/
├── index.html          # 主页面
├── sw.js               # Service Worker（离线缓存 / PWA）
├── manifest.json       # PWA 清单
├── icon.svg            # PWA 图标 / favicon
├── version.json        # 版本信息
├── README.md           # 使用手册
├── doc/
│   ├── 需求文档.md     # 需求文档
│   └── tools/
│       ├── gen-icon.html   # 图标生成工具（浏览器打开）
│       └── gen-icon.sh     # 图标生成工具（ImageMagick）
├── css/
│   └── style.css       # 样式
└── js/
    └── app.js          # 全部逻辑
```

## 版本

当前版本 `v1.3.0`
