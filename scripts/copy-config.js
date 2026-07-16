const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'config');
const destination = path.join(__dirname, '..', 'dist', 'config');

fs.mkdirSync(destination, { recursive: true });
for (const file of fs.readdirSync(source)) {
  if (file.endsWith('.json')) fs.copyFileSync(path.join(source, file), path.join(destination, file));
}
