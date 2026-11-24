# 宝可梦图鉴扫描器 · Pokédex Scanner

给孩子用的宝可梦图鉴：用 iPad 或手机的摄像头**实时扫描**宝可梦卡片，自动认出是哪只宝可梦，
然后像动画片里的图鉴一样显示并**朗读**它的介绍。支持 **中文 / English / 日本語** 三种语言。

A kid-friendly Pokédex web app: point an iPad or phone camera at a Pokémon card, it recognises the
Pokémon live and shows (and reads aloud) its Pokédex entry in Chinese, English or Japanese.

## 功能

- **实时扫描**：打开摄像头，把卡片放进框里，名字对准黄色虚线框，大约 1–2 秒自动识别（不用拍照上传）。
- **完全在设备上识别**：用 Tesseract.js 读卡片上的名字，再和 1025 只宝可梦的中/英/日名字做模糊匹配。不需要账号、不需要网络服务。
- **图鉴内容**：编号、名字（三种语言）、分类、属性、图鉴介绍、身高体重、特性（含说明）、能力值、进化链。
- **语音朗读**：识别出来后会像动画里一样念出介绍（用系统自带的语音）。
- **收集记录**：扫过的宝可梦会记为“已发现”，孩子可以看自己收集了多少只。
- **训练家卡 / 能量卡**：会提示“这不是宝可梦哦”。
- **图鉴浏览**：可以按名字或编号搜索全部 1025 只；方向键可以前后翻看。
- **可选 AI 识别**：在设置里填入 Claude API key 后，按左下角的黑色大按钮会把卡片照片交给 Claude 识别（对反光卡、金卡、日文/中文卡更准）。key 只存在这台设备上。

## 使用方法

1. 用 Safari（iPad / iPhone）或 Chrome（Android）打开网址。摄像头只能在 **https** 网址上使用。
2. 点「开始扫描」，允许使用相机。
3. 把卡片放进框里，卡片名字对准上方的黄色虚线框。识别成功会“叮”一声并闪光。
4. 换一张卡就会自动识别新的；也可以点「再扫一张」。
5. 右下角的蓝色按钮：切换 中文 / EN / 日本語、朗读、图鉴、设置。
6. 小技巧：在 Safari 里点「分享 → 添加到主屏幕」，就能像 App 一样全屏打开。

**设置 → 卡片的语言**：选卡片上印的文字（English / 日本語 / 简体中文 / 繁體中文）。
默认是 English。这和界面显示语言是分开的——可以扫英文卡、看中文介绍。

## 部署（GitHub Pages）

仓库里已经有 `.github/workflows/deploy.yml`。合并到 `main` 后：

1. GitHub 仓库 → **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
2. 每次推送到 `main` 会自动测试、构建、发布。网址是 `https://<用户名>.github.io/pokedex/`。

## 开发

```bash
npm install        # 同时把 OCR 引擎文件复制到 public/ocr
npm run dev        # 本地开发（手机测试需要 https，可以用 npm run build && 部署后测试）
npm test           # 名字匹配的单元测试
npm run build      # 生成 dist/
npm run data       # 重新从 PokeAPI 生成 public/data/pokedex.json
```

项目结构：

| 文件 | 作用 |
|---|---|
| `src/main.ts` | 界面、扫描循环、显示图鉴 |
| `src/camera.ts` | 后置摄像头、截取取景框里的画面 |
| `src/ocr.ts` | Tesseract.js 文字识别（文件都由本站提供，不依赖 CDN） |
| `src/match.ts` | OCR 文字 → 宝可梦名字的模糊匹配、多帧投票 |
| `src/ai.ts` | 可选的 Claude 图像识别 |
| `src/speech.ts`, `src/sound.ts` | 语音朗读、提示音 |
| `scripts/build-data.mjs` | 从 PokeAPI 开放数据生成图鉴数据 |

## 识别原理

每 ~0.25 秒截取取景框顶部（卡片名字所在的位置）→ 灰度化 → 轮流以 0°/+5°/−5° 校正倾斜 →
Tesseract 稀疏文本模式识别 → 与所有宝可梦名字做编辑距离匹配（字越大的行权重越高，"Evolves from …" 降权）→
连续几帧结果一致才确认，避免误判。

## 说明

非官方的个人粉丝作品，仅供家庭使用。Pokémon 及相关名称归 Nintendo / Creatures / GAME FREAK /
The Pokémon Company 所有。图鉴数据和图片来自 [PokeAPI](https://pokeapi.co/)。
