const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Testing Project Installation ===\n');

// Check if node_modules exists
if (fs.existsSync('node_modules')) {
  console.log('✅ Node modules installed');
} else {
  console.log('❌ Node modules not found');
  process.exit(1);
}

// Check if frontend/node_modules exists
if (fs.existsSync('frontend/node_modules')) {
  console.log('✅ Frontend node modules installed');
} else {
  console.log('❌ Frontend node modules not found');
  process.exit(1);
}

// Check if package.json scripts exist
const pkg = require('./package.json');
if (pkg.scripts.dev && pkg.scripts.dev.includes('concurrently')) {
  console.log('✅ Dev script configured correctly');
} else {
  console.log('❌ Dev script not configured correctly');
  process.exit(1);
}

// Check if server.js exists
if (fs.existsSync('server.js')) {
  console.log('✅ Server file exists');
} else {
  console.log('❌ Server file not found');
  process.exit(1);
}

// Check if frontend/index.html exists
if (fs.existsSync('frontend/index.html')) {
  console.log('✅ Frontend HTML file exists');
} else {
  console.log('❌ Frontend HTML file not found');
  process.exit(1);
}

// Check if data directory can be created and written to
const dataDir = path.join(__dirname, 'data');
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log('✅ Data directory can be created');
  } else {
    console.log('✅ Data directory already exists');
  }
  
  // Check if we can write to the data directory
  const testFile = path.join(dataDir, 'test.txt');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('✅ Can write to data directory');
} catch (error) {
  console.log('❌ Cannot create or write to data directory');
  process.exit(1);
}

console.log('\n=== All tests passed! The project is ready to run. ===');
console.log('To start the development server, run: npm run dev');
console.log('To build for production, run: npm run build followed by npm start');