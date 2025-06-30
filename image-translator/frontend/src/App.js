import React from 'react';
import { Layout, Typography } from 'antd';
import ImageTranslator from './components/ImageTranslator';
import './App.css';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

function App() {
  return (
    <Layout className="layout">
      <Header className="header">
        <Title level={3} style={{ color: 'white', margin: '0' }}>
          图片文本翻译工具
        </Title>
      </Header>
      <Content className="content">
        <div className="container">
          <ImageTranslator />
        </div>
      </Content>
      <Footer className="footer">
        图片文本翻译工具 ©{new Date().getFullYear()} 版权所有
      </Footer>
    </Layout>
  );
}

export default App; 