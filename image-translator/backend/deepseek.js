/**
 * Deepseek API 客户端
 * 用于调用Deepseek大模型进行翻译和图像识别
 */

// 引入环境变量
require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;
const mime = require('mime-types');

// AI领域专业词汇表 - 用于提高翻译准确性
const AI_DOMAIN_GLOSSARY = {
  'Agent': '智能体',
  'Model': '模型',
  'Tool': '工具',
  'Vector DB': '向量数据库',
  'Postgres DB': 'Postgres 数据库',
  'Task Queue': '任务队列',
  'Config Manager': '配置管理器',
  'Resource Manager': '资源管理器',
  'Message Broker': '消息代理',
  'Message Handler': '消息处理器',
  'Knowledge': '知识库',
  'Experience': '经验',
  'Trajectory': '轨迹',
  'Actor': '行动者',
  'Self-reflection': '自我反思',
  'Evaluator': '评估器',
  'Environment': '环境',
  'Long-term memory': '长期记忆',
  'Short-term memory': '短期记忆',
  'External feedback': '外部反馈',
  'Internal feedback': '内部反馈',
  'Reflective text': '反思文本',
  'Action': '行动',
  'Reward': '奖励',
  'SuperAGI': 'SuperAGI',
  'Executor': '执行器',
  'Workflow': '工作流',
  'Agent Execution Feed': '智能体执行反馈'
};

class DeepseekClient {
  /**
   * 创建一个DeepseekClient实例
   * @param {string} apiKey - Deepseek API密钥
   */
  constructor(apiKey) {
    // Fail Fast: 验证API密钥
    const finalApiKey = apiKey || process.env.DEEPSEEK_API_KEY;
    
    if (!finalApiKey) {
      throw new Error('未设置Deepseek API密钥，请在环境变量中配置DEEPSEEK_API_KEY');
    }
    
    this.apiKey = finalApiKey;
    this.baseUrl = 'https://api.deepseek.com';
    this.glossary = AI_DOMAIN_GLOSSARY; // 引用专业词汇表
    // this.glossary = {}; // 初始化为空对象，以禁用该功能
  }

