/**
 * PaddleOCR安装脚本
 * 此脚本用于帮助用户安装PaddleOCR及其依赖
 */

const { exec } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// 创建readline接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 检查Python安装
console.log('检查Python环境...');
exec('python --version', (error, stdout, stderr) => {
  if (error) {
    console.error('未检测到Python，请先安装Python 3.7+');
    console.log('可以从 https://www.python.org/downloads/ 下载安装Python');
    closeAndExit(1);
    return;
  }

  console.log(`检测到Python: ${stdout.trim()}`);
  
  // 检查pip安装
  exec('pip --version', (error, stdout, stderr) => {
    if (error) {
      console.error('未检测到pip，请确保pip已正确安装');
      closeAndExit(1);
      return;
    }

    console.log(`检测到pip: ${stdout.trim()}`);
    
    // 提示用户选择安装模式
    rl.question('是否安装PaddleOCR及其依赖? (y/n): ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        installPaddleOCR();
      } else {
        console.log('取消安装.');
        closeAndExit(0);
      }
    });
  });
});

// 安装PaddleOCR
function installPaddleOCR() {
  console.log('=== 开始安装PaddleOCR相关依赖 ===');
  
  // 创建paddle_models目录
  const modelDir = path.join(__dirname, 'backend', 'paddle_models');
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
    console.log(`创建模型目录: ${modelDir}`);
  }
  
  // 安装PaddlePaddle
  console.log('1. 安装PaddlePaddle...');
  exec('pip install paddlepaddle -i https://mirror.baidu.com/pypi/simple', (error, stdout, stderr) => {
    if (error) {
      console.error('PaddlePaddle安装失败，尝试使用特定版本...');
      exec('pip install paddlepaddle==2.4.2 -i https://mirror.baidu.com/pypi/simple', (error2, stdout2, stderr2) => {
        if (error2) {
          console.error('PaddlePaddle安装失败：', error2);
          console.log('请手动执行以下命令安装PaddlePaddle:');
          console.log('pip install paddlepaddle==2.4.2');
          proceedToNextStep();
        } else {
          console.log('PaddlePaddle安装成功！');
          proceedToNextStep();
        }
      });
    } else {
      console.log('PaddlePaddle安装成功！');
      proceedToNextStep();
    }
  });
  
  // 安装PaddleOCR
  function proceedToNextStep() {
    console.log('2. 安装PaddleOCR...');
    exec('pip install paddleocr -i https://mirror.baidu.com/pypi/simple', (error, stdout, stderr) => {
      if (error) {
        console.error('PaddleOCR安装失败：', error);
        console.log('请手动执行以下命令安装PaddleOCR:');
        console.log('pip install paddleocr');
        proceedToFinalStep();
      } else {
        console.log('PaddleOCR安装成功！');
        proceedToFinalStep();
      }
    });
  }
  
  // 安装额外依赖
  function proceedToFinalStep() {
    console.log('3. 安装其他依赖...');
    exec('pip install shapely pyclipper', (error, stdout, stderr) => {
      if (error) {
        console.error('安装其他依赖失败：', error);
      } else {
        console.log('其他依赖安装成功！');
      }
      
      console.log('\n=== 安装完成 ===');
      console.log('现在您可以使用以下命令启动服务：');
      console.log('1. 启动后端: cd backend && npm start');
      console.log('2. 启动前端: cd frontend && npm start');
      
      closeAndExit(0);
    });
  }
}

// 关闭readline接口并退出
function closeAndExit(code) {
  rl.close();
  setTimeout(() => {
    process.exit(code);
  }, 500);
} 