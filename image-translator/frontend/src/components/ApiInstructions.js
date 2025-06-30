import React from 'react';
import { Modal, Typography, Steps, Divider, Alert } from 'antd';
import { KeyOutlined, CloudOutlined, ExperimentOutlined } from '@ant-design/icons';

const { Title, Paragraph, Text, Link } = Typography;
const { Step } = Steps;

const ApiInstructions = ({ visible, onClose }) => {
  return (
    <Modal
      title={<><ExperimentOutlined /> 百度OCR配置指南</>}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <Typography>
        <Alert
          message="为什么需要配置API?"
          description="本应用使用百度智能云OCR和百度翻译API来实现最佳的图像文本识别和翻译效果。您需要提供自己的API密钥才能使用这些服务。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Title level={4}>配置百度OCR API</Title>
        <Steps direction="vertical" current={-1}>
          <Step 
            title="注册百度智能云账号" 
            description={
              <Paragraph>
                访问 <Link href="https://cloud.baidu.com/" target="_blank">百度智能云官网</Link> 并注册账号。新用户通常有免费额度。
              </Paragraph>
            } 
          />
          <Step 
            title="创建OCR应用" 
            description={
              <Paragraph>
                1. 进入 <Link href="https://console.bce.baidu.com/ai/#/ai/ocr/overview/index" target="_blank">OCR控制台</Link><br />
                2. 点击"创建应用"<br />
                3. 填写应用名称（如"图片翻译"）和描述<br />
                4. 选择"通用文字识别"服务
              </Paragraph>
            } 
          />
          <Step 
            title="获取API密钥" 
            description={
              <Paragraph>
                创建应用后，系统将提供：<br />
                - AppID<br />
                - API Key<br />
                - Secret Key<br />
                复制这三个值，稍后需要填入本应用的API配置中。
              </Paragraph>
            } 
          />
        </Steps>

        <Divider />

        <Title level={4}>配置百度翻译API</Title>
        <Steps direction="vertical" current={-1}>
          <Step 
            title="注册百度翻译开放平台" 
            description={
              <Paragraph>
                访问 <Link href="http://api.fanyi.baidu.com/" target="_blank">百度翻译开放平台</Link> 并注册账号。
              </Paragraph>
            } 
          />
          <Step 
            title="创建翻译应用" 
            description={
              <Paragraph>
                1. 登录后进入"管理控制台"<br />
                2. 点击"开通服务"<br />
                3. 选择"通用翻译API"<br />
                4. 填写应用名称和使用场景
              </Paragraph>
            } 
          />
          <Step 
            title="获取翻译API密钥" 
            description={
              <Paragraph>
                开通服务后，可以看到：<br />
                - APP ID<br />
                - 密钥<br />
                复制这两个值，填入本应用的API配置中。
              </Paragraph>
            } 
          />
        </Steps>

        <Divider />
        
        <Alert
          message="本应用只在会话中使用您的API密钥"
          description="您的API密钥仅在当前使用会话中有效，不会被永久存储。每次页面刷新后需要重新配置。"
          type="warning"
          showIcon
        />
        
        <Paragraph style={{ marginTop: 16 }}>
          配置API后，图片翻译成功率和准确率将大幅提高。如果您不想配置API，系统将尝试使用备用方案，但识别效果可能不佳。
        </Paragraph>
      </Typography>
    </Modal>
  );
};

export default ApiInstructions; 