  /**
   * 调用Deepseek API的通用方法
   * @param {string} endpoint - API端点
   * @param {Object} requestData - 请求数据
   * @returns {Promise<Object>} API响应
   * @private
   */
  async _callApi(endpoint, requestData) {
    try {
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}${endpoint}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        data: requestData
      });
      
      // Fail Fast: 验证API响应
      if (!response.data || !response.data.choices || response.data.choices.length === 0) {
        throw new Error('Deepseek API返回的响应格式不正确');
      }
      
      return response.data;
    } catch (error) {
      // 增强错误信息
      const errorMessage = error.response?.data?.error?.message || error.message;
      console.error(`Deepseek API调用错误 (${endpoint}):`, errorMessage);
      throw new Error(`API调用失败: ${errorMessage}`);
    }
  }

  /**
   * 使用Deepseek大模型进行翻译
   * @param {string} text 要翻译的文本
   * @param {string} targetLang 目标语言
   * @returns {Promise<string>} 翻译后的文本
   */
  async translate(text, targetLang = 'zh') {
    if (!text || text.trim() === '') {
      return '';
    }

    const targetLanguageName = this._getLanguageName(targetLang);

    // 筛选出文本中实际包含的专业术语
    const relevantTerms = Object.entries(this.glossary)
      .filter(([term]) => text.toLowerCase().includes(term.toLowerCase()));

    // 1. 构建一个清晰、分离的系统指令
    let systemPrompt = `You are a professional translation engine. Your task is to translate the user's text into ${targetLanguageName}. You must only output the translated text. Do not output explanations or any other text.`;
    
    // 如果有相关的专业术语，将其作为强制规则添加到系统指令中
    if (relevantTerms.length > 0) {
        const glossaryString = relevantTerms.map(([term, translation]) => `'${term}' must be translated as '${translation}'`).join('; ');
        systemPrompt += `\n\nCRITICAL: You must follow this glossary: ${glossaryString}.`;
    }

    // 2. 用户指令只包含纯净的原文
    const userPrompt = text;

    const requestData = {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0, // 使用最低温度以获得最稳定、最可预测的结果
      max_tokens: 2000,
    };

    try {
      const responseData = await this._callApi('/v1/chat/completions', requestData);
      const translatedText = responseData.choices[0].message.content.trim();
      // 使用增强的清理函数，并传入原文以备回退
      return this._cleanTranslationResult(translatedText, text);
    } catch (error) {
      console.error(`Translation failed for text: "${text}"`, error);
      return this._fallbackTranslate(text, targetLang);
    }
  }

  /**
   * 清理翻译结果，移除可能的说明文字
   * @param {string} result 原始翻译结果
   * @param {string} originalText 原始文本
   * @returns {string} 清理后的翻译结果
   * @private
   */
  _cleanTranslationResult(result, originalText) {
    if (!result) return originalText || '';
    
    let cleaned = result;

    // 1. 移除常见的AI附加语
    cleaned = cleaned.replace(/^(?:翻译结果|Translation|Translated Text)\s*[:：]?\s*/i, '').trim();

    // 2. 移除包裹结果的引号（成对出现时）
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    
    // 3. 如果清理后结果为空，则返回原文，以避免丢失信息
    if (cleaned.trim() === '') {
      console.warn(`[Clean] Translation result for "${originalText}" was empty after cleaning, returning original text.`);
      return originalText;
    }

    return cleaned.trim();
  }
  
  /**
   * 获取语言名称
   * @param {string} langCode 语言代码
   * @returns {string} 语言名称
   * @private
   */
  _getLanguageName(langCode) {
    const langMap = {
      'zh': '中文',
      'en': '英文',
      'jp': '日文',
      'ja': '日文',
      'kor': '韩文',
      'ko': '韩文',
      'fr': '法文',
      'de': '德文',
      'es': '西班牙文',
      'ru': '俄文'
    };
    
    return langMap[langCode] || langCode;
  }
  
  /**
   * 备用翻译方法
   * @param {string} text 要翻译的文本
   * @param {string} targetLang 目标语言
   * @returns {Promise<string>} 翻译后的文本
   * @private
   */
  async _fallbackTranslate(text, targetLang) {
    // 简化的请求，去除所有复杂配置
    const requestData = {
      model: 'deepseek-chat',
      messages: [
        { 
          role: 'user', 
          content: `翻译成${this._getLanguageName(targetLang)}：${text}` 
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    };
    
    try {
      const responseData = await this._callApi('/v1/chat/completions', requestData);
      return responseData.choices[0].message.content.trim();
    } catch (error) {
      console.error('备用翻译也失败:', error);
      return text; // 返回原文
    }
  }

  /**
   * 批量翻译文本区域
   * @param {Array<object>} textRegions OCR识别出的文本区域数组
   * @param {string} targetLang 目标语言
   * @returns {Promise<Array<object>>} 翻译后的文本区域数组
   */
  async translateTextRegions(textRegions, targetLang = 'zh') {
    if (!Array.isArray(textRegions) || textRegions.length === 0) {
      return [];
    }

    const filteredRegions = textRegions.filter(region => {
      const text = region.text || '';
      return !text.includes('公众号') && 
             !text.includes('智能体爱好者') &&
             !text.includes('扫码关注') &&
             !text.includes('版权所有') &&
             !text.includes('Copyright') &&
             text.trim().length > 0;
    });

    if (filteredRegions.length === 0) {
      return [];
    }

    console.log(`Attempting bulk translation for ${filteredRegions.length} text regions...`);

    // 1. 将所有文本组合成一个带编号的列表
    const textsToTranslate = filteredRegions.map(r => r.text);
    const numberedTexts = textsToTranslate.map((text, index) => `${index + 1}. ${text}`).join('\n');
    
    const targetLanguageName = this._getLanguageName(targetLang);

    // 2. 构建包含完整上下文的"超级指令"
    let systemPrompt = `You are a professional translation engine. You will be given a numbered list of phrases to translate to ${targetLanguageName}. The phrases are all from a single image, so use the full context. You MUST reply with a numbered list of the translations, in the exact same order. Do not add any extra text, explanations, or markdown. The number of translated phrases in your response must exactly match the number of phrases in the user's request.`;
    
    const allTextContent = textsToTranslate.join(' ');
    const relevantTerms = Object.entries(this.glossary)
      .filter(([term]) => allTextContent.toLowerCase().includes(term.toLowerCase()));
    
    if (relevantTerms.length > 0) {
        const glossaryString = relevantTerms.map(([term, translation]) => `'${term}' -> '${translation}'`).join('; ');
        systemPrompt += `\n\nCRITICAL: You must follow this glossary: ${glossaryString}.`;
    }

    // 3. 一次性发送请求
    try {
        const requestData = {
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: numberedTexts }],
            temperature: 0,
            max_tokens: 4000,
        };

        const responseData = await this._callApi('/v1/chat/completions', requestData);
        const bulkTranslation = responseData.choices[0].message.content.trim();

        // 4. 智能解析返回结果
        const translatedLines = bulkTranslation.split('\n').filter(line => line.trim() !== '');
        
        if (translatedLines.length !== textsToTranslate.length) {
            throw new Error(`Bulk translation response line count (${translatedLines.length}) does not match request line count (${textsToTranslate.length}).`);
        }

        const parsedTranslations = translatedLines.map(line => line.replace(/^\d+\.\s*/, '').trim());

        const translatedRegions = filteredRegions.map((region, index) => ({
            ...region,
            translated: this._cleanTranslationResult(parsedTranslations[index], region.text),
            translateSource: 'deepseek_bulk'
        }));
        
        console.log('Bulk translation successful.');
        return translatedRegions;

    } catch (error) {
        // 5. 安全回退机制
        console.warn(`Bulk translation failed: ${error.message}. Falling back to individual parallel translation.`);
        
        const translationPromises = filteredRegions.map(async (region) => {
            try {
                const translatedText = await this.translate(region.text, targetLang);
                return { ...region, translated: translatedText, translateSource: 'deepseek_fallback' };
            } catch (err) {
                console.error(`Individual translation failed for: "${region.text}"`, err);
                return { ...region, translated: region.text, translateSource: 'original' };
            }
        });

        return Promise.all(translationPromises);
    }
  }

  /**
   * 使用Deepseek视觉大模型进行图片翻译
   * @param {string} imagePath 图片路径
   * @param {string} targetLang 目标语言
   * @returns {Promise<object>} 包含文本区域和坐标的对象
   */
  async translateImage(imagePath, targetLang = 'zh') {
    try {
      // Fail Fast: 验证图片路径
      await fs.access(imagePath);
      
      // 1. 将图片转换为Base64
      const imageBuffer = await fs.readFile(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = mime.lookup(imagePath) || 'image/jpeg';
      
      // 2. 构建符合视觉模型要求的提示，优化短语识别
      const prompt = `识别此图片中的所有文本内容。
重要提示:
1. 请将逻辑上相关的词组（如'Vector DB', 'Task Queue'）视为单个文本元素，不要拆分。
2. 对于每个识别到的文本元素，提供其内容和边界框坐标。
3. 使用以下格式返回结果: "文本内容" [x_min, y_min, x_max, y_max]，每行一个元素。

示例:
"SuperAGI Architecture" [10, 20, 200, 50]
"Vector DB" [30, 100, 100, 130]

请勿包含任何其他解释文本。`;

      // 3. 调用视觉模型API
      const requestData = {
        model: 'deepseek-vl-chat', // 使用视觉语言模型
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
            ]
          }
        ],
        max_tokens: 4000
      };
      
      const responseData = await this._callApi('/chat/completions', requestData);
      const rawResponse = responseData.choices[0].message.content;
      
      // 4. 解析API返回的文本，提取出文本区域
      const textRegions = this.parseVisionResponse(rawResponse);
      
      return {
        success: true,
        textRegions: textRegions,
        fullResponse: rawResponse // 保留原始响应以备调试
      };
    } catch (error) {
      console.error('图片翻译处理失败:', error);
      throw new Error(`图片翻译失败: ${error.message}`);
    }
  }
  
  /**
   * 解析视觉模型的响应文本
   * @param {string} responseText API返回的原始文本
   * @returns {Array<object>} 文本区域数组
   */
  parseVisionResponse(responseText) {
    if (!responseText) {
      console.warn('收到空的响应文本');
      return [];
    }
    
    const regions = [];
    // 处理换行符统一格式
    const normalizedText = responseText.replace(/\\n/g, '\n');
    const lines = normalizedText.split('\n');
    
    // 正则表达式匹配 "文本内容" [x1, y1, x2, y2] 或 (x1, y1, x2, y2) 格式
    // 更强大的正则表达式，可以处理多种格式变体
    const regex = /"([^"]+)"\s*[\[\(](\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,]+(\d+)[\]\)]/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        const [_, text, x1Raw, y1Raw, x2Raw, y2Raw] = match;
        
        // 确保坐标为有效数字
        const x1 = parseInt(x1Raw, 10);
        const y1 = parseInt(y1Raw, 10);
        const x2 = parseInt(x2Raw, 10);
        const y2 = parseInt(y2Raw, 10);
        
        // 验证坐标有效性
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
          console.warn(`跳过无效坐标: ${line}`);
          continue;
        }
        
        regions.push({
          text: text,
          x: x1,
          y: y1,
          width: Math.max(1, x2 - x1), // 确保宽度至少为1
          height: Math.max(1, y2 - y1), // 确保高度至少为1
          translated: '', // 留待下一步翻译
          translateSource: 'deepseek_vision_raw'
        });
      }
    }
    
    // 如果标准格式解析失败，尝试一个更通用的回退策略
    if (regions.length === 0) {
      console.warn('无法解析标准格式的文本区域，使用回退策略');
      
      // 尝试提取任何引号包裹的文本作为识别内容
      const fallbackRegex = /"([^"]+)"/g;
      let fallbackMatch;
      
      while ((fallbackMatch = fallbackRegex.exec(normalizedText)) !== null) {
        regions.push({
          text: fallbackMatch[1],
          x: 10, 
          y: 10 + regions.length * 30, // 垂直排列
          width: 500, 
          height: 25,
          translated: '',
          translateSource: 'deepseek_vision_fallback'
        });
      }
      
      // 如果还是没有找到任何文本区域，使用整个响应
      if (regions.length === 0) {
        regions.push({
          text: normalizedText.replace(/\n/g, ' '),
          x: 10, y: 10, width: 500, height: 50,
          translated: '',
          translateSource: 'deepseek_vision_full'
        });
      }
    }

    return regions;
  }
}

module.exports = { DeepseekClient }; 