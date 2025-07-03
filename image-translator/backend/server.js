/**
 * 图片文本翻译服务器
 * 
 * ===== 百度API配置说明 =====
 * 1. 百度智能云OCR API: 访问 https://cloud.baidu.com/product/ocr 注册并创建应用
 *    - 获取BAIDU_APP_ID, BAIDU_API_KEY 和 BAIDU_SECRET_KEY
 * 
 * 2. 创建 .env 文件在后端根目录，配置以下内容:
 *    ```
 *    BAIDU_APP_ID=119352969
 *    BAIDU_API_KEY=yrWwaxSLv8JyrUBJxYmsSVKP
 *    BAIDU_SECRET_KEY=14j1Q2uDRxmUjIrnwxR1W1T74o6FWlkN
 *    DEEPSEEK_API_KEY=sk-4d5297ac14d34747bc366cdcab4e00ac
 *    PORT=3001
 *    ```
 * 
 * 3. 如不配置百度API，系统将自动使用本地的PaddleOCR备选方案
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
// const Tesseract = require('tesseract.js'); // 移除Tesseract
const Jimp = require('jimp');
const { createCanvas, registerFont, loadImage } = require('canvas');
const dotenv = require('dotenv');
const translate = require('@vitalets/google-translate-api').translate;
// 引入百度智能云SDK
const AipOcrClient = require('baidu-aip-sdk').ocr;
const axios = require('axios');
// 引入Deepseek API客户端
const { DeepseekClient } = require('./deepseek');

// 加载环境变量
dotenv.config();

// 手动设置环境变量（如果.env文件不存在或不完整）
if (!process.env.DEEPSEEK_API_KEY) {
  console.log('未检测到DEEPSEEK_API_KEY环境变量，正在手动设置...');
  process.env.DEEPSEEK_API_KEY = 'sk-4d5297ac14d34747bc366cdcab4e00ac';
}

// 注册中文字体
const fontPath = path.join(__dirname, 'fonts', 'SimHei.otf');
if (fs.existsSync(fontPath)) {
  try {
    registerFont(fontPath, { family: 'SimHei' });
    console.log('成功注册字体: SimHei.otf');
  } catch(e) {
    console.error('注册字体失败:', e);
  }
} else {
  console.warn(`警告: 未找到字体文件于 ${fontPath}, 中文渲染可能显示为方块。`);
}

// 设置百度API参数 - 实际应用中应从环境变量或配置文件中读取
// 这里使用PaddleOCR作为备用选项，避免API错误阻塞功能
const BAIDU_APP_ID = process.env.BAIDU_APP_ID || '';
const BAIDU_API_KEY = process.env.BAIDU_API_KEY || '';
const BAIDU_SECRET_KEY = process.env.BAIDU_SECRET_KEY || '';

// 设置Deepseek API密钥
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// PaddleOCR模型路径配置
const PADDLE_OCR_MODEL_DIR = path.join(__dirname, 'paddle_models');
const PADDLE_OCR_LANG_DIR = path.join(__dirname, 'lang-data');

// 所有API密钥将从.env文件读取，不再支持动态配置

// 创建百度OCR和翻译客户端实例
let baiduOcrClient = null;
// 创建Deepseek客户端实例
let deepseekClient = null;

// 仅在配置了API密钥的情况下初始化百度客户端
if (BAIDU_APP_ID && BAIDU_API_KEY && BAIDU_SECRET_KEY) {
  try {
    console.log('初始化百度OCR客户端...');
    baiduOcrClient = new AipOcrClient(BAIDU_APP_ID, BAIDU_API_KEY, BAIDU_SECRET_KEY);
    console.log('百度OCR客户端初始化成功');
  } catch (error) {
    console.error('百度OCR客户端初始化失败:', error);
    baiduOcrClient = null;
  }
}

// 初始化Deepseek客户端
if (DEEPSEEK_API_KEY) {
  try {
    console.log('初始化Deepseek客户端...');
    deepseekClient = new DeepseekClient(DEEPSEEK_API_KEY);
    console.log('Deepseek客户端初始化成功');
  } catch (error) {
    console.error('Deepseek客户端初始化失败:', error);
    deepseekClient = null;
  }
}

// 获取百度OCR客户端
function getBaiduOcrClient() {
  if (baiduOcrClient) {
    return baiduOcrClient;
  }
  
  // 尝试从环境变量初始化客户端
  if (process.env.BAIDU_APP_ID && process.env.BAIDU_API_KEY && process.env.BAIDU_SECRET_KEY) {
    console.log('从环境变量初始化OCR客户端');
    baiduOcrClient = new AipOcrClient(process.env.BAIDU_APP_ID, process.env.BAIDU_API_KEY, process.env.BAIDU_SECRET_KEY);
    return baiduOcrClient;
  }
  
  console.log('没有找到有效的百度OCR凭证，请在.env文件中配置');
  return null;
}

// 获取Deepseek客户端
function getDeepseekClient() {
  if (deepseekClient) {
    return deepseekClient;
  }
  
  // 尝试从环境变量初始化客户端
  if (process.env.DEEPSEEK_API_KEY) {
    console.log('从环境变量初始化Deepseek客户端');
    deepseekClient = new DeepseekClient(process.env.DEEPSEEK_API_KEY);
    return deepseekClient;
  }
  
  console.log('没有找到有效的Deepseek凭证，请在.env文件中配置');
  return null;
}

// 设置百度API参数
const baiduOcrOptions = {
  detect_direction: "true",  // 检测文字方向
  probability: "true",       // 返回识别结果中每一行的置信度
  detect_language: "true",   // 检测语言
  paragraph: "true",         // 段落检测
  vertexes_location: "true", // 获取文本框顶点位置
  recognize_granularity: "small" // 定位单字符位置
};

const app = express();
const PORT = process.env.PORT || 5000;

// 配置跨域和请求体解析
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 中间件
app.use(express.static('public'));

// 静态文件服务 - 让前端可以访问'results'目录下的图片
app.use('/results', express.static(path.join(__dirname, 'results')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 为了兼容性保留原有的路由
app.use('/api/images', express.static(path.join(__dirname, 'uploads')));
app.use('/api/images/results', express.static(path.join(__dirname, 'results')));

// 后端状态接口
app.get('/status', (req, res) => {
  res.json({ status: 'ok' });
});

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 确保上传目录存在
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 限制10MB
  fileFilter: (req, file, cb) => {
    // 只允许图片格式
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片文件！'));
    }
  }
});

// 创建结果目录
const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// 翻译缓存 - 提高性能
const translationCache = new Map();

// PaddleOCR文本识别函数
async function recognizeTextByPaddle(imagePath, languageType = 'auto') {
  console.log('使用PaddleOCR进行文本识别...');
  
  try {
    // 确保PaddleOCR模型目录存在
    if (!fs.existsSync(PADDLE_OCR_MODEL_DIR)) {
      fs.mkdirSync(PADDLE_OCR_MODEL_DIR, { recursive: true });
    }
    
    // 将languageType映射到PaddleOCR支持的语言代码
    let paddleLang = 'ch'; // 默认使用中文模型
    
    switch(languageType.toLowerCase()) {
      case 'eng':
      case 'english':
        paddleLang = 'en';
        break;
      case 'chi_sim':
      case 'chinese':
        paddleLang = 'ch';
        break;
      case 'jpn':
      case 'japanese':
        paddleLang = 'japan';
        break;
      case 'kor':
      case 'korean':
        paddleLang = 'korean';
        break;
      default:
        // 自动检测，使用多语言模型
        paddleLang = 'ch'; // PaddleOCR的通用模型也支持英文
        break;
    }
    
    // 检查是否存在PaddleOCR检测结果的缓存文件
    const paddleCacheFile = `${imagePath}_paddle_${paddleLang}.json`;
    
    if (fs.existsSync(paddleCacheFile)) {
      console.log('发现PaddleOCR缓存结果，直接使用');
      const cacheData = JSON.parse(fs.readFileSync(paddleCacheFile, 'utf8'));
      return {
        success: true,
        textRegions: cacheData.textRegions,
        ocrEngine: 'paddle',
        languageType: languageType
      };
    }
    
    // 创建临时JSON文件来存储结果
    const outputJsonPath = `${imagePath}_result.json`;
    
    // 使用Python的PaddleOCR脚本执行OCR
    // 注意：这里假设已经安装了Python和PaddleOCR相关依赖
    // pip install paddlepaddle paddleocr
    const cmd = `python -c "
import json
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang='${paddleLang}')
result = ocr.ocr('${imagePath.replace(/\\/g, '\\\\')}', cls=True)
output = []
for line in result:
    for bbox, text in line:
        top_left = bbox[0]
        bottom_right = bbox[2]
        width = bottom_right[0] - top_left[0]
        height = bottom_right[1] - top_left[1]
        confidence = text[1]
        output.append({
            'text': text[0],
            'x': int(top_left[0]),
            'y': int(top_left[1]),
            'width': int(width),
            'height': int(height),
            'confidence': float(confidence) * 100,
            'translated': '',
            'translateSource': ''
        })
with open('${outputJsonPath.replace(/\\/g, '\\\\')}', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False)
"`;
    
    try {
      // 执行PaddleOCR命令
      console.log('执行PaddleOCR命令...');
      await execPromise(cmd);
      
      // 检查结果文件是否生成
      if (!fs.existsSync(outputJsonPath)) {
        throw new Error('PaddleOCR未生成结果文件');
      }
      
      // 读取OCR结果
      const ocrResultJson = fs.readFileSync(outputJsonPath, 'utf8');
      const textRegions = JSON.parse(ocrResultJson);
      
      console.log(`PaddleOCR识别到${textRegions.length}个文本区域`);
      
      // 过滤可能的低质量结果
      const filteredRegions = textRegions.filter(region => {
        // 过滤空文本
        if (!region.text || region.text.trim() === '') {
          return false;
        }
        
        // 过滤太小的文本区域
        if (region.width < 5 || region.height < 5) {
          console.log(`过滤太小区域: ${region.text} (${region.width}x${region.height})`);
          return false;
        }
        
        // 过滤低置信度结果
        if (region.confidence < 60) {
          console.log(`过滤低可信度区域: ${region.text} (${region.confidence.toFixed(1)})`);
          return false;
        }
        
        return true;
      });
      
      console.log(`过滤后保留${filteredRegions.length}个有效文本区域`);
      
      // 缓存结果以备再次使用
      fs.writeFileSync(paddleCacheFile, JSON.stringify({
        textRegions: filteredRegions
      }));
      
      // 清理临时文件
      if (fs.existsSync(outputJsonPath)) {
        fs.unlinkSync(outputJsonPath);
      }
      
      return {
        success: true,
        textRegions: filteredRegions,
        ocrEngine: 'paddle',
        languageType: languageType
      };
      
    } catch (error) {
      console.error('PaddleOCR执行错误:', error);
      
      // 尝试使用备用的简易模式，直接调用命令行
      console.log('尝试使用备用方法...');
      
      // 使用备用获取方式
      return {
        success: false,
        textRegions: [],
        ocrEngine: 'paddle',
        error: error.message
      };
    }
  } catch (error) {
    console.error('PaddleOCR识别失败:', error);
    throw error;
  }
}

// 百度OCR文本识别函数
async function recognizeTextByBaidu(imagePath, options = {}) {
  const { languageType = 'auto', ocrApiVersion = 'accurate' } = options;

  console.log(`使用百度智能云OCR进行文本识别 (版本: ${ocrApiVersion}, 语言: ${languageType})...`);
  
  // 获取客户端实例
  const client = getBaiduOcrClient();
  
      if (!client) {
      console.log('未配置百度OCR客户端，跳过百度OCR识别');
      return { 
        success: false, 
        message: '未配置百度OCR客户端，请在.env文件中配置API密钥', 
        textRegions: [] 
      };
    }

  try {
    // 读取图片内容
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    
    // 动态构建请求选项
    const requestOptions = { ...baiduOcrOptions };
    
    // 语言代码映射
    const baiduLangMap = {
      'eng': 'ENG',
      'chi_sim': 'CHN_ENG',
      'chi_tra': 'CHN_ENG',
      'jpn': 'JAP',
      'kor': 'KOR'
    };

    // 'general' 和 'general_basic' API 支持 'language_type'
    // 'accurate' 和 'accurate_basic' API 不支持
    if (ocrApiVersion === 'general' || ocrApiVersion === 'general_basic') {
      if (languageType !== 'auto' && baiduLangMap[languageType]) {
        requestOptions.language_type = baiduLangMap[languageType];
        // 如果指定了语言，则关闭自动语言检测
        requestOptions.detect_language = 'false';
      } else {
        // 如果是"自动"，则依赖 detect_language: true (默认)，并且必须删除 language_type
        delete requestOptions.language_type;
      }
    } else {
      // 对于高精度版本，不支持 language_type，确保移除
      delete requestOptions.language_type;
    }
    
    console.log(`调用百度OCR API (版本: ${ocrApiVersion}) 使用选项:`, requestOptions);

    let result;
    switch (ocrApiVersion) {
      case 'general':
        result = await client.general(base64Image, requestOptions);
        break;
      case 'general_basic':
        result = await client.generalBasic(base64Image, requestOptions);
        break;
      case 'accurate':
        result = await client.accurate(base64Image, requestOptions);
        break;
      case 'accurate_basic':
      default: // 默认使用高精度基础版
        result = await client.accurateBasic(base64Image, requestOptions);
        break;
    }
    
    console.log(`百度OCR接口返回结果: ${result && result.words_result ? result.words_result.length : 0} 个文本区域`);
    
    if (result && result.error_code) {
      console.error('百度OCR接口返回错误:', result.error_code, result.error_msg);
      return { 
        success: false, 
        message: `百度OCR错误: ${result.error_msg || '未知错误'}`,
        errorCode: result.error_code,
        textRegions: []
      };
    }
    
    // 处理识别结果
    if (result && result.words_result && result.words_result.length > 0) {
      // 转换为标准格式，优先使用vertexes_location计算精确边界
      const textRegions = result.words_result.map((word, index) => {
        let location;
        // 如果提供了顶点坐标，则用它计算最精确的边界框
        if (word.vertexes_location && Array.isArray(word.vertexes_location) && word.vertexes_location.length === 4) {
          const xCoords = word.vertexes_location.map(v => v.x);
          const yCoords = word.vertexes_location.map(v => v.y);
          const minX = Math.min(...xCoords);
          const minY = Math.min(...yCoords);
          const maxX = Math.max(...xCoords);
          const maxY = Math.max(...yCoords);
          location = {
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY
          };
        } else {
          // 否则，回退到使用标准的矩形位置
          location = word.location || { left: 0, top: 0, width: 100, height: 30 };
        }

        return {
          text: word.words,
          x: location.left,
          y: location.top,
          width: location.width,
          height: location.height,
          confidence: (word.probability && word.probability.average) ? word.probability.average * 100 : 90,
          translated: '', // 待翻译
          translateSource: ''
        };
      });
      
      return {
        success: true,
        textRegions,
        messageId: result.log_id
      };
    } else {
      return {
        success: false,
        textRegions: [],
        message: '未识别到文本'
      };
    }
  } catch (error) {
    console.error('百度OCR识别出错:', error);
    return {
      success: false,
      message: `百度OCR识别出错: ${error.message}`,
      error,
      textRegions: []
    };
  }
}

// 更新betterTranslate函数，移除本地映射查找，只使用Deepseek
async function betterTranslate(text, targetLang = 'zh-CN') {
  // 检查缓存
  const cacheKey = `${text}_${targetLang}`;
  if (translationCache.has(cacheKey)) {
    console.log(`[缓存命中] ${text}`);
    // 返回翻译结果和来源信息
    return { 
      text: translationCache.get(cacheKey),
      source: 'cache'
    };
  }
  
  // 预处理文本 - 移除多余空格并规范化
  const cleanText = text.trim().replace(/\\s+/g, ' ');
  if (!cleanText) return { text: '', source: 'empty' };
  
  try {
    console.log(`翻译: "${cleanText}" => 目标语言: ${targetLang}`);
    
    // 处理不同的目标语言代码
    let apiTargetLang = targetLang;
    if (targetLang === 'chi_sim' || targetLang === 'zh') {
      apiTargetLang = 'zh';
    } else if (targetLang === 'eng') {
      apiTargetLang = 'en';
    }
    
    try {
      // 使用Deepseek进行翻译
      const deepseekResult = await translateByDeepseek(cleanText, apiTargetLang);
      
      if (deepseekResult && deepseekResult.text) {
        console.log(`Deepseek翻译结果: "${deepseekResult.text}"`);
        translationCache.set(cacheKey, deepseekResult.text);
        return {
          text: deepseekResult.text,
          source: 'deepseek'
        };
      }
    } catch (deepseekErr) {
      console.warn('Deepseek翻译失败，返回原文:', deepseekErr);
      // 如果Deepseek翻译失败，返回原文
      return { 
        text: cleanText,
        source: 'original'
      };
    }

    // 若到达此处，表示翻译失败，返回原文
    return { 
      text: cleanText,
      source: 'original'
    };
  } catch (err) {
    console.error('翻译处理失败，返回原文:', err);
    return { 
      text: cleanText,
      source: 'error'
    };
  }
}

// 修改Deepseek翻译函数
async function translateByDeepseek(text, targetLang = 'zh') {
  if (!text || text.trim() === '') {
    return { success: false, text: '', message: '空文本无需翻译' };
  }
  
  console.log(`使用Deepseek翻译: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
  
  // 获取Deepseek客户端
  const client = getDeepseekClient();
  
  if (!client) {
    console.log('未配置Deepseek API，返回原文');
    return { success: false, text, message: '未配置Deepseek API' };
  }
  
  const cacheKey = `deepseek_${text}_${targetLang}`;
  
  // 检查缓存
  if (translationCache.has(cacheKey)) {
    return {
      text: translationCache.get(cacheKey),
      source: 'cache'
    };
  }

  try {
    // 准备提示词
    let prompt = '仅输出中文，不要输出任何其他内容，不要输出解释、说明、标题、引言或结语';
    if (targetLang === 'zh') {
      prompt = `直接翻译：${text}\n\n仅输出中文翻译结果，不要输出任何其他内容，不要输出解释、说明、标题、引言或结语。`;
    } else if (targetLang === 'en') {
      prompt = `Direct translation: ${text}\n\nOutput only the English translation, without any explanations, notes, titles, introduction or conclusion.`;
    } else if (targetLang === 'jp') {
      prompt = `Direct translation: ${text}\n\nOutput only the Japanese translation, without any explanations, notes, titles, introduction or conclusion.`;
    } else if (targetLang === 'kor') {
      prompt = `Direct translation: ${text}\n\nOutput only the Korean translation, without any explanations, notes, titles, introduction or conclusion.`;
    } else {
      // 默认使用英文提示，要求翻译到目标语言
      prompt = `Direct translation: ${text}\n\nOutput only the ${targetLang} translation, without any explanations, notes, titles, introduction or conclusion.`;
    }
    
    // 调用Deepseek API
    let translatedText = await client.translate(prompt);
    
    // 清理翻译结果，移除可能的说明文字
    translatedText = cleanTranslationResult(translatedText, text);
    
    // 缓存结果
    translationCache.set(cacheKey, translatedText);
    
    return {
      text: translatedText,
      source: 'deepseek'
    };
  } catch (error) {
    console.error('Deepseek翻译API错误:', error);
    return { text, source: 'original' }; // 翻译失败时返回原文
  }
}

/**
 * 清理翻译结果，移除可能的说明文字
 * @param {string} result - API返回的翻译结果
 * @param {string} originalText - 原始文本
 * @returns {string} 清理后的翻译结果
 */
