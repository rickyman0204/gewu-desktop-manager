const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ZONES_ROOT = path.join(app.getPath('userData'), 'zone-data');
const TEST_DIR = path.join(ZONES_ROOT, '图标测试');
const DATA_FILE = path.join(app.getPath('userData'), 'zones.json');

app.whenReady().then(() => {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });

  const shortcuts = [
    { name: '记事本.exe快捷方式.lnk', target: 'C:\\Windows\\notepad.exe', icon: 'C:\\Windows\\notepad.exe', iconIndex: 0 },
    { name: '计算器.exe快捷方式.lnk', target: 'C:\\Windows\\System32\\calc.exe', icon: 'C:\\Windows\\System32\\calc.exe', iconIndex: 0 },
    { name: 'Windows文件夹.lnk', target: 'C:\\Windows' },
    { name: '桌面文件夹.lnk', target: app.getPath('desktop') },
    { name: '命令提示符.lnk', target: 'C:\\Windows\\System32\\cmd.exe', icon: 'C:\\Windows\\System32\\cmd.exe', iconIndex: 0 },
    { name: '资源管理器.lnk', target: 'C:\\Windows\\explorer.exe', icon: 'C:\\Windows\\explorer.exe', iconIndex: 0 },
    { name: '画图程序.lnk', target: 'C:\\Windows\\System32\\mspaint.exe', icon: 'C:\\Windows\\System32\\mspaint.exe', iconIndex: 0 },
    { name: '系统图标库.lnk', target: 'C:\\Windows\\System32\\shell32.dll', icon: 'C:\\Windows\\System32\\shell32.dll', iconIndex: 15 }
  ];

  console.log('=== 创建测试快捷方式 ===\n');

  for (const s of shortcuts) {
    const lnkPath = path.join(TEST_DIR, s.name);
    try {
      shell.writeShortcutLink(lnkPath, 'create', {
        target: s.target,
        icon: s.icon || '',
        iconIndex: s.iconIndex || 0
      });
      console.log('OK:', s.name, '->', s.target);
    } catch (e) {
      console.log('FAIL:', s.name, '-', e.message);
    }
  }

  let zones = [];
  try {
    if (fs.existsSync(DATA_FILE)) {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      zones = d.zones || [];
    }
  } catch (e) {}

  const exists = zones.find(z => z.name === '图标测试');
  if (!exists) {
    zones.push({
      id: 'z-test-' + Date.now(),
      name: '图标测试',
      color: '#0984e3',
      bounds: { x: 100, y: 100, width: 420, height: 340 },
      iconSize: 'normal',
      createdAt: Date.now()
    });
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify({ zones }, null, 2), 'utf-8');

  console.log('\n=== 完成 ===');
  console.log('测试分区"图标测试"已创建，包含 8 个不同类型的快捷方式。');
  console.log('请运行 npx electron . 查看效果。');

  app.quit();
});
