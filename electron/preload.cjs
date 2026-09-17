const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('barmeto', { desktop: true, platform: process.platform });
