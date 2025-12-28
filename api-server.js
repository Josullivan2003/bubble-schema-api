const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API endpoint: GET /api/schema/:appNameOrUrl?format=dbml
app.get('/api/schema/:input', async (req, res) => {
  const input = req.params.input;
  const format = req.query.format || 'dbml'; // dbml or mermaid
  
  console.log(`📥 Request: ${input} (format: ${format})`);
  
  try {
    // Determine URL
    let appUrl;
    if (input.startsWith('http')) {
      appUrl = decodeURIComponent(input);
    } else if (input.includes('.')) {
      appUrl = `https://${input}`;
    } else {
      appUrl = `https://${input}.bubbleapps.io`;
    }
    
    console.log(`🌐 Visiting: ${appUrl}`);
    
    // Extract schema
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    await page.goto(appUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    await wait(3000);
    
    const schemaData = await page.evaluate(() => {
      if (typeof app === 'undefined' || !app.user_types) {
        return null;
      }
      return JSON.stringify(app.user_types);
    });
    
    await browser.close();
    
    if (!schemaData) {
      return res.status(404).json({ 
        error: 'No schema found',
        url: appUrl
      });
    }
    
    const dataTypes = JSON.parse(schemaData);
    
    console.log(`✅ Found ${Object.keys(dataTypes).length} data types`);
    
    // Convert to requested format
    let output;
    let contentType;
    
    if (format === 'mermaid') {
      output = convertToMermaid(dataTypes);
      contentType = 'text/plain';
    } else if (format === 'json') {
      output = JSON.stringify(dataTypes, null, 2);
      contentType = 'application/json';
    } else {
      output = convertToDBML(dataTypes);
      contentType = 'text/plain';
    }
    
    res.set('Content-Type', contentType);
    res.send(output);
    
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Home page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Bubble Schema API</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
          }
          code {
            background: #f4f4f4;
            padding: 2px 6px;
            border-radius: 3px;
          }
          pre {
            background: #f4f4f4;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
          }
        </style>
      </head>
      <body>
        <h1>🎨 Bubble Schema Extractor API</h1>
        <p>Extract database schemas from Bubble apps</p>
        
        <h2>Endpoints</h2>
        
        <h3>GET /api/schema/:appName</h3>
        <p>Extract schema from a Bubble app</p>
        
        <h4>Parameters:</h4>
        <ul>
          <li><code>appName</code> - Bubble app name or full URL</li>
          <li><code>format</code> (query) - Output format: <code>dbml</code>, <code>mermaid</code>, or <code>json</code></li>
        </ul>
        
        <h4>Examples:</h4>
        <pre>GET /api/schema/postcard</pre>
        <pre>GET /api/schema/postcard?format=dbml</pre>
        <pre>GET /api/schema/postcard?format=mermaid</pre>
        <pre>GET /api/schema/postcard?format=json</pre>
        <pre>GET /api/schema/myapp.com?format=dbml</pre>
        
        <h4>Try it:</h4>
        <p><a href="/api/schema/postcard?format=dbml" target="_blank">Get postcard schema (DBML)</a></p>
        <p><a href="/api/schema/postcard?format=json" target="_blank">Get postcard schema (JSON)</a></p>
      </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API running on port ${PORT}`);
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}`);
});

// Convert to DBML
function convertToDBML(dataTypes) {
  let dbml = '// Bubble App Database Schema\n\n';
  
  for (const [tableName, tableInfo] of Object.entries(dataTypes)) {
    dbml += `Table ${tableName} {\n`;
    dbml += `  _id text [pk]\n`;
    dbml += `  Created_Date timestamp\n`;
    dbml += `  Modified_Date timestamp\n`;
    
    const fields = tableInfo['%f3'] || {};
    
    for (const [fieldName, fieldInfo] of Object.entries(fields)) {
      if (fieldInfo['%del']) continue;
      
      const fieldType = fieldInfo['%v'];
      if (!fieldType) continue;
      
      if (fieldType.startsWith('custom.')) {
        const relatedType = fieldType.replace('custom.', '');
        dbml += `  ${fieldName} text [ref: > ${relatedType}._id]\n`;
      } else if (fieldType === 'user') {
        dbml += `  ${fieldName} text [ref: > user._id]\n`;
      } else {
        let dbType = 'text';
        if (fieldType === 'number') dbType = 'numeric';
        else if (fieldType === 'date') dbType = 'timestamp';
        else if (fieldType === 'boolean') dbType = 'boolean';
        
        dbml += `  ${fieldName} ${dbType}\n`;
      }
    }
    
    dbml += `}\n\n`;
  }
  
  return dbml;
}

// Convert to Mermaid
function convertToMermaid(dataTypes) {
  let mermaid = 'erDiagram\n';
  
  for (const [tableName, tableInfo] of Object.entries(dataTypes)) {
    mermaid += `  ${tableName} {\n`;
    
    const fields = tableInfo['%f3'] || {};
    
    for (const [fieldName, fieldInfo] of Object.entries(fields)) {
      if (fieldInfo['%del']) continue;
      
      const fieldType = fieldInfo['%v'];
      if (!fieldType) continue;
      
      let dbType = 'string';
      if (fieldType === 'number') dbType = 'int';
      else if (fieldType === 'date') dbType = 'date';
      else if (fieldType === 'boolean') dbType = 'bool';
      
      mermaid += `    ${dbType} ${fieldName}\n`;
    }
    
    mermaid += `  }\n`;
  }
  
  return mermaid;
}