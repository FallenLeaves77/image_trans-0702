import React, { useState, useCallback } from 'react';
import { Upload, Button, Select, Row, Col, Card, Spin, message, Progress, Modal, Tooltip, Alert } from 'antd';
import { InboxOutlined, DownloadOutlined, SwapOutlined, GlobalOutlined, ThunderboltOutlined, EyeOutlined, DeleteOutlined, PaperClipOutlined } from '@ant-design/icons';
import axios from 'axios';
import './ImageTranslator.css';

const { Dragger } = Upload;
const { Option } = Select;

const BACKEND_URL = 'http://localhost:3001';

// 支持的语言列表
const languages = [
  { code: 'auto', name: '自动检测' },
  { code: 'eng', name: '英语' },
  { code: 'chi_sim', name: '中文(简体)' },
  { code: 'chi_tra', name: '中文(繁体)' },
  { code: 'jpn', name: '日语' },
  { code: 'kor', name: '韩语' },
  { code: 'fra', name: '法语' },
  { code: 'deu', name: '德语' },
  { code: 'rus', name: '俄语' },
  { code: 'spa', name: '西班牙语' },
];

// OCR引擎图标和名称映射
const ocrEngines = {
  baidu: {
    name: '百度智能云OCR',
    icon: '🔍',
    description: '高精度云端OCR识别'
  },
  paddle: {
    name: 'PaddleOCR',
    icon: '🐼',
    description: '百度飞桨开源OCR引擎'
  }
};

// 预设翻译结果缓存
const translationCache = new Map();

// 取消标记
let cancelRequested = false;

// 翻译来源图标和名称映射
const translateSources = {
  deepseek: {
    name: 'Deepseek大模型',
    icon: '🧠',
    description: '高质量AI翻译'
  },
  cache: {
    name: '翻译缓存',
    icon: '⚡',
    description: '本地缓存结果'
  },
  original: {
    name: '保留原文',
    icon: '📝',
    description: '无法翻译时保留原文'
  }
};

// 添加视觉模型控制选项
const useDeepseekVisionDefault = true; // 默认启用视觉模型