function cleanTranslationResult(result, originalText) {
  if (!result) return originalText;
  
  // 移除可能的标题和说明
  let cleaned = result;
  
  // 删除"翻译结果："等前缀
  cleaned = cleaned.replace(/^(翻译结果[：:]\s*|Translation[：:]\s*|以下是[^]*?的翻译[：:]\s*)/i, '');
  
  // 删除可能存在的任务说明和规则说明部分
  cleaned = cleaned.replace(/【[^】]*?翻译任务[^】]*?】[^]*?【/g, '【');
  cleaned = cleaned.replace(/【[^】]*?处理原则[^】]*?】[^]*/g, '');
  
  // 删除多余的换行和空格
  cleaned = cleaned.trim();
  
  // 如果清理后文本为空，返回原文
  if (!cleaned) {
    return originalText;
  }
  
  return cleaned;
}

// 将翻译后的文字渲染到图片上 - 包含自适应文本框功能
async function renderTranslatedText(imagePath, textRegions) {
  try {
    console.log('开始渲染覆盖式翻译文本...');
    // 添加调试信息，显示要渲染的翻译结果
    console.log(`准备渲染${textRegions.length}个文本区域的翻译结果`);
    textRegions.forEach((region, index) => {
      console.log(`区域${index+1}：原文="${region.text}" 翻译="${region.translated || '无翻译'}" 来源=${region.translateSource || '未知'}`);
    });

    const image = await loadImage(imagePath);
    const jimpImage = await Jimp.read(imagePath); // 用于拾取颜色
    const { width, height } = image;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. 将原始图片绘制到底层
    ctx.drawImage(image, 0, 0, width, height);

    let processedCount = 0;
    let skippedCount = 0;
    const padding = 1; // 减小边框，更加贴近原文字区域

    // 预先分析图像中的主要颜色和背景特征
    // 这有助于保持背景颜色一致性
    const globalBackgroundSamples = [];
    
    // 随机采样全图的一些点作为全局背景参考
    const sampleCount = 50;
    for (let i = 0; i < sampleCount; i++) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);
      const color = jimpImage.getPixelColor(x, y);
      globalBackgroundSamples.push(Jimp.intToRGBA(color));
    }
    
    // 分析全局背景颜色特征
    let avgGlobalR = 0, avgGlobalG = 0, avgGlobalB = 0;
    globalBackgroundSamples.forEach(sample => {
      avgGlobalR += sample.r;
      avgGlobalG += sample.g;
      avgGlobalB += sample.b;
    });
    
    avgGlobalR = Math.round(avgGlobalR / globalBackgroundSamples.length);
    avgGlobalG = Math.round(avgGlobalG / globalBackgroundSamples.length);
    avgGlobalB = Math.round(avgGlobalB / globalBackgroundSamples.length);
    
    // 判断图像整体是否偏亮或偏暗
    const globalLuminance = 0.299 * avgGlobalR + 0.587 * avgGlobalG + 0.114 * avgGlobalB;
    const isLightImage = globalLuminance > 170;
    const isDarkImage = globalLuminance < 85;
    
    for (const region of textRegions) {
      const textToRender = region.translated || region.text;
      if (!textToRender || textToRender.trim() === '') {
        skippedCount++;
        continue;
      }

      // 采样策略改进 - 使用更智能的采样点选择
      const { width: imageWidth, height: imageHeight } = jimpImage.bitmap;
      
      // 多重采样策略
      let samplePoints = [];
      
      // 1. 直接的周围区域采样 - 紧贴文本区域的外围
      const margin = 3; // 边缘距离文本区域的像素数
      
      // 上边缘采样
      if (region.y > margin) {
        for (let i = 0; i < 5; i++) {
          const x = region.x + region.width * (i + 0.5) / 5;
          const y = Math.max(0, region.y - margin);
          if (x >= 0 && x < imageWidth)
            samplePoints.push([Math.floor(x), Math.floor(y)]);
        }
      }
      
      // 下边缘采样
      if (region.y + region.height + margin < imageHeight) {
        for (let i = 0; i < 5; i++) {
          const x = region.x + region.width * (i + 0.5) / 5;
          const y = Math.min(imageHeight - 1, region.y + region.height + margin);
          if (x >= 0 && x < imageWidth)
            samplePoints.push([Math.floor(x), Math.floor(y)]);
        }
      }
      
      // 左边缘采样
      if (region.x > margin) {
        for (let i = 0; i < 5; i++) {
          const x = Math.max(0, region.x - margin);
          const y = region.y + region.height * (i + 0.5) / 5;
          if (y >= 0 && y < imageHeight)
            samplePoints.push([Math.floor(x), Math.floor(y)]);
        }
      }
      
      // 右边缘采样
      if (region.x + region.width + margin < imageWidth) {
        for (let i = 0; i < 5; i++) {
          const x = Math.min(imageWidth - 1, region.x + region.width + margin);
          const y = region.y + region.height * (i + 0.5) / 5;
          if (y >= 0 && y < imageHeight)
            samplePoints.push([Math.floor(x), Math.floor(y)]);
        }
      }
      
      // 2. 扩大区域采样 - 在更大范围内采样
      const expandArea = 15; // 扩大采样范围
      
      // 采样文本框外围更大区域的四角
      const corners = [
        [Math.max(0, region.x - expandArea), Math.max(0, region.y - expandArea)],
        [Math.min(imageWidth - 1, region.x + region.width + expandArea), Math.max(0, region.y - expandArea)],
        [Math.max(0, region.x - expandArea), Math.min(imageHeight - 1, region.y + region.height + expandArea)],
        [Math.min(imageWidth - 1, region.x + region.width + expandArea), Math.min(imageHeight - 1, region.y + region.height + expandArea)]
      ];
      
      samplePoints = [...samplePoints, ...corners];
      
      // 3. 如果采样点不足，增加更多随机采样点
      if (samplePoints.length < 15) {
        for (let i = 0; i < 10; i++) {
          const direction = i % 4; // 0: 上, 1: 右, 2: 下, 3: 左
          let x, y;
          
          switch (direction) {
            case 0: // 上方
              x = region.x + Math.random() * region.width;
              y = Math.max(0, region.y - Math.random() * 20 - 5);
              break;
            case 1: // 右方
              x = Math.min(imageWidth - 1, region.x + region.width + Math.random() * 20 + 5);
              y = region.y + Math.random() * region.height;
              break;
            case 2: // 下方
              x = region.x + Math.random() * region.width;
              y = Math.min(imageHeight - 1, region.y + region.height + Math.random() * 20 + 5);
              break;
            case 3: // 左方
              x = Math.max(0, region.x - Math.random() * 20 - 5);
              y = region.y + Math.random() * region.height;
              break;
          }
          
          samplePoints.push([Math.floor(x), Math.floor(y)]);
        }
      }
      
      // 4. 获取所有采样点的颜色
      const colorSamples = [];
      const seenCoordinates = new Set(); // 避免重复的坐标
      
      for (const [x, y] of samplePoints) {
        const coordKey = `${x},${y}`;
        if (!seenCoordinates.has(coordKey)) {
          seenCoordinates.add(coordKey);
          const color = Jimp.intToRGBA(jimpImage.getPixelColor(x, y));
          colorSamples.push({
            x, y, color
          });
        }
      }
      
      // 5. 分析采样得到的颜色
      // 5.1 统计不同颜色的出现频率
      const colorFrequency = {};
      const quantizeLevel = 8; // 颜色量化级别，数值越小颜色越精确
      
      colorSamples.forEach(sample => {
        // 颜色量化 - 降低颜色精度以便于统计相似颜色
        const r = Math.floor(sample.color.r / quantizeLevel) * quantizeLevel;
        const g = Math.floor(sample.color.g / quantizeLevel) * quantizeLevel;
        const b = Math.floor(sample.color.b / quantizeLevel) * quantizeLevel;
        
        const colorKey = `${r},${g},${b}`;
        
        if (!colorFrequency[colorKey]) {
          colorFrequency[colorKey] = {
            count: 1,
            r: sample.color.r,
            g: sample.color.g,
            b: sample.color.b,
            samples: [sample]
          };
        } else {
          const entry = colorFrequency[colorKey];
          entry.count++;
          entry.r += sample.color.r;
          entry.g += sample.color.g;
          entry.b += sample.color.b;
          entry.samples.push(sample);
        }
      });
      
      // 5.2 排序找出主要颜色
      const colorEntries = Object.values(colorFrequency).map(entry => ({
        ...entry,
        avgR: Math.round(entry.r / entry.count),
        avgG: Math.round(entry.g / entry.count),
        avgB: Math.round(entry.b / entry.count),
        percentage: (entry.count / colorSamples.length) * 100
      }));
      
      colorEntries.sort((a, b) => b.count - a.count);
      
      // 5.3 判断是否有明显的主颜色
      const dominantColor = colorEntries[0];
      const isStrongDominant = dominantColor && dominantColor.percentage > 60;
      
      // 5.4 判断是否是特殊区域 - 如UI元素、文本框等
      // 检测采样点是否形成规则形状 (如矩形边界)
      let isSpecialRegion = false;
      let specialRegionColor = null;
      
      // 检测是否是有框的UI元素 - 通过颜色特征判断
      if (colorEntries.length >= 2) {
        const firstColor = colorEntries[0];
        const secondColor = colorEntries[1];
        
        // 计算两种颜色的差异
        const colorDiff = Math.sqrt(
          Math.pow(firstColor.avgR - secondColor.avgR, 2) +
          Math.pow(firstColor.avgG - secondColor.avgG, 2) +
          Math.pow(firstColor.avgB - secondColor.avgB, 2)
        );
        
        // 检测颜色对比度是否明显 - 可能是UI元素
        if (colorDiff > 30 && firstColor.percentage > 40 && secondColor.percentage > 15) {
          // 判断哪个颜色更可能是背景色
          // 一般情况下，面积更大的更可能是背景色
          isSpecialRegion = true;
          specialRegionColor = {
            r: firstColor.avgR,
            g: firstColor.avgG,
            b: firstColor.avgB
          };
          
          // 分析是否有矩形边框特征
          // 这种情况下我们应该保留整个UI元素的风格
        }
      }
      
      // 6. 智能决定背景色
      let finalColor;
      
      // 6.1 特殊UI元素处理
      if (isSpecialRegion && specialRegionColor) {
        // 对于UI元素，尽量保持其原有颜色
        finalColor = specialRegionColor;
      } 
      // 6.2 有明显主色调
      else if (isStrongDominant) {
        finalColor = {
          r: dominantColor.avgR,
          g: dominantColor.avgG,
          b: dominantColor.avgB
        };
      }
      // 6.3 没有明显主色调 - 使用智能加权平均
      else {
        // 基于位置距离的加权平均
        const centerX = region.x + region.width/2;
        const centerY = region.y + region.height/2;
        let weightSum = 0;
        let weightedR = 0;
        let weightedG = 0;
        let weightedB = 0;
        
        colorSamples.forEach(sample => {
          // 计算到区域中心的距离
          const distance = Math.sqrt(
            Math.pow(sample.x - centerX, 2) + 
            Math.pow(sample.y - centerY, 2)
          );
          
          // 反比距离权重 - 越近权重越大
          const weight = 1 / (1 + distance * 0.1);
          weightSum += weight;
          
          weightedR += sample.color.r * weight;
          weightedG += sample.color.g * weight;
          weightedB += sample.color.b * weight;
        });
        
        // 计算最终加权平均色
        finalColor = {
          r: Math.round(weightedR / weightSum),
          g: Math.round(weightedG / weightSum),
          b: Math.round(weightedB / weightSum)
        };
        
        // 增加对全局背景的考量，防止背景色异常突兀
        // 如果是图表或UI，轻微调整颜色使其更接近于原背景
        const backgroundAdjustFactor = 0.15; // 背景颜色适应因子
        
        // 在保持自身特性的同时，轻微靠近全局背景色
        finalColor.r = Math.round(finalColor.r * (1 - backgroundAdjustFactor) + avgGlobalR * backgroundAdjustFactor);
        finalColor.g = Math.round(finalColor.g * (1 - backgroundAdjustFactor) + avgGlobalG * backgroundAdjustFactor);
        finalColor.b = Math.round(finalColor.b * (1 - backgroundAdjustFactor) + avgGlobalB * backgroundAdjustFactor);
      }
      
      // 7. 绘制背景色
      // 对于图表类元素的优化 - 增加背景透明度
      const useAlpha = isSpecialRegion;
      
      if (useAlpha) {
        // 对于特殊区域使用半透明背景，保持一些原始细节
        ctx.fillStyle = `rgba(${finalColor.r}, ${finalColor.g}, ${finalColor.b}, 0.85)`;
      } else {
        ctx.fillStyle = `rgb(${finalColor.r}, ${finalColor.g}, ${finalColor.b})`;
      }
      
      // 绘制背景色块
      ctx.fillRect(
        region.x - padding,
        region.y - padding,
        region.width + (padding * 2),
        region.height + (padding * 2)
      );
      
      // 8. 绘制文本
      // 根据背景亮度自动选择文本颜色
      const luminance = 0.299 * finalColor.r + 0.587 * finalColor.g + 0.114 * finalColor.b;
      const textColor = luminance > 128 ? 'black' : 'white';
      const strokeColor = luminance > 128 ? 'white' : 'black';
      
      ctx.fillStyle = textColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 0.6; // 减小描边宽度，使文字更清晰
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // 字体大小优化策略
      // 1. 初始字体大小设置得更大一些，提高默认字体大小
      let fontSize = Math.max(region.height * 0.9, 20); // 适当减小字体基础大小，更符合图表美观
      let textFits = false;
      
      // 2. 智能字体大小计算 - 根据文本长度调整初始大小
      // 短文本（1-2个字符）可以使用更大的字体
      if (textToRender.length <= 2) {
        fontSize = Math.max(fontSize, region.height * 0.95);
      } else if (textToRender.length <= 4) {
        // 中等长度文本使用略小的字体
        fontSize = Math.max(fontSize, region.height * 0.85);
      } else {
        // 长文本使用相对较小的初始字体
        fontSize = Math.max(fontSize, region.height * 0.75);
      }
      
      // 3. 动态调整字号以适应区域宽度
      while (!textFits && fontSize > 12) {
        // 使用已注册的中文字体 'SimHei'
        ctx.font = `${fontSize}px SimHei`;
        const metrics = ctx.measureText(textToRender);
        
        // 区域宽度调整 - 允许文本有更大的宽度，稍微超出框也可以
        const widthThreshold = region.width * (textToRender.length <= 2 ? 1.1 : 1.02);
        
        if (metrics.width < widthThreshold) {
          textFits = true;
        } else {
          fontSize -= 2;
        }
      }
      
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      
      // 4. 短文本优化 - 使用粗体并增大字体
      if (textToRender.length <= 3 && region.width > 20 && region.height > 20) {
        fontSize = Math.min(fontSize * 1.2, region.height * 1.2);
        ctx.font = `${fontSize}px SimHei`;
      }
      
      // 检测是否为竖排文本
      const isVertical = (region.height / region.width > 1.5) ||
                        (region.height / region.width > 1.0 && textToRender.length > 2) ||
                        (region.height > 80 && region.width < 100);
                        
      if (isVertical) {
        // 竖排文本处理
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 计算每个字符的位置
        const chars = textToRender.split('');
        
        // 竖排文本特别优化 - 根据字符数量和区域大小进一步调整
        let charFactor;
        if (chars.length <= 2) {
          charFactor = 1.8;
        } else if (chars.length <= 4) {
          charFactor = 1.6;
        } else if (chars.length <= 6) {
          charFactor = 1.4;
        } else {
          charFactor = 1.2;
        }
        
        // 根据区域高度和宽度进一步调整字体大小
        const areaFactor = Math.min(1.0, region.width / 40);
        charFactor = charFactor * (0.8 + areaFactor * 0.4);
        
        // 计算最终字体大小
        const charHeight = Math.min(
          fontSize * 1.5,
          (region.height / chars.length) * charFactor
        );
        
        ctx.font = `${charHeight}px SimHei`;
        
        // 计算起始位置，确保文本居中
        const charSpacing = chars.length <= 3 ? 0.85 : 0.9;
        const totalTextHeight = chars.length * charHeight * charSpacing;
        const startY = centerY - totalTextHeight / 2 + charHeight / 2;
        
        // 绘制每个字符
        chars.forEach((char, index) => {
          const y = startY + index * charHeight * charSpacing;
          
          // 绘制文字描边，增强可读性
          ctx.strokeText(char, centerX, y);
          // 绘制文字主体
          ctx.fillText(char, centerX, y);
        });
      } else {
        // 水平文本处理 - 添加描边
        ctx.strokeText(textToRender, centerX, centerY);
        ctx.fillText(textToRender, centerX, centerY);
      }
      
      processedCount++;
    }
    
    const outputFileName = `translated-${Date.now()}-${path.basename(imagePath)}-processed.jpg`;
    const outputPath = path.join(__dirname, 'results', outputFileName);
    
    const buffer = canvas.toBuffer('image/jpeg');
    fs.writeFileSync(outputPath, buffer);

    console.log(`成功将覆盖式翻译结果渲染到: ${outputPath}`);
    
    return {
      success: true,
      outputPath: outputPath,
      processedCount: processedCount,
      skippedCount: skippedCount
    };

  } catch (error) {
    console.error('使用 canvas 渲染覆盖式翻译文本时出错:', error);
    return {
      success: false,
      message: '渲染覆盖式翻译文本时出错: ' + error.message
    };
  }
}

