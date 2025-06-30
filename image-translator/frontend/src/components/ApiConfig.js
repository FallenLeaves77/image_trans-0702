import React, { useState } from 'react';
import { Modal, Form, Input, Button, Tabs, message, Alert } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TabPane } = Tabs;

const ApiConfig = ({ visible, onClose, backendUrl }) => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('ocr');

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      // 构建配置对象
      const config = {};
      
      // OCR配置
      if (values.ocrAppId && values.ocrApiKey && values.ocrSecretKey) {
        config.baiduOcr = {
          appId: values.ocrAppId,
          apiKey: values.ocrApiKey,
          secretKey: values.ocrSecretKey
        };
      }
      
      // 翻译配置
      if (values.translateAppId && values.translateKey) {
        config.baiduTranslate = {
          appId: values.translateAppId,
          key: values.translateKey
        };
      }
      
      // 提交到后端
      const response = await axios.post(`${backendUrl}/api/configure`, config);
      
      if (response.data.success) {
        message.success('API配置成功');
        onClose();
      } else {
        message.error('API配置失败: ' + (response.data.message || '未知错误'));
      }
    } catch (error) {
      console.error('API配置提交出错:', error);
      message.error('API配置提交失败: ' + (error.message || '未知错误'));
    }
  };
  
  return (
    <Modal
      title="百度智能云API配置"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="submit" type="primary" onClick={handleSubmit}>
          保存配置
        </Button>
      ]}
      width={600}
    >
      <Alert
        message="API密钥说明"
        description="为了使用百度OCR和翻译服务，您需要提供相应的API密钥。"
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
      />
      
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane 
          tab={<span><KeyOutlined /> 百度OCR配置</span>}
          key="ocr"
        >
          <Form
            form={form}
            layout="vertical"
          >
            <Form.Item
              name="ocrAppId"
              label="应用ID (AppID)"
              rules={[{ required: activeTab === 'ocr', message: 'AppID不能为空' }]}
            >
              <Input placeholder="请输入百度OCR AppID" />
            </Form.Item>
            
            <Form.Item
              name="ocrApiKey"
              label="API Key"
              rules={[{ required: activeTab === 'ocr', message: 'API Key不能为空' }]}
            >
              <Input placeholder="请输入百度OCR API Key" />
            </Form.Item>
            
            <Form.Item
              name="ocrSecretKey"
              label="Secret Key"
              rules={[{ required: activeTab === 'ocr', message: 'Secret Key不能为空' }]}
            >
              <Input.Password placeholder="请输入百度OCR Secret Key" />
            </Form.Item>
          </Form>
        </TabPane>
        
        <TabPane 
          tab={<span><KeyOutlined /> 百度翻译配置</span>}
          key="translate"
        >
          <Form
            form={form}
            layout="vertical"
          >
            <Form.Item
              name="translateAppId"
              label="应用ID (AppID)"
              rules={[{ required: activeTab === 'translate', message: 'AppID不能为空' }]}
            >
              <Input placeholder="请输入百度翻译AppID" />
            </Form.Item>
            
            <Form.Item
              name="translateKey"
              label="密钥 (Key)"
              rules={[{ required: activeTab === 'translate', message: 'Key不能为空' }]}
            >
              <Input.Password placeholder="请输入百度翻译密钥" />
            </Form.Item>
          </Form>
        </TabPane>
      </Tabs>
    </Modal>
  );
};

export default ApiConfig; 