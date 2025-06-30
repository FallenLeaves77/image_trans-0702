# 图片文本翻译工具

![版本](https://img.shields.io/badge/版本-1.0.0-blue)
![协议](https://img.shields.io/badge/协议-MIT-green)

一个功能强大的图片文本翻译工具，可以自动识别图片中的文字，并将其翻译成指定语言，支持多种语言互译，特别优化了中英文翻译效果和各种复杂图表的处理。

## 🌟 功能特点

- **高精度OCR识别**：采用双引擎模式，集成百度智能云OCR和PaddleOCR，确保高识别率
- **多语言支持**：支持中文、英文、日文、韩文等多种语言的互译
- **智能排版**：自动识别文本布局，保持原始排版样式，支持竖排文本
- **背景智能适配**：自动检测并匹配原始图片背景色，让翻译文本融入原图
- **流程图优化**：特别优化了对流程图、架构图等专业图表的处理
- **深色模式支持**：针对深色背景图片进行特殊处理，确保文字清晰可见
- **字体智能调整**：根据文本长度和区域大小自动调整字体大小，提供最佳阅读体验
- **本地处理**：支持完全本地化部署，保护隐私数据

## 🛠️ 技术架构

### 前端

- React.js框架构建的现代化UI
- Ant Design组件库提供美观的用户界面
- Axios处理HTTP请求
- 文件上传与预览功能

### 后端

- Node.js + Express提供RESTful API
- 多引擎OCR识别（百度智能云OCR + PaddleOCR）
- Canvas进行图像处理和文字渲染
- 多种翻译引擎支持（百度翻译API + Google翻译）

## 📋 系统要求

- Node.js 14.0+
- Python 3.7+ (用于PaddleOCR)
- 64位操作系统（Windows/macOS/Linux）

## 🚀 快速开始

### 安装

1. 克隆仓库
```bash
git clone https://github.com/你的用户名/image-translator.git
cd image-translator
```

2. 安装依赖
```bash
# 安装所有依赖(后端和前端)
npm run install:all

# 或者分别安装
npm run install:backend
npm run install:frontend
```

3. 安装PaddleOCR（可选，但推荐）
```bash
npm run install:paddleocr
```

或手动安装PaddleOCR：

```bash
# 安装PaddlePaddle (CPU版本)
pip install paddlepaddle

# 安装PaddleOCR
pip install paddleocr

# Windows系统可能还需要安装以下依赖
pip install shapely pyclipper
```

### 配置

1. 在`backend`目录创建`.env`文件：

```
# 服务器配置
PORT=3001

# 百度智能云OCR配置（可选）
BAIDU_APP_ID=你的应用ID
BAIDU_API_KEY=你的API密钥
BAIDU_SECRET_KEY=你的密钥

# 百度翻译API配置（可选）
BAIDU_TRANSLATE_APP_ID=你的翻译APP ID
BAIDU_TRANSLATE_KEY=你的翻译密钥
```

> 注意：如果不配置百度API，系统将自动使用本地的PaddleOCR进行文字识别和Google翻译API进行翻译。

### 启动应用

1. 启动后端服务
```bash
cd backend
npm start
```

2. 启动前端服务（在另一个终端）
```bash
cd frontend
npm start
```

3. 访问应用：打开浏览器，访问 http://localhost:3000

## 📷 使用方法

1. 进入应用首页，点击上传图片或拖拽图片到指定区域
2. 选择源语言和目标语言
3. 点击"翻译"按钮开始处理
4. 等待处理完成后，可以查看和下载翻译结果

## 🌈 特色功能

### 竖排文本处理

本工具特别优化了对竖排文本的处理能力，可以智能识别竖排文本并保持竖排格式进行翻译和渲染，特别适合处理包含日文、中文竖排文本的图片。

### 流程图翻译

针对流程图、架构图等专业图表进行了特殊优化，能够准确识别图表中的文本并保持原有布局进行翻译，保证专业图表的可读性和美观性。

### 深色背景优化

自动检测图片背景色调，对深色背景和浅色背景分别采用不同的渲染策略，确保在任何背景下文字都清晰可见。

### 智能字体调整

根据文本长度、区域大小和文本重要性，自动调整字体大小、粗细和描边效果，提供最佳阅读体验。