// 添加图像预处理函数
/**
 * 对图像进行预处理以提高OCR识别质量
 * @param {string} imagePath 图像路径
 * @returns {Object} 包含处理后图像路径的对象
 */
async function preprocessImage(imagePath) {
  try {
    console.log(`开始预处理图像: ${imagePath}`);
    
    // 读取图像
    const image = await Jimp.read(imagePath);
    
    // 获取文件名和扩展名
    const fileExt = path.extname(imagePath);
    const baseName = path.basename(imagePath, fileExt);
    const dirName = path.dirname(imagePath);
    
    // 创建基本增强版本
    // 基础增强版本 - 仅适度提高对比度和亮度
    const enhanced = image.clone()
      .contrast(0.1)       // 适度增加对比度
      .brightness(0.05);   // 稍微提高亮度
    
    // 保存增强版本
    const enhancedPath = path.join(dirName, `${baseName}${fileExt}-enhanced.jpg`);
    await enhanced.writeAsync(enhancedPath);
    
    // 返回处理结果
    return {
      original: imagePath,
      enhanced: enhancedPath,
      best: enhancedPath,
      type: 'enhanced'
    };
  } catch (error) {
    console.error('图像预处理失败:', error);
    return {
      original: imagePath,
      error: error.message
    };
  }
}

