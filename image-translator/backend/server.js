/**
 * 图片文本翻译服务器
 * 
 * ===== 百度API配置说明 =====
 * 1. 百度智能云OCR API: 访问 https://cloud.baidu.com/product/ocr 注册并创建应用
 *    - 获取BAIDU_APP_ID, BAIDU_API_KEY 和 BAIDU_SECRET_KEY
 * 
 * 2. 百度翻译API: 访问 http://api.fanyi.baidu.com/api/trans/product/index 注册
 *    - 获取BAIDU_TRANSLATE_APP_ID 和 BAIDU_TRANSLATE_KEY
 * 
 * 3. 创建 .env 文件在后端根目录，配置以下内容:
 *    ```
 *    BAIDU_APP_ID=119352969
 *    BAIDU_API_KEY=yrWwaxSLv8JyrUBJxYmsSVKP
 *    BAIDU_SECRET_KEY=14j1Q2uDRxmUjIrnwxR1W1T74o6FWlkN
 *    BAIDU_TRANSLATE_APP_ID=20250626002390545
 *    BAIDU_TRANSLATE_KEY=FBgfhvu0ieM284dRNJ9G
 *    PORT=3001
 *    ```
 * 
 * 4. 如不配置百度API，系统将自动使用本地的PaddleOCR备选方案
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
const AipNlpClient = require('baidu-aip-sdk').nlp;
const axios = require('axios');

// 加载环境变量
dotenv.config();

// 注册中文字体
const fontPath = path.join(__dirname, 'fonts', 'SimHei.ttf');
if (fs.existsSync(fontPath)) {
  try {
    registerFont(fontPath, { family: 'SimHei' });
    console.log('成功注册字体: SimHei.ttf');
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
const BAIDU_TRANSLATE_APP_ID = process.env.BAIDU_TRANSLATE_APP_ID || '';
const BAIDU_TRANSLATE_KEY = process.env.BAIDU_TRANSLATE_KEY || '';

// PaddleOCR模型路径配置
const PADDLE_OCR_MODEL_DIR = path.join(__dirname, 'paddle_models');
const PADDLE_OCR_LANG_DIR = path.join(__dirname, 'lang-data');

// 添加临时存储，用于客户端动态提供的API密钥
let tempCredentials = {
  baiduOcr: null,
  baiduTranslate: null
};

// 创建百度OCR和翻译客户端实例
let baiduOcrClient = null;
let baiduNlpClient = null;

// 仅在配置了API密钥的情况下初始化百度客户端
if (BAIDU_APP_ID && BAIDU_API_KEY && BAIDU_SECRET_KEY) {
  try {
    console.log('初始化百度OCR客户端...');
    baiduOcrClient = new AipOcrClient(BAIDU_APP_ID, BAIDU_API_KEY, BAIDU_SECRET_KEY);
    baiduNlpClient = new AipNlpClient(BAIDU_APP_ID, BAIDU_API_KEY, BAIDU_SECRET_KEY);
    console.log('百度OCR客户端初始化成功');
  } catch (error) {
    console.error('百度OCR客户端初始化失败:', error);
    baiduOcrClient = null;
    baiduNlpClient = null;
  }
}

// 获取百度OCR客户端（优先使用临时凭证）
function getBaiduOcrClient() {
  if (tempCredentials && tempCredentials.baiduOcr) {
    console.log('使用临时OCR凭证创建客户端');
    return new AipOcrClient(
      tempCredentials.baiduOcr.appId,
      tempCredentials.baiduOcr.apiKey,
      tempCredentials.baiduOcr.secretKey
    );
  }
  
  if (baiduOcrClient) {
    return baiduOcrClient;
  }
  
  // 尝试从环境变量重新初始化客户端
  if (process.env.BAIDU_APP_ID && process.env.BAIDU_API_KEY && process.env.BAIDU_SECRET_KEY) {
    console.log('从环境变量重新初始化OCR客户端');
    baiduOcrClient = new AipOcrClient(process.env.BAIDU_APP_ID, process.env.BAIDU_API_KEY, process.env.BAIDU_SECRET_KEY);
    return baiduOcrClient;
  }
  
  console.log('没有找到有效的百度OCR凭证');
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
  const { languageType = 'auto', ocrApiVersion = 'accurate_basic' } = options;

  console.log(`使用百度智能云OCR进行文本识别 (版本: ${ocrApiVersion}, 语言: ${languageType})...`);
  
  // 获取客户端实例
  const client = getBaiduOcrClient();
  
  if (!client) {
    console.log('未配置百度OCR客户端，跳过百度OCR识别');
    return { 
      success: false, 
      message: '未配置百度OCR客户端，请先在页面上配置API密钥', 
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
      // 转换为标准格式
      const textRegions = result.words_result.map((word, index) => {
        const location = word.location || { left: 0, top: 0, width: 100, height: 30 };
        return {
          text: word.words,
          x: location.left,
          y: location.top,
          width: location.width,
          height: location.height,
          confidence: 90, // 百度OCR通常不返回置信度
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

// 更新betterTranslate函数，移除本地映射查找
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
    
    // 检测是否包含混合语言（中英文混合）
    const hasChinese = /[\u4e00-\u9fa5]/.test(cleanText);
    const hasEnglish = /[a-zA-Z]/.test(cleanText);
    const isMixedLanguage = hasChinese && hasEnglish;
    
    // 如果是混合语言且目标是中文，强制指定源语言为英文，确保整个文本都被翻译
    let fromLang = 'auto';
    if (isMixedLanguage && apiTargetLang === 'zh') {
      // 对混合文本特殊处理，提取英文部分单独翻译，然后将结果合并回原文
      const englishWords = cleanText.match(/[a-zA-Z]+/g) || [];
      if (englishWords.length > 0) {
        let modifiedText = cleanText;
        // 创建英文单词到翻译结果的映射
        const wordTranslations = {};
        
        // 对每个英文单词进行翻译
        for (const word of englishWords) {
          try {
            const wordTranslation = await translateByBaidu(word, 'en', apiTargetLang);
            if (wordTranslation && wordTranslation.text) {
              wordTranslations[word] = wordTranslation.text;
              // 替换文本中的英文为翻译结果
              modifiedText = modifiedText.replace(new RegExp(word, 'g'), wordTranslations[word]);
            }
          } catch (err) {
            console.warn(`无法翻译单词 "${word}":`, err);
          }
        }
        
        // 缓存结果
        translationCache.set(cacheKey, modifiedText);
        return {
          text: modifiedText,
          source: 'baidu_api_mixed'
        };
      }
    }
    
    try {
      // 尝试使用百度翻译API
      const baiduResult = await translateByBaidu(cleanText, fromLang, apiTargetLang);
      
      if (baiduResult && baiduResult.text) {
        console.log(`百度翻译结果: "${baiduResult.text}"`);
        translationCache.set(cacheKey, baiduResult.text);
        return {
          text: baiduResult.text,
          source: 'baidu_api'
        };
      }
    } catch (baiduErr) {
      console.warn('百度翻译失败，尝试使用Google翻译:', baiduErr);
      // 百度翻译失败，尝试使用Google翻译API
    }
    
    try {
      // 设置较短的超时时间，防止长时间等待
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5秒超时
      
      // 调用Google翻译API作为备选方案
      const res = await translate(cleanText, { 
        to: apiTargetLang,
        fetchOptions: { signal: controller.signal }
      });
      
      clearTimeout(timeoutId);
      const translatedText = res.text;
      
      // 缓存结果
      translationCache.set(cacheKey, translatedText);
      console.log(`Google翻译结果: "${translatedText}"`);
      
      return { 
        text: translatedText,
        source: 'google_api'
      };
    } catch (err) {
      console.error('翻译API调用失败:', err);
      return { 
        text: cleanText,
        source: 'original'
      }; // 无法翻译时返回原文
    }
  } catch (err) {
    console.error('翻译处理失败，返回原文:', err);
    return { 
      text: cleanText,
      source: 'error'
    };
  }
}

// 修改百度翻译API函数
async function translateByBaidu(text, from = 'auto', to = 'zh') {
  if (!text || text.trim() === '') {
    return { success: false, text: '', message: '空文本无需翻译' };
  }
  
  console.log(`使用百度翻译API: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);
  
  // 获取百度翻译凭证
  let appId = BAIDU_TRANSLATE_APP_ID;
  let key = BAIDU_TRANSLATE_KEY;
  
  // 优先使用临时凭证
  if (tempCredentials.baiduTranslate) {
    appId = tempCredentials.baiduTranslate.appId;
    key = tempCredentials.baiduTranslate.key;
  }
  
  if (!appId || !key) {
    return { success: false, text, message: '未配置百度翻译API' };
  }
  
  const cacheKey = `${text}_${from}_${to}`;
  
  // 检查缓存
  if (translationCache.has(cacheKey)) {
    return {
      text: translationCache.get(cacheKey),
      source: 'cache'
    };
  }

  // 检查是否配置了百度翻译API
  if (!BAIDU_TRANSLATE_APP_ID || !BAIDU_TRANSLATE_KEY) {
    console.log('百度翻译API未配置，返回原文');
    return {
      text: text,
      source: 'no_api' 
    };
  }
  
  try {
    // 构建请求参数
    const salt = Date.now();
    const sign = require('crypto')
      .createHash('md5')
      .update(appId + text + salt + key)
      .digest('hex');
    
    // 调整语言代码
    let fromLang = from, toLang = to;
    
    // 转换语言代码为百度API格式
    if (from === 'auto') fromLang = 'auto';
    if (from === 'chi_sim' || from === 'zh') fromLang = 'zh';
    if (from === 'eng') fromLang = 'en';
    if (from === 'jpn') fromLang = 'jp';
    if (from === 'kor') fromLang = 'kor';
    
    if (to === 'chi_sim' || to === 'zh') toLang = 'zh';
    if (to === 'eng') toLang = 'en';
    if (to === 'jpn') toLang = 'jp';
    if (to === 'kor') toLang = 'kor';
    
    // 发送HTTP请求到百度翻译API
    const response = await fetch(`http://api.fanyi.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(text)}&from=${fromLang}&to=${toLang}&appid=${appId}&salt=${salt}&sign=${sign}`);
    
    if (!response.ok) {
      throw new Error(`HTTP错误: ${response.status}`);
    }
    
    const data = await response.json();
    
    // 检查API响应错误
    if (data.error_code) {
      throw new Error(`百度翻译错误: ${data.error_msg}`);
    }
    
    // 提取翻译结果
    const translatedText = data.trans_result && data.trans_result[0] ? 
                          data.trans_result[0].dst : text;
    
    // 缓存结果                      
    translationCache.set(cacheKey, translatedText);
    
    return {
      text: translatedText,
      source: 'baidu_api'
    };
  } catch (error) {
    console.error('百度翻译API错误:', error);
    
    // 使用谷歌翻译API作为备选
    try {
      return await translate(text, { to: to === 'zh' ? 'zh-CN' : to });
    } catch (translateError) {
      console.error('备选翻译也失败:', translateError);
      throw error;
    }
  }
}

// 将翻译后的文字渲染到图片上 - 包含自适应文本框功能
async function renderTranslatedText(imagePath, textRegions) {
  try {
    console.log('开始渲染覆盖式翻译文本...');

    const image = await loadImage(imagePath);
    const jimpImage = await Jimp.read(imagePath); // 用于拾取颜色
    const { width, height } = image;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. 将原始图片绘制到底层
    ctx.drawImage(image, 0, 0, width, height);

    let processedCount = 0;
    let skippedCount = 0;
    const padding = 2; // 增加填充边距，确保完全覆盖
    const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

    for (const region of textRegions) {
      const textToRender = region.translated || region.text;
      if (!textToRender || textToRender.trim() === '') {
        skippedCount++;
        continue;
      }

      // 2. 升级版智能覆盖：通过采样周围颜色来确定背景色
      const { width: imageWidth, height: imageHeight } = jimpImage.bitmap;
      const offset = 3; // 从文本框向外采样的距离

      const samplePoints = [
        jimpImage.getPixelColor(clamp(region.x - offset, 0, imageWidth - 1), clamp(region.y - offset, 0, imageHeight - 1)),
        jimpImage.getPixelColor(clamp(region.x + region.width + offset, 0, imageWidth - 1), clamp(region.y - offset, 0, imageHeight - 1)),
        jimpImage.getPixelColor(clamp(region.x - offset, 0, imageWidth - 1), clamp(region.y + region.height + offset, 0, imageHeight - 1)),
        jimpImage.getPixelColor(clamp(region.x + region.width + offset, 0, imageWidth - 1), clamp(region.y + region.height + offset, 0, imageHeight - 1)),
        jimpImage.getPixelColor(clamp(region.x + region.width / 2, 0, imageWidth - 1), clamp(region.y - offset, 0, imageHeight - 1)),
        jimpImage.getPixelColor(clamp(region.x + region.width / 2, 0, imageWidth - 1), clamp(region.y + region.height + offset, 0, imageHeight - 1))
      ].map(c => Jimp.intToRGBA(c));
      
      const avgColor = samplePoints.reduce((acc, c) => ({
        r: acc.r + c.r,
        g: acc.g + c.g,
        b: acc.b + c.b,
      }), { r: 0, g: 0, b: 0 });

      avgColor.r = Math.round(avgColor.r / samplePoints.length);
      avgColor.g = Math.round(avgColor.g / samplePoints.length);
      avgColor.b = Math.round(avgColor.b / samplePoints.length);

      ctx.fillStyle = `rgb(${avgColor.r}, ${avgColor.g}, ${avgColor.b})`;
      
      // 绘制色块覆盖原文
      ctx.fillRect(
        region.x - padding,
        region.y - padding,
        region.width + (padding * 2),
        region.height + (padding * 2)
      );

      // 3. 绘制翻译后的文本，颜色自适应
      // 计算背景亮度决定文字颜色
      const luminance = 0.299 * avgColor.r + 0.587 * avgColor.g + 0.114 * avgColor.b;
      ctx.fillStyle = luminance > 128 ? 'black' : 'white';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      // 字体大小优化策略
      // 1. 初始字体大小设置得更大一些，提高默认字体大小
      let fontSize = Math.max(region.height * 1.2, 18); // 大幅提高基础字体大小，从0.85提高到1.2，最小值从14提高到18
      let textFits = false;
      
      // 2. 智能字体大小计算 - 根据文本长度调整初始大小
      // 短文本（1-2个字符）可以使用更大的字体
      if (textToRender.length <= 2) {
        fontSize = Math.max(fontSize, region.height * 1.4); // 短文本字体从0.95提高到1.4倍区域高度
      } else if (textToRender.length <= 4) {
        // 中等长度文本使用略小的字体
        fontSize = Math.max(fontSize, region.height * 1.2); // 从0.85提高到1.2
      } else {
        // 长文本使用相对较小的初始字体，但仍保持较大
        fontSize = Math.max(fontSize, region.height * 1.0); // 从0.7提高到1.0
      }
      
      // 3. 动态调整字号以适应区域宽度
      while (!textFits && fontSize > 10) { // 提高最小字体大小阈值
        // 使用已注册的中文字体 'SimHei'
        ctx.font = `${fontSize}px SimHei`;
        const metrics = ctx.measureText(textToRender);
        
        // 区域宽度调整 - 允许文本有更大的宽度，稍微超出框也可以
        const widthThreshold = region.width * (textToRender.length <= 2 ? 1.1 : 1.0); // 允许短文本超出框10%
        
        if (metrics.width < widthThreshold) {
          textFits = true;
        } else {
          fontSize -= 2; // 更快速调整，从1.5加快到2
        }
      }
      
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;

      // 4. 短文本优化 - 使用粗体并增大字体
      if (textToRender.length <= 3 && region.width > 20 && region.height > 20) {
        fontSize = Math.min(fontSize * 1.3, region.height * 1.3); // 增大短文本字体，从1.2提高到1.3倍
        ctx.font = `bold ${fontSize}px SimHei`;
      }

      // 检测是否为竖排文本
      const isVertical = (region.height / region.width > 1.5) ||  // 放宽判断条件，从2.0降低到1.8
                        (region.height / region.width > 1.0 && textToRender.length > 2) || // 更宽松的判断，从1.3降低到1.2
                        (region.height > 80 && region.width < 100); // 放宽绝对尺寸判断

      if (isVertical) {
        // 竖排文本处理
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // 计算每个字符的位置
        const chars = textToRender.split('');
        
        // 竖排文本特别优化 - 根据字符数量和区域大小进一步调整
        let charFactor;
        if (chars.length <= 2) {
          // 单字或双字竖排，使用超大字体
          charFactor = 2.0;  // 从1.2提高到1.6
        } else if (chars.length <= 4) {
          // 短文本竖排，使用大字体
          charFactor = 1.8;  // 从1.1提高到1.4
        } else if (chars.length <= 6) {
          // 中等文本竖排
          charFactor = 1.4;  // 从1.0提高到1.2
        } else {
          // 长文本竖排
          charFactor = 1.1;  // 新增长文本处理
        }
        
        // 根据区域高度和宽度进一步调整字体大小
        // 窄高区域需要较小字体，宽区域可以使用较大字体
        const areaFactor = Math.min(1.0, region.width / 40); // 区域宽度因子，窄区域会减小字体
        charFactor = charFactor * (0.8 + areaFactor * 0.4); // 根据区域宽度调整，但不会低于80%
        
        // 计算最终字体大小，大幅提高基础系数
        const charHeight = Math.min(
          fontSize * 1.6,  // 从1.2提高到1.4
          (region.height / chars.length) * charFactor
        );
        
        // 为竖排文本设置粗体，增强可读性
        ctx.font = `bold ${charHeight}px SimHei`;
        
        // 计算起始位置，确保文本居中
        // 减少字符间距，使文本更紧凑
        const charSpacing = chars.length <= 3 ? 0.9 : 0.95; // 短文本间距更紧凑
        const totalTextHeight = chars.length * charHeight * charSpacing;
        const startY = centerY - totalTextHeight / 2 + charHeight / 2;
        
        // 绘制每个字符
        chars.forEach((char, index) => {
          const y = startY + index * charHeight * charSpacing;
          
          // 增强描边效果
          ctx.lineWidth = Math.max(3, Math.floor(charHeight / 6)); // 从/8提高到/7
          
          // 对所有背景应用描边
          ctx.strokeStyle = luminance > 128 ? 'rgba(255, 255, 255, 0)' : 'rgb(255, 255, 255)'; // 增强描边不透明度到0.6
          ctx.strokeText(char, centerX, y);
          
          // 绘制文字主体
          ctx.fillText(char, centerX, y);
        });
      } else {
        // 水平文本处理 - 增强版
        // 6. 增强水平文本的描边效果
        ctx.lineWidth = Math.max(3, Math.floor(fontSize / 10)); // 增加描边宽度，从2提高到3
        
        // 对所有文字应用描边，但根据亮度调整描边颜色和强度
        if (luminance < 220) { // 几乎所有背景都应用描边
          ctx.strokeStyle = luminance > 128 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'; // 增强描边不透明度
          ctx.strokeText(textToRender, centerX, centerY);
        } else {
          // 即使是浅色背景，也添加描边增强清晰度
          ctx.strokeStyle = 'rgba(0,0,0,0.2)'; // 从0.15提高到0.2
          ctx.strokeText(textToRender, centerX, centerY);
        }
        
        // 然后绘制文字
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
    
    // 判断图像主色调
    let isDarkBackground = false;
    let isFlowChart = false;
    let darkPixelCount = 0;
    let totalPixels = image.bitmap.width * image.bitmap.height;
    
    // 采样判断图像类型
    for (let x = 0; x < image.bitmap.width; x += 5) {
      for (let y = 0; y < image.bitmap.height; y += 5) {
        const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
        const brightness = (pixel.r + pixel.g + pixel.b) / 3;
        if (brightness < 100) darkPixelCount++;
        
        // 检测是否是流程图（检测白色线条和黑色背景的组合）
        if (brightness < 30 && // 很黑的背景
            (x > 0 && y > 0 && x < image.bitmap.width - 1 && y < image.bitmap.height - 1)) {
          // 检查附近是否有亮点（线条）
          const neighborPixel = Jimp.intToRGBA(image.getPixelColor(x+1, y));
          const neighborBrightness = (neighborPixel.r + neighborPixel.g + neighborPixel.b) / 3;
          if (neighborBrightness > 200) {
            isFlowChart = true;
          }
        }
      }
    }
    
    // 如果黑色像素占比超过70%，认为是深色背景
    isDarkBackground = (darkPixelCount / (totalPixels / 25)) > 0.7;
    
    // 创建多种增强版本以提高OCR成功率
    // 1. 基础增强版本 - 提高对比度和亮度
    const enhanced = image.clone()
      .contrast(0.1)       // 适度增加对比度
      .brightness(0.05);   // 稍微提高亮度
    
    // 保存增强版本
    const enhancedPath = path.join(dirName, `${baseName}${fileExt}-enhanced.jpg`);
    await enhanced.writeAsync(enhancedPath);
    
    // 2. 创建灰度版本 - 对文字识别更有效
    const gray = image.clone()
      .greyscale();
    
    // 保存灰度版本
    const grayPath = path.join(dirName, `${baseName}${fileExt}-gray.jpg`);
    await gray.writeAsync(grayPath);
    
    // 3. 针对深色背景的特殊处理
    let darkModeEnhancedPath = '';
    if (isDarkBackground || isFlowChart) {
      const darkModeEnhanced = image.clone();
      
      // 应用锐化和增强对比度，提高深色背景上的文字可读性
      darkModeEnhanced
        .contrast(0.3)
        .brightness(0.15)
        .convolute([
          [-1, -1, -1],
          [-1,  9, -1],
          [-1, -1, -1]
        ]);
      
      // 对于流程图，可以考虑不使用反转，以避免破坏原始设计
      if (!isFlowChart) {
        // 如果检测为深色背景但不是流程图，尝试反转颜色
        darkModeEnhanced.invert();
      }
      
      darkModeEnhancedPath = path.join(dirName, `${baseName}${fileExt}-dark-enhanced.jpg`);
      await darkModeEnhanced.writeAsync(darkModeEnhancedPath);
    }
    
    // 基于图片特性选择最合适的预处理版本
    let type = 'enhanced';
    let bestPath = enhancedPath;
    
    if (isDarkBackground && !isFlowChart) {
      type = 'dark-enhanced';
      bestPath = darkModeEnhancedPath;
    } else if (isFlowChart) {
      // 流程图类型优先使用基础增强版本，避免使用灰度处理
      type = 'enhanced';
      bestPath = enhancedPath;
    }
    
    // 返回处理结果
    return {
      original: imagePath,
      enhanced: enhancedPath,
      gray: grayPath,
      darkEnhanced: darkModeEnhancedPath,
      // 返回推荐使用的版本
      best: bestPath,
      type: type,
      isDarkBackground,
      isFlowChart
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

// 图片上传和处理接口
app.post('/translate', upload.single('image'), async (req, res) => {
  // 处理整体超时的计时器
  const requestTimeout = setTimeout(() => {
    res.status(504).json({ 
      error: '请求超时，请使用更小的图片或检查网络连接',
      message: '请求超时，请使用更小的图片或检查网络连接' 
    });
  }, 45000); // 45秒超时
  
  try {
    if (!req.file) {
      clearTimeout(requestTimeout);
      return res.status(400).json({ message: '请上传图片文件' });
    }

    const { sourceLanguage, targetLanguage, force, ocrApiVersion } = req.body;
    const imagePath = req.file.path;
    
    console.log(`开始处理图片: ${path.basename(imagePath)}`);
    console.log(`源语言: ${sourceLanguage || 'auto'}, 目标语言: ${targetLanguage || 'chi_sim'}, OCR版本: ${ocrApiVersion || 'default'}`);
    
    // 检查缓存 - 使用文件哈希作为键
    const fileHash = `${path.basename(imagePath)}_${sourceLanguage || 'auto'}_${targetLanguage || 'chi_sim'}_${ocrApiVersion || 'accurate_basic'}`;
    const cacheFile = path.join(resultsDir, `cache_${fileHash}.json`);
    
    if (force !== 'true' && fs.existsSync(cacheFile)) {
      try {
        console.log('发现缓存结果，直接返回');
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        clearTimeout(requestTimeout);
        res.json({
          translatedImagePath: cacheData.translatedImage.replace('/api/images/', ''),
          textRegions: cacheData.textRegions,
          processingTime: 0.1,
          fromCache: true,
          processedCount: cacheData.processedCount || cacheData.textRegions.length,
          skippedCount: cacheData.skippedCount || 0,
          totalRegions: cacheData.totalRegions || cacheData.textRegions.length,
          ocrEngine: 'baidu'
        });
        return;
      } catch (e) {
        console.error('读取缓存失败:', e);
        // 继续正常处理
      }
    }
    
    // 预处理图像，提高OCR效率
    console.log('开始图像预处理...');
    let preprocessResult;
    try {
      preprocessResult = await preprocessImage(imagePath);
      console.log(`图像预处理完成，类型: ${preprocessResult.type}`);
    } catch (error) {
      console.error('图像预处理失败，使用原始图像:', error);
      preprocessResult = { 
        original: imagePath, 
        best: imagePath,
        type: 'unknown' 
      };
    }

    // 1. OCR识别图片中的文字
    // 使用预处理后推荐的最佳图像版本，而不是固定使用某一版本
    const ocrSourceImage = preprocessResult.best || preprocessResult.original;
    console.log(`使用优化图像进行OCR: ${path.basename(ocrSourceImage)}, 类型: ${preprocessResult.type}`);
    
    let textRegions = [];
    let ocrEngine = 'baidu';

    try {
      // 尝试使用百度OCR
      console.log('使用百度OCR进行文字识别...');
      const ocrResult = await recognizeTextByBaidu(ocrSourceImage, {
        languageType: sourceLanguage,
        ocrApiVersion: ocrApiVersion || 'accurate_basic'
      });

      if (!ocrResult.success) {
        // 如果百度OCR失败，尝试使用PaddleOCR作为备选
        console.log('百度OCR失败，尝试使用PaddleOCR...');
        const paddleResult = await recognizeTextByPaddle(ocrSourceImage, sourceLanguage);
        if (paddleResult.success) {
          textRegions = paddleResult.textRegions;
          ocrEngine = 'paddle';
          console.log(`PaddleOCR成功识别到 ${textRegions.length} 个文本区域`);
        } else {
          throw new Error(paddleResult.message || ocrResult.message || 'OCR识别失败');
        }
      } else {
        textRegions = ocrResult.textRegions;
        console.log(`百度OCR成功识别到 ${textRegions.length} 个文本区域`);
      }

    } catch (ocrError) {
      // 最终尝试使用PaddleOCR
      try {
        console.log('尝试使用PaddleOCR作为最后备选...');
        const paddleResult = await recognizeTextByPaddle(ocrSourceImage, sourceLanguage);
        if (paddleResult.success && paddleResult.textRegions.length > 0) {
          textRegions = paddleResult.textRegions;
          ocrEngine = 'paddle';
          console.log(`PaddleOCR成功识别到 ${textRegions.length} 个文本区域`);
        } else {
          throw new Error('所有OCR引擎都无法识别文本');
        }
      } catch (paddleError) {
        console.error('所有OCR识别尝试均失败:', paddleError.message);
        clearTimeout(requestTimeout);
        return res.status(422).json({
          message: '无法从图片中识别文字，请尝试更清晰的图片。',
          error: ocrError.message
        });
      }
    }
    
    if (textRegions.length === 0) {
      console.log('未检测到有效文本区域');
      const outputFileName = `${imagePath}-processed.jpg`;
      
      try {
        const img = await Jimp.read(preprocessResult.original);
        const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
        img.print(font, 10, 10, '未检测到可翻译文本 / No text detected');
        await img.writeAsync(outputFileName);
        
        clearTimeout(requestTimeout);
        res.json({
          translatedImagePath: `/results/${path.basename(outputFileName)}`,
          textRegions: [],
          processingTime: 0.5,
          message: '未检测到可翻译文本'
        });
        return;
      } catch (error) {
        console.error('创建无文本结果图像失败:', error);
        fs.copyFileSync(preprocessResult.original, outputFileName);
        
        clearTimeout(requestTimeout);
        res.json({
          translatedImagePath: `/results/${path.basename(outputFileName)}`,
          textRegions: [],
          processingTime: 0.5,
          message: '未检测到可翻译文本'
        });
        return;
      }
    }
    
    // 2. 翻译识别出的文字
    console.log('开始翻译...');
    const translatePromises = textRegions.map(async region => {
      try {
        const translateResult = await betterTranslate(region.text, targetLanguage || 'zh-CN');
        region.translated = translateResult.text;
        region.translateSource = translateResult.source;
        return region;
      } catch (error) {
        console.error(`翻译文本"${region.text}"失败:`, error);
        region.translated = region.text; // 翻译失败时使用原文
        region.translateSource = 'error';
        return region;
      }
    });
    
    let translatedRegions;
    try {
      translatedRegions = await Promise.all(translatePromises);
    } catch (error) {
      console.error('批量翻译过程中出错:', error);
      translatedRegions = textRegions;
    }
    
    // 统计翻译来源
    const translationSourceStats = {
      baidu_api: 0,
      baidu_api_mixed: 0, // 添加混合语言处理统计
      google_api: 0,
      cache: 0,
      original: 0, 
      error: 0,
      empty: 0,
      no_api: 0
    };
    
    translatedRegions.forEach(region => {
      if (region.translateSource) {
        translationSourceStats[region.translateSource] = 
          (translationSourceStats[region.translateSource] || 0) + 1;
      }
    });
    
    console.log('翻译来源统计:', translationSourceStats);
    console.log('OCR引擎:', ocrEngine);

    // 3. 将翻译后的文字渲染到处理后的图片上
    console.log('开始渲染翻译结果到图片...');
    const startTime = Date.now();
    let renderResult;
    
    try {
      renderResult = await renderTranslatedText(preprocessResult.original, translatedRegions);
      const processingTime = (Date.now() - startTime) / 1000;
      console.log(`渲染完成: ${path.basename(renderResult.outputPath)}`);
      
      const formattedPath = '/results/' + path.basename(renderResult.outputPath);
      console.log('翻译图片相对路径:', formattedPath);
      
      const responseData = {
        translatedImagePath: formattedPath,
        textRegions: translatedRegions,
        processingTime: processingTime,
        processedCount: renderResult.processedCount,
        skippedCount: renderResult.skippedCount,
        totalRegions: translatedRegions.length,
        translationSourceStats: translationSourceStats,
        ocrEngine: ocrEngine
      };
      
      // 缓存结果
      try {
        fs.writeFileSync(cacheFile, JSON.stringify({
          translatedImage: formattedPath,
          textRegions: translatedRegions,
          processedCount: renderResult.processedCount,
          skippedCount: renderResult.skippedCount,
          totalRegions: translatedRegions.length,
          translationSourceStats: translationSourceStats,
          ocrEngine: ocrEngine
        }));
        console.log('结果已缓存');
      } catch (e) {
        console.error('缓存结果失败:', e);
      }
      
      clearTimeout(requestTimeout);
      res.json(responseData);
    } catch (error) {
      console.error('渲染翻译文本失败:', error);
      const fallbackPath = `${imagePath}-processed.jpg`;
      fs.copyFileSync(preprocessResult.original, fallbackPath);
      
      clearTimeout(requestTimeout);
      res.json({
        translatedImagePath: fallbackPath.replace(path.join(__dirname, ''), '').replace(/\\/g, '/'),
        textRegions: translatedRegions,
        processingTime: (Date.now() - startTime) / 1000,
        error: '渲染文本失败，返回原图',
        message: '渲染文本失败，返回预处理后的图像'
      });
    }
    
    // 清理临时文件
    try {
      const filesToClean = [];
      
      // 添加需要清理的预处理文件
      if (preprocessResult.enhanced && preprocessResult.enhanced !== imagePath) 
        filesToClean.push(preprocessResult.enhanced);
        
      if (preprocessResult.gray && preprocessResult.gray !== imagePath) 
        filesToClean.push(preprocessResult.gray);
        
      if (preprocessResult.darkEnhanced && preprocessResult.darkEnhanced !== imagePath) 
        filesToClean.push(preprocessResult.darkEnhanced);
      
      filesToClean.forEach(file => {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
            console.log(`已清理临时文件: ${file}`);
          } catch (e) {
            console.warn(`清理临时文件失败: ${file}`, e);
          }
        }
      });
    } catch (error) {
      console.warn('清理临时文件失败:', error);
    }
  } catch (error) {
    console.error('处理过程中出错:', error);
    clearTimeout(requestTimeout);
    res.status(500).json({ 
      message: '图片处理失败', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// API配置接口
app.post('/api/configure', async (req, res) => {
  try {
    // 接收配置信息
    const config = req.body;
    console.log('接收到API配置:', config);
    
    // OCR配置
    if (config.baiduOcr) {
      const { appId, apiKey, secretKey } = config.baiduOcr;
      
      // 验证API密钥是否有效
      console.log('正在验证OCR API密钥...');
      const accessToken = await getBaiduAccessToken(apiKey, secretKey);
      
      if (!accessToken) {
        console.error('OCR API密钥验证失败');
        return res.status(400).json({ 
          success: false, 
          message: 'OCR API密钥验证失败，请检查密钥是否正确' 
        });
      }
      
      // 存储配置
      process.env.BAIDU_APP_ID = appId;
      process.env.BAIDU_API_KEY = apiKey;
      process.env.BAIDU_SECRET_KEY = secretKey;
      process.env.BAIDU_ACCESS_TOKEN = accessToken;
      
      // 动态更新正在使用的客户端实例，使其立即生效
      baiduOcrClient = new AipOcrClient(appId, apiKey, secretKey);
      baiduNlpClient = new AipNlpClient(appId, apiKey, secretKey);
      
      // 添加临时凭证
      tempCredentials.baiduOcr = { appId, apiKey, secretKey };
      
      console.log('百度OCR客户端已动态更新。');

      // 写入配置到.env文件
      let envContent = '';
      envContent += `BAIDU_APP_ID=${appId}\n`;
      envContent += `BAIDU_API_KEY=${apiKey}\n`;
      envContent += `BAIDU_SECRET_KEY=${secretKey}\n`;
      
      // 确保.env文件存在
      try {
        const currentEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
        envContent = currentEnv.replace(/BAIDU_APP_ID=.*\n|BAIDU_API_KEY=.*\n|BAIDU_SECRET_KEY=.*\n/g, '') + envContent;
        fs.writeFileSync('.env', envContent);
      } catch (err) {
        console.error('保存.env文件失败:', err);
      }
    }
    
    // 翻译配置
    if (config.baiduTranslate) {
      const { appId, key } = config.baiduTranslate;
      
      // 存储配置
      process.env.BAIDU_TRANSLATE_APP_ID = appId;
      process.env.BAIDU_TRANSLATE_KEY = key;
      
      // 动态更新翻译凭证
      tempCredentials.baiduTranslate = { appId, key };
      console.log('百度翻译凭证已动态更新。');

      // 写入配置到.env文件
      let envContent = '';
      envContent += `BAIDU_TRANSLATE_APP_ID=${appId}\n`;
      envContent += `BAIDU_TRANSLATE_KEY=${key}\n`;
      
      // 确保.env文件存在
      try {
        const currentEnv = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
        envContent = currentEnv.replace(/BAIDU_TRANSLATE_APP_ID=.*\n|BAIDU_TRANSLATE_KEY=.*\n/g, '') + envContent;
        fs.writeFileSync('.env', envContent);
      } catch (err) {
        console.error('保存.env文件失败:', err);
      }
    }
    
    res.json({ success: true, message: 'API配置成功保存' });
  } catch (error) {
    console.error('API配置失败:', error);
    res.status(500).json({ success: false, message: error.message });
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