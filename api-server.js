const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    console.log('Launching browser...');
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });
    console.log('Browser ready');
  }
  return browser;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.get('/api/schema/:input', async function(req, res) {
  const input = req.params.input;
  const format = req.query.format || 'dbml';

  console.log('Request: ' + input + ' (format: ' + format + ')');

  let page = null;

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

    const browser = await getBrowser();
    page = await browser.newPage();

    await page.goto(appUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for app.user_types to be available (max 15s)
    const schemaData = await page.evaluate(function() {
      return new Promise(function(resolve) {
        var attempts = 0;
        var maxAttempts = 30;

        function check() {
          attempts++;
          if (typeof app !== 'undefined' && app.user_types) {
            resolve(JSON.stringify(app.user_types));
          } else if (attempts >= maxAttempts) {
            resolve(null);
          } else {
            setTimeout(check, 500);
          }
        }

        check();
      });
    });

    await page.close();
    page = null;
    
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
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
  res.send('<html><head><title>Bubble Schema API</title></head><body><h1>Bubble Schema Extractor API</h1><p>Extract database schemas from Bubble apps</p><h2>Endpoints</h2><h3>GET /api/schema/:appName</h3><p>Extract schema from a Bubble app</p><h4>Parameters:</h4><ul><li>appName - Bubble app name or full URL</li><li>format (query) - Output format: dbml, mermaid, or json</li></ul><h4>Examples:</h4><pre>GET /api/schema/postcard</pre><pre>GET /api/schema/postcard?format=dbml</pre><pre>GET /api/schema/postcard?format=mermaid</pre><pre>GET /api/schema/postcard?format=json</pre></body></html>');
});

async function start() {
  console.log('Pre-warming Chromium...');
  await getBrowser();

  app.listen(PORT, function() {
    console.log('API running on port ' + PORT);
  });
}

start().catch(function(err) {
  console.error('Failed to start:', err);
  process.exit(1);
});

// Strip type suffix from field name (e.g., "name_text" -> "name")
function cleanFieldName(fieldName, fieldType) {
  if (!fieldType || !fieldName) return fieldName;

  var cleanName = fieldName;

  // Remove _option and everything after it
  var optionIndex = cleanName.indexOf('_option');
  if (optionIndex !== -1) {
    cleanName = cleanName.substring(0, optionIndex);
  }

  // Remove _custom and everything after it
  var customIndex = cleanName.indexOf('_custom');
  if (customIndex !== -1) {
    cleanName = cleanName.substring(0, customIndex);
  }

  // Remove _geographic and everything after it
  var geographicIndex = cleanName.indexOf('_geographic');
  if (geographicIndex !== -1) {
    cleanName = cleanName.substring(0, geographicIndex);
  }

  // Remove type suffixes
  var typeSuffixes = {
    'text': '_text',
    'number': '_number',
    'date': '_date',
    'boolean': '_boolean',
    'file': '_file',
    'image': '_image'
  };

  var suffix = typeSuffixes[fieldType];
  if (suffix && cleanName.endsWith(suffix)) {
    cleanName = cleanName.slice(0, -suffix.length);
  }

  return cleanName;
}

function convertToDBML(dataTypes) {
  var dbml = '// Bubble App Database Schema\n\n';

  var tables = Object.keys(dataTypes);

  for (var i = 0; i < tables.length; i++) {
    var tableName = tables[i];
    var tableInfo = dataTypes[tableName];

    dbml = dbml + 'Table ' + tableName + ' {\n';
    dbml = dbml + '  _id text [pk]\n';
    dbml = dbml + '  Created_Date timestamp\n';
    dbml = dbml + '  Modified_Date timestamp\n';

    var fields = tableInfo['%f3'] || {};
    var fieldNames = Object.keys(fields);

    for (var j = 0; j < fieldNames.length; j++) {
      var fieldName = fieldNames[j];
      var fieldInfo = fields[fieldName];

      if (fieldInfo['%del']) {
        continue;
      }

      var fieldType = fieldInfo['%v'];
      if (!fieldType) {
        continue;
      }

      var cleanName = cleanFieldName(fieldName, fieldType);

      if (fieldType.indexOf('custom.') === 0) {
        var relatedType = fieldType.replace('custom.', '');
        dbml = dbml + '  ' + cleanName + ' text [ref: > ' + relatedType + '._id]\n';

      } else if (fieldType === 'user') {
        dbml = dbml + '  ' + cleanName + ' text [ref: > user._id]\n';

      } else if (fieldType.indexOf('list.') === 0) {
        continue;

      } else {
        var dbType = 'text';
        if (fieldType === 'number') {
          dbType = 'numeric';
        } else if (fieldType === 'date') {
          dbType = 'timestamp';
        } else if (fieldType === 'boolean') {
          dbType = 'boolean';
        }

        dbml = dbml + '  ' + cleanName + ' ' + dbType + '\n';
      }
    }

    dbml = dbml + '}\n\n';
  }

  return dbml;
}

function convertToMermaid(dataTypes) {
  var mermaid = 'erDiagram\n';

  var tables = Object.keys(dataTypes);

  for (var i = 0; i < tables.length; i++) {
    var tableName = tables[i];
    var tableInfo = dataTypes[tableName];

    mermaid = mermaid + '  ' + tableName + ' {\n';

    var fields = tableInfo['%f3'] || {};
    var fieldNames = Object.keys(fields);

    for (var j = 0; j < fieldNames.length; j++) {
      var fieldName = fieldNames[j];
      var fieldInfo = fields[fieldName];

      if (fieldInfo['%del']) {
        continue;
      }

      var fieldType = fieldInfo['%v'];
      if (!fieldType) {
        continue;
      }

      var cleanName = cleanFieldName(fieldName, fieldType);

      var dbType = 'string';
      if (fieldType === 'number') {
        dbType = 'int';
      } else if (fieldType === 'date') {
        dbType = 'date';
      } else if (fieldType === 'boolean') {
        dbType = 'bool';
      }

      mermaid = mermaid + '    ' + dbType + ' ' + cleanName + '\n';
    }

    mermaid = mermaid + '  }\n';
  }

  return mermaid;
}
