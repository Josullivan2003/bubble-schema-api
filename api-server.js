const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/api/schema/:input', async function(req, res) {
  const input = req.params.input;
  const format = req.query.format || 'dbml';
  
  console.log('Request: ' + input + ' (format: ' + format + ')');
  
  try {
    let appUrl;
    if (input.startsWith('http')) {
      appUrl = decodeURIComponent(input);
    } else if (input.includes('.')) {
      appUrl = 'https://' + input;
    } else {
      appUrl = 'https://' + input + '.bubbleapps.io';
    }
    
    console.log('Visiting: ' + appUrl);
    
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });
    
    const page = await browser.newPage();
    
    await page.goto(appUrl, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    await wait(3000);
    
    const schemaData = await page.evaluate(function() {
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
    
    console.log('Found ' + Object.keys(dataTypes).length + ' data types');
    
    let output;
    let contentType;
    
    if (format === 'mermaid') {
      output = convertToMermaid(dataTypes);
      contentType = 'text/plain; charset=utf-8';
    } else if (format === 'json') {
      output = JSON.stringify(dataTypes, null, 2);
      contentType = 'application/json';
    } else {
      output = convertToDBML(dataTypes);
      contentType = 'text/plain; charset=utf-8';
    }
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'no-cache');
    res.send(output);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: error.message 
    });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
  res.send('<html><head><title>Bubble Schema API</title></head><body><h1>Bubble Schema Extractor API</h1><p>Extract database schemas from Bubble apps</p><h2>Endpoints</h2><h3>GET /api/schema/:appName</h3><p>Extract schema from a Bubble app</p><h4>Parameters:</h4><ul><li>appName - Bubble app name or full URL</li><li>format (query) - Output format: dbml, mermaid, or json</li></ul><h4>Examples:</h4><pre>GET /api/schema/postcard</pre><pre>GET /api/schema/postcard?format=dbml</pre><pre>GET /api/schema/postcard?format=mermaid</pre><pre>GET /api/schema/postcard?format=json</pre></body></html>');
});

app.listen(PORT, function() {
  console.log('API running on port ' + PORT);
  console.log('http://localhost:' + PORT);
});

function convertToDBML(dataTypes) {
  let dbml = '';
  const relationships = [];
  
  const tables = Object.keys(dataTypes);
  
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    const tableInfo = dataTypes[tableName];
    
    dbml = dbml + 'Table ' + tableName + ' {\n';
    dbml = dbml + '  id text [primary key]\n';
    dbml = dbml + '  Created_Date timestamp\n';
    dbml = dbml + '  Modified_Date timestamp\n';
    
    const fields = tableInfo['%f3'] || {};
    const fieldNames = Object.keys(fields);
    
    for (let j = 0; j < fieldNames.length; j++) {
      const fieldName = fieldNames[j];
      const fieldInfo = fields[fieldName];
      
      if (fieldInfo['%del']) {
        continue;
      }
      
      const fieldType = fieldInfo['%v'];
      if (!fieldType) {
        continue;
      }
      
      if (fieldType.indexOf('custom.') === 0) {
        const relatedType = fieldType.replace('custom.', '');
        const cleanFieldName = fieldName.replace(/_custom_.*$/, '_id');
        dbml = dbml + '  ' + cleanFieldName + ' text\n';
        relationships.push('Ref: ' + tableName + '.' + cleanFieldName + ' > ' + relatedType + '.id');
        
      } else if (fieldType === 'user') {
        const cleanFieldName = fieldName + '_id';
        dbml = dbml + '  ' + cleanFieldName + ' text\n';
        relationships.push('Ref: ' + tableName + '.' + cleanFieldName + ' > user.id');
        
      } else if (fieldType.indexOf('list.') === 0) {
        continue;
        
      } else {
        let dbType = 'text';
        if (fieldType === 'number') {
          dbType = 'int';
        } else if (fieldType === 'date') {
          dbType = 'timestamp';
        } else if (fieldType === 'boolean') {
          dbType = 'boolean';
        }
        
        dbml = dbml + '  ' + fieldName + ' ' + dbType + '\n';
      }
    }
    
    dbml = dbml + '}\n\n';
  }
  
  for (let k = 0; k < relationships.length; k++) {
    dbml = dbml + relationships[k] + '\n';
  }
  
  return dbml;
}

function convertToMermaid(dataTypes) {
  let mermaid = 'erDiagram\n';
  
  const tables = Object.keys(dataTypes);
  
  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    const tableInfo = dataTypes[tableName];
    
    mermaid = mermaid + '  ' + tableName + ' {\n';
    
    const fields = tableInfo['%f3'] || {};
    const fieldNames = Object.keys(fields);
    
    for (let j = 0; j < fieldNames.length; j++) {
      const fieldName = fieldNames[j];
      const fieldInfo = fields[fieldName];
      
      if (fieldInfo['%del']) {
        continue;
      }
      
      const fieldType = fieldInfo['%v'];
      if (!fieldType) {
        continue;
      }
      
      let dbType = 'string';
      if (fieldType === 'number') {
        dbType = 'int';
      } else if (fieldType === 'date') {
        dbType = 'date';
      } else if (fieldType === 'boolean') {
        dbType = 'bool';
      }
      
      mermaid = mermaid + '    ' + dbType + ' ' + fieldName + '\n';
    }
    
    mermaid = mermaid + '  }\n';
  }
  
  return mermaid;
}