// 添加获取百度API访问令牌的函数
async function getBaiduAccessToken(apiKey, secretKey) {
  try {
    const url = `https://aip.baidubce.com/oauth/2.0/token?client_id=${apiKey}&client_secret=${secretKey}&grant_type=client_credentials`;
    
    const response = await axios.post(url, {}, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    if (response.data && response.data.access_token) {
      console.log('获取百度访问令牌成功');
      return response.data.access_token;
    } else {
      console.error('获取百度访问令牌失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取百度访问令牌出错:', error.message);
    return null;
  }
}

// 新增：批量翻译所有文本区域的函数
async function translateAllAtOnce(regions, targetLang = 'zh') {
  if (!regions || regions.length === 0) {
    return [];
  }

  const client = getDeepseekClient();
  if (!client) {
    console.log('未配置Deepseek API，跳过翻译');
    // 返回原文作为翻译结果
    return regions.map(r => ({ ...r, translated: r.text, translateSource: 'original' }));
  }

  console.log(`准备批量翻译 ${regions.length} 个文本区域...`);

  // 1. 创建一个包含所有待翻译文本的数组，并附带唯一ID
  const textsToTranslate = regions.map((region, index) => ({
    id: index,
    text: region.text
  }));

  // 2. 构建一个专门用于批量翻译的提示
  const prompt = `Translate the 'text' field for each object in the following JSON array into ${targetLang}. Return the result as a valid JSON array with the same structure, containing only the translated text. Do not include any explanations, notes, or introductory text.

Input:
${JSON.stringify(textsToTranslate, null, 2)}

Output:`;

  try {
    // 3. 调用Deepseek API进行批量翻译
    const response = await client.translate(prompt);

    // 4. 解析返回的JSON结果
    // 尝试从返回的文本中提取有效的JSON部分
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Deepseek API未返回有效的JSON数组');
    }

    const translatedTexts = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(translatedTexts) || translatedTexts.length !== regions.length) {
      throw new Error('翻译返回的JSON格式不匹配');
    }

    // 创建一个从ID到翻译文本的映射
    const translationMap = new Map();
    translatedTexts.forEach(item => {
      translationMap.set(item.id, item.text);
    });

    // 5. 将翻译结果映射回原始的文本区域
    const translatedRegions = regions.map((region, index) => {
      const translatedText = translationMap.get(index);
      return {
        ...region,
        translated: translatedText || region.text, // 如果某个翻译失败，则保留原文
        translateSource: 'deepseek_batch'
      };
    });

    console.log('批量翻译成功完成');
    return translatedRegions;

  } catch (error) {
    console.error('批量翻译失败:', error);
    // 失败时返回原文
    return regions.map(r => ({ ...r, translated: r.text, translateSource: 'original_batch_error' }));
  }
}

