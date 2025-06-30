/**
 * PaddleOCR测试脚本
 * 使用此脚本测试PaddleOCR是否正确安装和可用
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 测试图片路径，使用uploads目录下的第一张图片
const uploadsDir = path.join(__dirname, 'uploads');
let testImagePath = '';

// 查找测试图片
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  if (files.length > 0) {
    // 找到第一个图片文件
    const imageFile = files.find(file => 
      /\.(jpg|jpeg|png|webp|bmp)$/i.test(file)
    );
    
    if (imageFile) {
      testImagePath = path.join(uploadsDir, imageFile);
      console.log(`找到测试图片: ${testImagePath}`);
    }
  }
}

if (!testImagePath) {
  console.log('未找到测试图片，使用默认路径');
  testImagePath = path.join(__dirname, 'test_image.jpg');
  
  // 创建一个简单的测试图片
  if (!fs.existsSync(testImagePath)) {
    console.log('创建简单测试图片...');
    const canvas = require('canvas');
    const { createCanvas } = canvas;
    
    const width = 400;
    const height = 200;
    const c = createCanvas(width, height);
    const ctx = c.getContext('2d');
    
    // 填充白色背景
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    
    // 填充黑色文字
    ctx.fillStyle = 'black';
    ctx.font = '30px Arial';
    ctx.fillText('Hello World', 100, 100);
    
    // 保存图片
    const buffer = c.toBuffer('image/jpeg');
    fs.writeFileSync(testImagePath, buffer);
  }
}

// 测试PaddleOCR是否已安装
console.log('测试PaddleOCR是否已安装...');

const testPythonScript = `
import sys
try:
    from paddleocr import PaddleOCR
    print("PaddleOCR已安装")
    sys.exit(0)
except ImportError:
    print("PaddleOCR未安装")
    sys.exit(1)
`;

// 将Python脚本写入临时文件
const tempScriptPath = path.join(__dirname, 'temp_test_paddle.py');
fs.writeFileSync(tempScriptPath, testPythonScript);

// 执行测试脚本
exec(`python ${tempScriptPath}`, (error, stdout, stderr) => {
  console.log(stdout.trim());
  
  if (error) {
    console.error('PaddleOCR未正确安装，请先安装PaddleOCR');
    console.log('可以运行以下命令安装:');
    console.log('pip install paddlepaddle paddleocr');
    cleanup();
    return;
  }
  
  // 如果PaddleOCR已安装，测试图像识别
  console.log('测试图像识别...');
  
  const testOcrScript = `
import sys
import json
from paddleocr import PaddleOCR

try:
    ocr = PaddleOCR(use_angle_cls=True, lang='ch')
    result = ocr.ocr('${testImagePath.replace(/\\/g, '\\\\')}', cls=True)
    
    if result and len(result) > 0:
        print("OCR测试成功，识别结果:")
        for line in result:
            for text_box in line:
                text = text_box[1][0]
                confidence = text_box[1][1]
                print(f"文本: {text}, 置信度: {confidence:.2f}")
        sys.exit(0)
    else:
        print("OCR未能识别出文本，但API调用成功")
        sys.exit(0)
except Exception as e:
    print(f"OCR测试失败: {str(e)}")
    sys.exit(1)
`;

  // 将OCR测试脚本写入临时文件
  const tempOcrPath = path.join(__dirname, 'temp_test_ocr.py');
  fs.writeFileSync(tempOcrPath, testOcrScript);
  
  // 执行OCR测试
  console.log('正在执行OCR测试，首次运行可能需要下载模型，请耐心等待...');
  exec(`python ${tempOcrPath}`, (error, stdout, stderr) => {
    console.log(stdout.trim());
    
    if (error) {
      console.error('OCR测试失败:');
      console.error(stderr);
    } else {
      console.log('测试完成，PaddleOCR可用于您的应用！');
    }
    
    cleanup();
  });
});

// 清理临时文件
function cleanup() {
  const tempFiles = [
    path.join(__dirname, 'temp_test_paddle.py'),
    path.join(__dirname, 'temp_test_ocr.py')
  ];
  
  tempFiles.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  });
} 