const ImageTranslator = () => {
  const [fileList, setFileList] = useState([]);
  const [sourceLanguage, setSourceLanguage] = useState('auto');
  const [targetLanguage, setTargetLanguage] = useState('chi_sim');
  const [ocrApiVersion, setOcrApiVersion] = useState('accurate');
  const [loading, setLoading] = useState(false);
  const [useDeepseekVision, setUseDeepseekVision] = useState(useDeepseekVisionDefault); // 添加视觉模型状态

  // Active states for the currently selected image
  const [activeFileUid, setActiveFileUid] = useState(null);
  const [activeOriginalImage, setActiveOriginalImage] = useState(null);
  const [activeTranslatedImage, setActiveTranslatedImage] = useState(null);
  const [activeTextRegions, setActiveTextRegions] = useState([]);
  const [activeProcessingTime, setActiveProcessingTime] = useState(0);
  const [activeTranslationStats, setActiveTranslationStats] = useState({});
  
  // State to store all translation results, keyed by file uid
  const [translationResults, setTranslationResults] = useState({});
  
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  
  // 重置取消标记
  const resetCancel = useCallback(() => {
    cancelRequested = false;
  }, []);
  
  // 请求取消
  const requestCancel = useCallback(() => {
    cancelRequested = true;
    message.info('正在取消操作...');
    setProgressText('取消中...');
  }, []);

  // 取消翻译处理
  const handleCancel = useCallback(() => {
    if (loading) {
      requestCancel();
    }
  }, [loading, requestCancel]);

  // 图像预处理 - 客户端压缩图片
  const preprocessImage = useCallback((file) => {
    return new Promise((resolve) => {
      setProgressText('图片预处理中...');
      setProgress(10);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // 创建canvas进行压缩处理
          const canvas = document.createElement('canvas');
          // 最大尺寸限制
          const MAX_WIDTH = 1800;
          const MAX_HEIGHT = 1800;
          
          let width = img.width;
          let height = img.height;
          
          // 记录原始尺寸
          const originalSize = `${width}×${height}`;
          
          // 按比例缩小
          let needResize = false;
          if (width > MAX_WIDTH) {
            needResize = true;
            height = Math.round(height * MAX_WIDTH / width);
            width = MAX_WIDTH;
          }
          if (height > MAX_HEIGHT) {
            needResize = true;
            width = Math.round(width * MAX_HEIGHT / height);
            height = MAX_HEIGHT;
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // 添加尺寸信息
          let resizeInfo = '';
          if (needResize) {
            resizeInfo = `图片已优化: ${originalSize} → ${width}×${height}`;
            setProgressText(resizeInfo);
          } else {
            setProgressText('图片已加载，尺寸适中，无需调整');
          }
          
          setProgress(15);
          
          // 转换为图片数据并压缩质量
          canvas.toBlob((blob) => {
            // 计算压缩率
            const compressionRatio = (blob.size / file.size * 100).toFixed(1);
            console.log(`图片压缩率: ${compressionRatio}%`);
            
            if (compressionRatio < 95) {
              setProgressText(`${resizeInfo ? resizeInfo + '，' : ''}文件体积优化: ${(file.size/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB`);
            }
            
            // 创建新的File对象
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            
            setProgress(20);
            setTimeout(() => resolve(compressedFile), 300);
          }, 'image/jpeg', 0.85); // 压缩质量为85%
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle selecting a file from the list to view
  const handleSelectFile = useCallback((file) => {
    setActiveFileUid(file.uid);
    
    // Display original image
    if (file.originFileObj) {
      const reader = new FileReader();
      reader.onload = (e) => setActiveOriginalImage(e.target.result);
      reader.readAsDataURL(file.originFileObj);
    }

    // Display cached translation result if it exists
    const result = translationResults[file.uid];
    if (result) {
      setActiveTranslatedImage(result.translatedImagePath);
      setActiveTextRegions(result.textRegions);
      setActiveTranslationStats(result.translationStats);
      setActiveProcessingTime(result.processingTime);
    } else {
      setActiveTranslatedImage(null);
      setActiveTextRegions([]);
      setActiveTranslationStats({});
      setActiveProcessingTime(0);
    }
  }, [translationResults]);

  // 处理文件上传前的验证
  const beforeUpload = useCallback((file) => {
    const isImage = file.type.startsWith('image/');
    if (!isImage) {
      message.error('只能上传图片文件!');
      return false;
    }
    
    const isLt10M = file.size / 1024 / 1024 < 10;
    if (!isLt10M) {
      message.error('图片大小不能超过10MB!');
      return false;
    }
    
    return false; // 返回false阻止自动上传，改为手动上传
  }, []);

  // 处理文件列表变化
  const handleChange = useCallback(async ({ fileList: newFileList }) => {
    setFileList(newFileList);
    if (newFileList.length > 0) {
      const latestFile = newFileList[newFileList.length - 1];
      if (!activeFileUid || activeFileUid !== latestFile.uid) {
        handleSelectFile(latestFile);
      }
    } else {
      // Clear display if all files are removed
      setActiveFileUid(null);
      setActiveOriginalImage(null);
      setActiveTranslatedImage(null);
      setActiveTextRegions([]);
      setActiveTranslationStats({});
      setActiveProcessingTime(0);
    }
  }, [activeFileUid, handleSelectFile]);

  const handleRemove = (file) => {
    const newResults = { ...translationResults };
    delete newResults[file.uid];
    setTranslationResults(newResults);
    
    const newFileList = fileList.filter(item => item.uid !== file.uid);
    setFileList(newFileList);

    if (activeFileUid === file.uid) {
        if (newFileList.length > 0) {
            handleSelectFile(newFileList[newFileList.length - 1]);
        } else {
            setActiveFileUid(null);
            setActiveOriginalImage(null);
            setActiveTranslatedImage(null);
            setActiveTextRegions([]);
            setActiveTranslationStats({});
            setActiveProcessingTime(0);
        }
    }
  };

  const handlePreview = async (imageSrc) => {
    setPreviewImage(imageSrc);
    setPreviewVisible(true);
  };

  const handleCancelPreview = () => setPreviewVisible(false);

  const handleDownload = async (imageSrc) => {
    if (!imageSrc) {
      message.error('没有可下载的图片');
      return;
    }
    message.loading('正在准备下载...', 0);

    try {
      const response = await axios.get(imageSrc, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      const fileName = imageSrc.split('/').pop() || 'download.jpg';
      link.setAttribute('download', fileName.startsWith('translated-') ? fileName : `translated-${fileName}`);
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      message.destroy();
      message.success('下载已开始!');
    } catch (error) {
      message.destroy();
      message.error('下载失败，请稍后重试');
      console.error('下载图片失败:', error);
    }
  };

  // 处理翻译请求
  const handleTranslate = useCallback(async () => {
    if (fileList.length === 0 || !activeFileUid) {
      message.warning('请先上传并选择一张图片!');
      return;
    }

    const currentFile = fileList.find(f => f.uid === activeFileUid);
    if (!currentFile || !currentFile.originFileObj) {
      message.error('无法找到要翻译的已选文件');
      return;
    }
    
    setLoading(true);
    setProgress(25);
    
    try {
      const processedFile = await preprocessImage(currentFile.originFileObj);
      
      setProgressText('上传并处理中...');
      
      const formData = new FormData();
      formData.append('image', processedFile);
      formData.append('targetLang', targetLanguage);
      formData.append('useDeepseek', useDeepseekVision.toString());
      formData.append('ocrApiVersion', ocrApiVersion);
      
      const controller = new AbortController();
      const cancelCheckInterval = setInterval(() => {
        if (cancelRequested) {
          controller.abort();
          clearInterval(cancelCheckInterval);
        }
      }, 500);

      const startTime = Date.now();
      
      const response = await axios.post(`${BACKEND_URL}/api/translate`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (cancelRequested) {
            throw new axios.Cancel('Upload canceled by user.');
          }
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setProgress(25 + percent * 0.6);
          setProgressText(`上传中: ${percent}%`);
        },
      });

      clearInterval(cancelCheckInterval);

      if (response.data && response.data.success) {
        const translatedImagePath = `${BACKEND_URL}${response.data.resultImage}`;
        const processTime = (Date.now() - startTime) / 1000;
        const stats = {
          processedCount: response.data.textRegions.length,
          skippedCount: 0,
          totalRegions: response.data.textRegions.length,
          fromCache: false,
          ocrEngine: 'auto'
        };

        setActiveTranslatedImage(translatedImagePath);
        setActiveTextRegions(response.data.textRegions || []);
        setActiveProcessingTime(processTime);
        setActiveTranslationStats(stats);
        
        setTranslationResults(prevResults => ({
          ...prevResults,
          [activeFileUid]: {
            translatedImagePath,
            textRegions: response.data.textRegions || [],
            processingTime: processTime,
            translationStats: stats
          }
        }));
        
        setProgress(100);
        setProgressText('翻译完成!');
        message.success(`翻译完成! (耗时: ${processTime.toFixed(2)}s)`);
      } else {
        throw new Error(response.data.error || '翻译失败，未返回图片路径');
      }
    } catch (error) {
      if (axios.isCancel(error)) {
        message.warning('操作已取消');
      } else {
        console.error('翻译失败:', error);
        let errorMessage = '翻译失败，请重试。';
        if (error.response && error.response.data) {
          errorMessage = error.response.data.error || error.response.data.message;
        }
        message.error(errorMessage, 6);
      }
      setProgressText('失败或已取消');
    } finally {
      resetCancel();
      setLoading(false);
      setTimeout(() => {
        setProgress(0);
        setProgressText('');
      }, 2000);
    }
  }, [fileList, activeFileUid, sourceLanguage, targetLanguage, ocrApiVersion, useDeepseekVision, resetCancel]);

  // Render API warning if translation results show API issues
  const renderApiWarning = () => {
    if (activeTextRegions.length === 0 || !activeTranslationStats) {
      return null;
    }

    // 如果使用了本地OCR (paddle)，提示设置百度OCR可能效果更好
    if (translationResults[activeFileUid]?.ocrEngine === 'paddle') {
      return (
        <Alert
          message="提示：使用了本地OCR引擎"
          description="检测到使用的是本地OCR引擎。请在服务器.env文件中配置百度OCR API以获得更好的识别效果。"
          type="info"
          showIcon
          style={{ marginBottom: 15 }}
        />
      );
    }
    
    return null;
  };

  return (
    <div className="translator-container">
      <Row gutter={16}>
        <Col xs={24} sm={24} md={8} lg={8} xl={6}>
          <Card 
            title={<><GlobalOutlined /> 图片上传</>} 
            className="translator-card upload-card"
            extra={
              <Select
                defaultValue={ocrApiVersion}
                style={{ width: 120 }}
                onChange={setOcrApiVersion}
              >
                <Option value="accurate">高精度OCR</Option>
                <Option value="general">通用OCR</Option>
              </Select>
            }
          >
            <div className="language-selectors">
              <Select
                value={sourceLanguage}
                onChange={setSourceLanguage}
              >
                {languages.map(lang => (
                  <Option key={lang.code} value={lang.code}>{lang.name}</Option>
                ))}
              </Select>
              <SwapOutlined className="swap-icon" />
              <Select
                value={targetLanguage}
                onChange={setTargetLanguage}
              >
                {languages
                  .filter(lang => lang.code !== 'auto')
                  .map(lang => (
                    <Option key={lang.code} value={lang.code}>{lang.name}</Option>
                  ))}
              </Select>
            </div>
            
            <Dragger
              className="upload-area"
              fileList={fileList}
              beforeUpload={beforeUpload}
              onChange={handleChange}
              onRemove={handleRemove}
              multiple
              itemRender={(originNode, file, currFileList, actions) => {
                const isSelected = file.uid === activeFileUid;
                return (
                  <div
                    key={file.uid}
                    className={`upload-list-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <div className="file-info">
                      <PaperClipOutlined />
                      <span className="file-name" title={file.name}>{file.name}</span>
                    </div>
                    <Tooltip title="移除">
                      <DeleteOutlined
                        className="remove-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.remove();
                        }}
                      />
                    </Tooltip>
                  </div>
                );
              }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽图片到此区域</p>
              <p className="ant-upload-hint">
                支持多个图片批量上传和翻译
              </p>
            </Dragger>

            <div className="action-buttons">
              <Button 
                type="primary" 
                onClick={handleTranslate} 
                disabled={fileList.length === 0 || loading}
                style={{ marginRight: 8 }}
                loading={loading}
              >
                {loading ? '翻译中...' : '开始翻译'}
              </Button>
              <Button 
                onClick={handleCancel} 
                disabled={!loading}
              >
                取消
              </Button>
            </div>
            
            {loading && (
              <div className="progress-container">
                <Progress percent={progress} status={cancelRequested ? 'exception' : 'active'} />
                <div className="progress-text">{progressText}</div>
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <Card 
                title="原始图片"
                bordered={false}
                actions={activeOriginalImage ? [
                  <EyeOutlined key="preview" onClick={() => handlePreview(activeOriginalImage)} />,
                ] : []}
              >
                {activeOriginalImage ? (
                  <img src={activeOriginalImage} alt="Original" style={{ width: '100%' }} />
                ) : (
                  <div className="image-placeholder">请上传并选择一张图片</div>
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card 
                title="翻译后图片"
                bordered={false}
                actions={
                  activeTranslatedImage ? [
                    <EyeOutlined key="preview" onClick={() => handlePreview(activeTranslatedImage)} />,
                    <DownloadOutlined key="download" onClick={() => handleDownload(activeTranslatedImage)} />
                  ] : []
                }
              >
                {loading && activeFileUid && !translationResults[activeFileUid] ? (
                  <div className="image-placeholder"><Spin /> 正在处理...</div>
                ) : activeTranslatedImage ? (
                  <img src={activeTranslatedImage} alt="Translated" style={{ width: '100%' }} />
                ) : (
                  <div className="image-placeholder">等待翻译结果</div>
                )}
              </Card>
            </Col>
          </Row>

          {/* Show EITHER alerts OR stats, to fill the same space */}
          {!activeTranslatedImage && activeTextRegions.length === 0 ? (
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} md={12}>
                <Alert
                  message="API密钥信息"
                  description="请在服务器的.env文件中配置API密钥。程序会优先使用百度OCR，如未配置则自动使用本地OCR引擎。"
                  type="info"
                  showIcon
                  className="info-alert"
                />
              </Col>
              <Col xs={24} md={12}>
                <Alert
                  message="Deepseek视觉模型已启用"
                  description="系统默认使用Deepseek视觉模型进行图像识别和翻译，提供更好的图表和复杂图像翻译效果。"
                  type="success"
                  showIcon
                  className="info-alert"
                />
              </Col>
            </Row>
          ) : null}

          {activeTranslatedImage && activeTextRegions.length > 0 && (
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col span={24}>
                {activeTranslationStats.totalRegions > 0 && (
                <Card 
                  title="翻译统计" 
                  bordered={false} 
                  className="info-card"
                  extra={<span className="ocr-engine">{activeTranslationStats.ocrEngine && ocrEngines[activeTranslationStats.ocrEngine] ? `${ocrEngines[activeTranslationStats.ocrEngine].icon} ${ocrEngines[activeTranslationStats.ocrEngine].name}` : ''}</span>}
                >
                  <p><b>状态:</b> {activeTranslationStats.fromCache ? '来自缓存' : '实时处理'}</p>
                  <p><b>处理耗时:</b> {activeProcessingTime.toFixed(2)} 秒</p>
                  <p><b>识别区域:</b> {activeTranslationStats.totalRegions} (处理: {activeTranslationStats.processedCount}, 跳过: {activeTranslationStats.skippedCount})</p>
                  { activeTranslationStats.translationSourceStats && 
                    <div className="stats-details">
                      <b>翻译来源:</b>
                      <ul className="translation-sources-list">
                        {Object.entries(activeTranslationStats.translationSourceStats).map(([key, value]) => (
                          value > 0 && <li key={key}>
                            {translateSources[key] ? 
                              <><span className="source-icon">{translateSources[key].icon}</span> {translateSources[key].name}: {value}</> : 
                              `${key}: ${value}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  }
                </Card>
                )}
              </Col>
            </Row>
          )}
        </Col>
      </Row>
      
      <Modal
        visible={previewVisible}
        footer={null}
        onCancel={handleCancelPreview}
        width="90vw"
        bodyStyle={{ padding: '24px', backgroundColor: '#f0f2f5' }}
        centered
      >
        <img alt="预览图" style={{ width: '100%', maxHeight: '80vh', objectFit: 'contain' }} src={previewImage} />
      </Modal>
    </div>
  );
};

export default ImageTranslator;