// 图片翻译路由
app.post('/api/translate', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '请上传图片文件' });
    }

    const imagePath = req.file.path;
    const targetLang = req.body.targetLang || 'zh';
    
    // 1. 首先使用OCR识别文字
    let textRegions = [];
    let ocrResult;
    
    if (baiduOcrClient) {
      console.log('使用百度OCR识别文字...');
      ocrResult = await recognizeTextByBaidu(imagePath);
      if (ocrResult && ocrResult.success && Array.isArray(ocrResult.textRegions)) {
        textRegions = ocrResult.textRegions;
      }
    } else {
      console.log('使用PaddleOCR识别文字...');
      ocrResult = await recognizeTextByPaddle(imagePath);
      if (ocrResult && ocrResult.success && Array.isArray(ocrResult.textRegions)) {
        textRegions = ocrResult.textRegions;
      }
    }

    if (!textRegions || textRegions.length === 0) {
      return res.status(422).json({ error: '未能识别出任何文字' });
    }

    // 2. 将所有识别出的文本一次性打包发送给Deepseek翻译
    const translatedRegions = await translateAllAtOnce(textRegions, targetLang);

    // 3. 渲染翻译结果到图片上
    const renderResult = await renderTranslatedText(imagePath, translatedRegions);
    
    if (!renderResult || !renderResult.success) {
      throw new Error('渲染翻译结果失败');
    }
    
    const resultPath = renderResult.outputPath;
    const relativePath = '/results/' + path.basename(resultPath);

    // 4. 返回结果
    res.json({
      success: true,
      textRegions: translatedRegions,
      resultImage: relativePath,
      originalImage: '/uploads/' + path.basename(imagePath)
    });

  } catch (error) {
    console.error('处理请求时发生错误:', error);
    res.status(500).json({ error: error.message });
  }
});

// API配置信息接口 - 用于获取API状态
app.get('/api/status', async (req, res) => {
  try {
    // 返回API配置状态，但不暴露具体密钥
    const apiStatus = {
      baiduOcr: {
        configured: !!(process.env.BAIDU_APP_ID && process.env.BAIDU_API_KEY && process.env.BAIDU_SECRET_KEY),
        client: !!baiduOcrClient
      },
      deepseek: {
        configured: !!process.env.DEEPSEEK_API_KEY,
        client: !!deepseekClient
      }
    };
    
    res.json({ 
      success: true, 
      status: apiStatus,
      message: '请在.env文件中配置API密钥'
    });
  } catch (error) {
    console.error('获取API状态失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '获取API状态失败: ' + error.message 
    });
  }
});

// 生产环境下的前端静态文件服务
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`服务器已启动，端口号: ${PORT}`); 
}); 