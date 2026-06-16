/* ======================================================================
   LocalBook
   ======================================================================
   技术栈：HTML/CSS/原生 JavaScript | 数据：localStorage (JSON)
   加密：SHA-256 (哈希) + PBKDF2/AES-GCM (对称加密)
   ====================================================================== */

// ======================================================================
// 工具函数
// ======================================================================

/** 将 ArrayBuffer 转为 Hex 字符串 */
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 将 ArrayBuffer 转为 Base64 字符串 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 将 Base64 字符串转为 ArrayBuffer */
function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** 生成随机字节 */
function randomBytes(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return arr;
}

/** 生成简短 ID */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// ======================================================================
// 农历转换模块（使用 lunar-javascript 库，基于紫金山天文台数据）
// ======================================================================

const Lunar = {
  // 公历 → 农历
  solarToLunar(year, month, day) {
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const lMonth = lunar.getMonth();
    return {
      lYear: lunar.getYear(),
      lMonth: Math.abs(lMonth),
      lDay: lunar.getDay(),
      isLeap: lMonth < 0,
      monthStr: lunar.getMonthInChinese() + '月',
      dayStr: lunar.getDayInChinese(),
      ganZhi: lunar.getYearInGanZhi() + '年',
      animal: lunar.getYearShengXiao()
    };
  }
};

// ======================================================================
// 加密模块
// ======================================================================

const CryptoModule = {
  /** SHA-256 哈希，返回 Hex 字符串 */
  async hash(plaintext) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
  },

  /**
   * 使用 PBKDF2 从 Token 派生 AES-256-GCM 密钥
   * @param {string} token - 用户输入的加密令牌
   * @param {Uint8Array} salt - 随机盐值
   * @returns {CryptoKey} AES-GCM 密钥
   */
  async deriveKey(token, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(token),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  /**
   * 加密明文密码
   * @param {string} plaintext - 要加密的密码
   * @param {string} token - 加密令牌
   * @returns {Promise<{encrypted: string, iv: string, salt: string}>}
   */
  async encrypt(plaintext, token) {
    const salt = randomBytes(16);
    const iv = randomBytes(12); // AES-GCM 推荐 12 字节 IV
    const key = await this.deriveKey(token, salt);

    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(plaintext)
    );

    return {
      encrypted: bufferToBase64(encrypted),
      iv: bufferToBase64(iv),
      salt: bufferToBase64(salt)
    };
  },

  /**
   * 解密密文密码
   * @param {string} encryptedBase64 - 加密后的 Base64 数据
   * @param {string} ivBase64 - IV 的 Base64
   * @param {string} saltBase64 - 盐值的 Base64
   * @param {string} token - 加密令牌
   * @returns {Promise<string>} 解密后的明文密码
   */
  async decrypt(encryptedBase64, ivBase64, saltBase64, token) {
    const salt = base64ToBuffer(saltBase64);
    const iv = base64ToBuffer(ivBase64);
    const encryptedData = base64ToBuffer(encryptedBase64);
    const key = await this.deriveKey(token, new Uint8Array(salt));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      key,
      new Uint8Array(encryptedData)
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }
};

// ======================================================================
// 草稿自动保存（sessionStorage，关闭标签页自动清除）
// ======================================================================

const Drafts = {
  _key(k) { return 'pbook_draft_' + k; },
  save(key, data) {
    try { sessionStorage.setItem(this._key(key), JSON.stringify(data)); } catch {}
  },
  load(key) {
    try { return JSON.parse(sessionStorage.getItem(this._key(key))); } catch {}
    return null;
  },
  clear(key) {
    sessionStorage.removeItem(this._key(key));
  }
};

// ======================================================================
// IndexedDB 数据存储
// ======================================================================

const IDB_NAME = 'pbook_app';
const IDB_STORE = 'data';

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const Store = {
  _cache: null,
  _db: null,

  _default() {
    return { users: [], passwords: {}, memos: {}, stickies: {}, contacts: {} };
  },

  _ensure(data) {
    if (!data) return this._default();
    data.users ||= [];
    data.passwords ||= {};
    data.memos ||= {};
    data.stickies ||= {};
    data.contacts ||= {};
    return data;
  },

  /** 初始化：打开数据库 → 读取全部数据到内存缓存 */
  async init() {
    try {
      this._db = await _openDB();
    } catch {
      console.warn('LocalBook: IndexedDB unavailable, using in-memory storage (data lost on refresh)');
      this._cache = this._default();
      return;
    }
    const tx = this._db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get('main');
    return new Promise((resolve) => {
      req.onsuccess = () => {
        this._cache = this._ensure(req.result?.data || this._default());
        resolve();
      };
      req.onerror = () => {
        this._cache = this._default();
        resolve();
      };
    });
  },

  /** 同步读取（从内存缓存） */
  _read() {
    return this._cache || this._default();
  },

  /** 同步写入（更新缓存 + 异步写 IndexedDB） */
  _write(data) {
    this._cache = this._ensure(data);
    this._writeToDB(this._cache);
  },

  /** 异步写入 IndexedDB（立即序列化快照防竞态） */
  async _writeToDB(data) {
    if (!this._db) return;
    const snapshot = JSON.parse(JSON.stringify(data));
    try {
      const tx = this._db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({ id: 'main', data: snapshot });
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    } catch (e) {
      console.warn('LocalBook: IndexedDB write failed', e);
    }
  },

  /** 确保所有缓存已写入 IndexedDB（导出前调用） */
  async flush() {
    if (this._cache) await this._writeToDB(this._cache);
  },

  getUsers() {
    return this._read().users || [];
  },

  async saveUsers(users) {
    const data = this._read();
    data.users = users;
    this._write(data);
  },

  findUserByUsername(username) {
    return this.getUsers().find(u => u.username === username) || null;
  },

  findUserById(id) {
    return this.getUsers().find(u => u.id === id) || null;
  },

  getPasswords(userId) {
    return this._read().passwords[userId] || [];
  },

  async savePassword(userId, entry) {
    const data = this._read();
    if (!data.passwords[userId]) data.passwords[userId] = [];
    data.passwords[userId].push(entry);
    this._write(data);
  },

  async updatePassword(userId, entryId, updates) {
    const data = this._read();
    if (!data.passwords[userId]) return;
    const idx = data.passwords[userId].findIndex(p => p.id === entryId);
    if (idx === -1) return;
    data.passwords[userId][idx] = { ...data.passwords[userId][idx], ...updates };
    this._write(data);
  },

  async deletePassword(userId, passwordId) {
    const data = this._read();
    if (!data.passwords[userId]) return;
    data.passwords[userId] = data.passwords[userId].filter(p => p.id !== passwordId);
    this._write(data);
  },

  /** 获取某日备忘录 */
  getMemo(dateStr) {
    const data = this._read();
    return (data.memos && data.memos[dateStr]) || '';
  },

  /** 保存某日备忘录 */
  async saveMemo(dateStr, content) {
    const data = this._read();
    if (!data.memos) data.memos = {};
    if (content.trim()) {
      data.memos[dateStr] = content.trim();
    } else {
      delete data.memos[dateStr];
    }
    this._write(data);
  },

  /** 获取所有有备忘录的日期 */
  getAllMemoDates() {
    const data = this._read();
    return data.memos ? Object.keys(data.memos) : [];
  },

  // ---- 便签 ----

  /** 获取某用户的便签列表 */
  getStickies(userId) {
    return this._read().stickies?.[userId] || [];
  },

  /** 添加便签 */
  async addSticky(userId, sticky) {
    const data = this._read();
    if (!data.stickies) data.stickies = {};
    if (!data.stickies[userId]) data.stickies[userId] = [];
    data.stickies[userId].push(sticky);
    this._write(data);
  },

  /** 更新便签 */
  async updateSticky(userId, stickyId, updates) {
    const data = this._read();
    const list = data.stickies?.[userId];
    if (!list) return;
    const idx = list.findIndex(s => s.id === stickyId);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...updates };
    this._write(data);
  },

  /** 删除便签 */
  async deleteSticky(userId, stickyId) {
    const data = this._read();
    if (!data.stickies?.[userId]) return;
    data.stickies[userId] = data.stickies[userId].filter(s => s.id !== stickyId);
    this._write(data);
  },

  // ---- 联系人 ----

  /** 获取某用户的联系人列表 */
  getContacts(userId) {
    return this._read().contacts?.[userId] || [];
  },

  /** 添加联系人 */
  async addContact(userId, contact) {
    const data = this._read();
    if (!data.contacts) data.contacts = {};
    if (!data.contacts[userId]) data.contacts[userId] = [];
    data.contacts[userId].push(contact);
    this._write(data);
  },

  /** 更新联系人 */
  async updateContact(userId, contactId, updates) {
    const data = this._read();
    const list = data.contacts?.[userId];
    if (!list) return;
    const idx = list.findIndex(c => c.id === contactId);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...updates };
    this._write(data);
  },

  /** 删除联系人 */
  async deleteContact(userId, contactId) {
    const data = this._read();
    if (!data.contacts?.[userId]) return;
    data.contacts[userId] = data.contacts[userId].filter(c => c.id !== contactId);
    this._write(data);
  },

  /** 导出数据 → 先 flush 再下载 JSON 文件 */
  async exportData() {
    await this.flush();
    const data = this._read();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pbook_data.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  /** 导入数据 → 从 JSON 文件读取（合并策略：用户名冲突时保留缓存数据） */
  importData(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (!imported.users || !imported.passwords) {
            resolve({ success: false, message: '文件格式无效' });
            return;
          }

          const current = this._read();
          const existingUsernames = new Set(current.users.map(u => u.username));

          // 合并用户：已有用户名则跳过，新用户追加
          const addedUserIds = [];
          for (const user of imported.users) {
            if (!existingUsernames.has(user.username)) {
              current.users.push(user);
              addedUserIds.push(user.id);
            }
          }

          // 合并密码：仅合并新增用户的密码
          for (const userId of addedUserIds) {
            if (imported.passwords[userId]) {
              if (!current.passwords[userId]) current.passwords[userId] = [];
              current.passwords[userId] = current.passwords[userId].concat(imported.passwords[userId]);
            }
          }

          // 合并联系人：仅合并新增用户的联系人
          if (imported.contacts) {
            if (!current.contacts) current.contacts = {};
            for (const userId of addedUserIds) {
              if (imported.contacts[userId]) {
                if (!current.contacts[userId]) current.contacts[userId] = [];
                current.contacts[userId] = current.contacts[userId].concat(imported.contacts[userId]);
              }
            }
          }

          // 合并便签：仅合并新增用户的便签
          if (imported.stickies) {
            if (!current.stickies) current.stickies = {};
            for (const userId of addedUserIds) {
              if (imported.stickies[userId]) {
                if (!current.stickies[userId]) current.stickies[userId] = [];
                current.stickies[userId] = current.stickies[userId].concat(imported.stickies[userId]);
              }
            }
          }

          // 合并备忘录：已有日期不覆盖，仅补充新日期
          if (imported.memos) {
            if (!current.memos) current.memos = {};
            for (const [dateStr, content] of Object.entries(imported.memos)) {
              if (!(dateStr in current.memos)) {
                current.memos[dateStr] = content;
              }
            }
          }

          this._write(current);
          resolve({ success: true });
        } catch {
          resolve({ success: false, message: '文件解析失败，请检查 JSON 格式' });
        }
      };
      reader.readAsText(file);
    });
  }
};

// ======================================================================
// 应用状态
// ======================================================================

const AppState = {
  currentUser: null,       // { id, username, ... }
  decryptTarget: null,     // 当前要解密的密码条目

  /** 设置当前用户 */
  setUser(user) {
    this.currentUser = user;
    if (user) {
      sessionStorage.setItem('pbook_session', JSON.stringify({ id: user.id, username: user.username }));
    } else {
      sessionStorage.removeItem('pbook_session');
    }
  },

  /** 从 Session 恢复登录状态 */
  restoreSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('pbook_session'));
      if (saved && saved.id) {
        const user = Store.findUserById(saved.id);
        if (user) {
          this.currentUser = user;
          return true;
        }
      }
    } catch {}
    return false;
  }
};

// ======================================================================
// 日历模块
// ======================================================================

const Calendar = {
  year: 0,
  month: 0,   // 0-based

  init() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
  },

  render() {
    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    document.getElementById('calendarTitle').textContent = `${this.year}年 ${monthNames[this.month]}`;

    const firstDay = new Date(this.year, this.month, 1).getDay();
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const today = new Date();
    const memoDates = Store.getAllMemoDates();

    let html = '<tr>';
    for (let i = 0; i < firstDay; i++) {
      html += '<td class="cal-empty"></td>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const y = this.year;
      const m = String(this.month + 1).padStart(2, '0');
      const day = String(d).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;
      const hasMemo = memoDates.includes(dateStr);
      const isToday = today.getFullYear() === this.year
                   && today.getMonth() === this.month
                   && today.getDate() === d;
      html += `<td class="cal-day${isToday ? ' today' : ''}" data-date="${dateStr}">`;
      html +=   `<span class="cal-day-num">${d}</span>`;
      const lunar = Lunar.solarToLunar(this.year, this.month + 1, d);
      html +=   `<span class="cal-day-lunar">${lunar.monthStr}${lunar.dayStr}</span>`;
      if (hasMemo) html += '<span class="cal-dot"></span>';
      html += '</td>';
      if ((firstDay + d) % 7 === 0 && d < daysInMonth) html += '</tr><tr>';
    }
    html += '</tr>';
    document.getElementById('calendarBody').innerHTML = html;

    // 绑定日期点击
    document.querySelectorAll('.cal-day').forEach(el => {
      el.addEventListener('click', () => this.openEditor(el.dataset.date));
    });
  },

  prevMonth() {
    this.month--;
    if (this.month < 0) { this.month = 11; this.year--; }
    this.render();
  },

  nextMonth() {
    this.month++;
    if (this.month > 11) { this.month = 0; this.year++; }
    this.render();
  },

  openEditor(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const weekNames = ['日','一','二','三','四','五','六'];
    const lunar = Lunar.solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const lunarStr = lunar.monthStr + lunar.dayStr;
    const label = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${weekNames[d.getDay()]}`;
    document.getElementById('memoDateLabel').textContent = label;
    document.getElementById('memoModalTitle').textContent = `${label} 农历${lunarStr}`;
    // 优先恢复草稿
    const saved = Store.getMemo(dateStr);
    const draft = Drafts.load('memo');
    document.getElementById('memoContent').value = (draft && draft.date === dateStr) ? draft.content : saved;
    document.getElementById('memoModal').dataset.date = dateStr;
    document.getElementById('memoModal').style.display = 'flex';
    document.getElementById('memoContent').focus();
  }
};

// ======================================================================
// 认证模块
// ======================================================================

const Auth = {
  /**
   * 注册新用户
   * @param {string} username
   * @param {string} password - 登录密码
   * @param {string} token - 加密令牌
   * @returns {{ success: boolean, message: string }}
   */
  async register(username, password, token) {
    // 校验
    if (!username.trim() || !password.trim() || !token.trim()) {
      return { success: false, message: '所有字段不能为空' };
    }
    if (username.trim().length < 2) {
      return { success: false, message: '用户名至少需要 2 个字符' };
    }
    if (password.length < 4) {
      return { success: false, message: '登录密码至少需要 4 个字符' };
    }
    if (token.length < 4) {
      return { success: false, message: '加密令牌至少需要 4 个字符' };
    }

    // 检查用户名是否已存在
    const existing = Store.findUserByUsername(username.trim());
    if (existing) {
      return { success: false, message: '用户名已存在' };
    }

    // 哈希密码和令牌
    const passwordHash = await CryptoModule.hash(password);
    const tokenHash = await CryptoModule.hash(token);

    const newUser = {
      id: generateId(),
      username: username.trim(),
      passwordHash,
      tokenHash,
      createdAt: new Date().toISOString()
    };

    const users = Store.getUsers();
    users.push(newUser);
    await Store.saveUsers(users);

    return { success: true, message: '注册成功' };
  },

  /**
   * 用户登录
   * @param {string} username
   * @param {string} password
   * @returns {{ success: boolean, message: string, user?: object }}
   */
  async login(username, password) {
    if (!username.trim() || !password.trim()) {
      return { success: false, message: '请输入用户名和密码' };
    }

    const user = Store.findUserByUsername(username.trim());
    if (!user) {
      return { success: false, message: '用户名或密码错误' };
    }

    const passwordHash = await CryptoModule.hash(password);
    if (passwordHash !== user.passwordHash) {
      return { success: false, message: '用户名或密码错误' };
    }

    return { success: true, message: '登录成功', user };
  },

  /**
   * 验证 Token 是否正确
   * @param {string} token
   * @param {string} tokenHash
   * @returns {Promise<boolean>}
   */
  async verifyToken(token, tokenHash) {
    const hash = await CryptoModule.hash(token);
    return hash === tokenHash;
  }
};

// ======================================================================
// 密码管理模块
// ======================================================================

const PasswordManager = {
  /**
   * 新增密码
   */
  async add(userId, name, address, username, password, token) {
    if (!name.trim() || !address.trim() || !username.trim() || !password.trim()) {
      return { success: false, message: '所有字段不能为空' };
    }

    try {
      const { encrypted, iv, salt } = await CryptoModule.encrypt(password, token);

      const entry = {
        id: generateId(),
        userId,
        name: name.trim(),
        address: address.trim(),
        username: username.trim(),
        encrypted,
        iv,
        salt,
        createdAt: new Date().toISOString()
      };

      await Store.savePassword(userId, entry);
      return { success: true, message: '密码已保存', entry };
    } catch (err) {
      return { success: false, message: '加密失败：' + err.message };
    }
  },

  /**
   * 获取某个用户的所有密码
   */
  list(userId) {
    return Store.getPasswords(userId);
  },

  /**
   * 修改密码（名称 / 地址 / 用户名 / 密码 — 重新加密）
   */
  async update(userId, entryId, name, address, username, password, token) {
    if (!name.trim() || !address.trim() || !username.trim() || !password.trim()) {
      return { success: false, message: '所有字段不能为空' };
    }

    try {
      const { encrypted, iv, salt } = await CryptoModule.encrypt(password, token);
      await Store.updatePassword(userId, entryId, {
        name: name.trim(),
        address: address.trim(),
        username: username.trim(),
        encrypted,
        iv,
        salt
      });
      return { success: true, message: '密码已更新' };
    } catch (err) {
      return { success: false, message: '加密失败：' + err.message };
    }
  },

  /**
   * 删除密码
   */
  async delete(userId, passwordId) {
    await Store.deletePassword(userId, passwordId);
  },

  /**
   * 解密密码
   */
  async decrypt(entry, token) {
    try {
      const plaintext = await CryptoModule.decrypt(
        entry.encrypted,
        entry.iv,
        entry.salt,
        token
      );
      return { success: true, data: plaintext };
    } catch (err) {
      return { success: false, message: '解密失败：Token 错误或数据已损坏' };
    }
  }
};

// ======================================================================
// UI 控制器
// ======================================================================

const UI = {
  // ---- DOM 引用 ----
  elements: {},

  /** 初始化 DOM 引用 */
  initElements() {
    const $ = (id) => document.getElementById(id);
    this.elements = {
      // Pages
      authPage: $('authPage'),
      managePage: $('managePage'),

      // Auth forms
      loginForm: $('loginForm'),
      registerForm: $('registerForm'),
      showRegister: $('showRegister'),
      showLogin: $('showLogin'),
      authImportBtn: $('authImportBtn'),
      authImportFileInput: $('authImportFileInput'),

      // Login fields
      loginUsername: $('loginUsername'),
      loginPassword: $('loginPassword'),
      rememberMe: $('rememberMe'),

      // Register fields
      regUsername: $('regUsername'),
      regPassword: $('regPassword'),
      regToken: $('regToken'),
      regConfirmToken: $('regConfirmToken'),

      // Manage page
      displayUser: $('displayUser'),
      versionBadge: $('versionBadge'),
      headerClock: $('headerClock'),
      logoutBtn: $('logoutBtn'),
      exportBtn: $('exportBtn'),
      addBtn: $('addBtn'),
      emptyState: $('emptyState'),
      tableWrapper: $('tableWrapper'),
      passwordList: $('passwordList'),

      // Add modal
      addModal: $('addModal'),
      addModalTitle: $('addModalTitle'),
      addEntryId: $('addEntryId'),
      addName: $('addName'),
      addAddress: $('addAddress'),
      addUsername: $('addUsername'),
      addPassword: $('addPassword'),
      addToken: $('addToken'),
      addPasswordForm: $('addPasswordForm'),
      closeAddModal: $('closeAddModal'),
      cancelAdd: $('cancelAdd'),

      // Decrypt modal
      decryptModal: $('decryptModal'),
      decryptAddress: $('decryptAddress'),
      decryptName: $('decryptName'),
      decryptUser: $('decryptUser'),
      decryptToken: $('decryptToken'),
      decryptForm: $('decryptForm'),
      decryptSubmit: $('decryptSubmit'),
      decryptResult: $('decryptResult'),
      decryptedPassword: $('decryptedPassword'),
      hidePasswordBtn: $('hidePasswordBtn'),
      decryptError: $('decryptError'),
      closeDecryptModal: $('closeDecryptModal'),

      // Sidebar nav
      sidebarNav: document.querySelector('.sidebar-nav'),
      passwordsView: $('passwordsView'),
      memosView: $('memosView'),

      // Calendar
      prevMonth: $('prevMonth'),
      nextMonth: $('nextMonth'),
      todayMemoContent: $('todayMemoContent'),
      todayMemoDate: $('todayMemoDate'),

      // Memo modal
      memoModal: $('memoModal'),
      closeMemoModal: $('closeMemoModal'),
      cancelMemo: $('cancelMemo'),
      saveMemoBtn: $('saveMemoBtn'),
      memoContent: $('memoContent'),

      // Stickies
      stickiesView: $('stickiesView'),
      stickyEmpty: $('stickyEmpty'),
      stickyList: $('stickyList'),
      addStickyBtn: $('addStickyBtn'),

      // Sticky modal
      stickyModal: $('stickyModal'),
      stickyModalTitle: $('stickyModalTitle'),
      stickyId: $('stickyId'),
      stickyTitle: $('stickyTitle'),
      stickyContent: $('stickyContent'),
      stickyForm: $('stickyForm'),
      closeStickyModal: $('closeStickyModal'),
      cancelSticky: $('cancelSticky'),
      stickyColorPicker: $('stickyColorPicker'),

      // Contacts
      contactsView: $('contactsView'),
      contactEmpty: $('contactEmpty'),
      contactList: $('contactList'),
      contactSearch: $('contactSearch'),
      addContactBtn: $('addContactBtn'),

      // Contact modal
      contactModal: $('contactModal'),
      contactModalTitle: $('contactModalTitle'),
      contactId: $('contactId'),
      contactName: $('contactName'),
      contactNickname: $('contactNickname'),
      contactPhone: $('contactPhone'),
      contactLandline: $('contactLandline'),
      contactEmail: $('contactEmail'),
      contactAge: $('contactAge'),
      contactGender: $('contactGender'),
      contactAddress: $('contactAddress'),
      contactNote: $('contactNote'),
      contactForm: $('contactForm'),
      closeContactModal: $('closeContactModal'),
      cancelContact: $('cancelContact'),
      saveContactBtn: $('saveContactBtn')
    };
  },

  /** Toast 通知 */
  toast(message, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 2500);
  },

  // ========== 日期显示 ==========

  _clockTimer: null,

  /** 启动顶部时钟（每秒更新） */
  startClock() {
    const el = this.elements.headerClock;
    if (!el) return;
    const tick = () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      el.textContent = `${now.getFullYear()}年${pad(now.getMonth()+1)}月${pad(now.getDate())}日 星期${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };
    tick();
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(tick, 1000);
  },

  // ========== 页面切换 ==========

  /** 显示版本号 */
  loadVersion() {
    const el = this.elements.versionBadge;
    if (el) el.textContent = 'v1.3.0';
  },

  // ========== 联系人 ==========

  /** 渲染联系人列表 */
  renderContacts(keyword) {
    const els = this.elements;
    const userId = AppState.currentUser?.id;
    if (!userId) return;
    let list = Store.getContacts(userId);
    keyword = (keyword || '').trim().toLowerCase();
    if (keyword) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(keyword) ||
        (c.nickname || '').toLowerCase().includes(keyword) ||
        (c.phone || '').toLowerCase().includes(keyword) ||
        (c.landline || '').toLowerCase().includes(keyword) ||
        (c.email || '').toLowerCase().includes(keyword) ||
        (c.address || '').toLowerCase().includes(keyword) ||
        (c.note || '').toLowerCase().includes(keyword)
      );
    }
    els.contactEmpty.style.display = list.length ? 'none' : '';
    els.contactList.style.display = list.length ? '' : 'none';

    let html = '';
    for (const c of list) {
      const info = [];
      if (c.phone) info.push({ label: '📞', text: c.phone });
      if (c.landline) info.push({ label: '☎', text: c.landline });
      if (c.email) info.push({ label: '✉', text: c.email });
      if (c.address) info.push({ label: '📍', text: c.address });
      if (c.age) info.push({ label: '🎂', text: c.age + '岁' });

      html += `<div class="contact-card" data-id="${c.id}">`;
      html += `<div class="contact-card-header">`;
      html +=   `<div class="contact-card-name">${this._esc(c.name)}`;
      if (c.nickname) html += `<small>${this._esc(c.nickname)}</small>`;
      if (c.gender) html += `<span class="contact-card-gender">${c.gender}</span>`;
      html +=   `</div>`;
      html +=   `<div class="contact-card-actions">`;
      html +=     `<button class="btn btn-outline contact-edit">编辑</button>`;
      html +=     `<button class="btn btn-outline contact-del" style="color:var(--danger);border-color:var(--danger);">删除</button>`;
      html +=   `</div>`;
      html += `</div>`;
      html += `<div class="contact-card-body">`;
      for (const row of info) {
        html += `<div class="row"><span class="label">${row.label}</span>${this._esc(row.text)}</div>`;
      }
      if (c.note) html += `<div class="row" style="margin-top:0.25rem;font-size:0.78rem;color:var(--text-tertiary);">💬 ${this._esc(c.note)}</div>`;
      html += `</div></div>`;
    }
    els.contactList.innerHTML = html;

    // 绑定编辑
    els.contactList.querySelectorAll('.contact-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.contact-card').dataset.id;
        const contact = list.find(c => c.id === id);
        if (contact) this.openContactEditor(contact);
      });
    });
    // 绑定删除
    els.contactList.querySelectorAll('.contact-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.contact-card').dataset.id;
        if (confirm('确定删除该联系人吗？')) {
          Store.deleteContact(userId, id).then(() => this.renderContacts());
        }
      });
    });
  },

  /** 打开联系人编辑模态框（null=新增） */
  openContactEditor(contact) {
    const els = this.elements;
    els.contactModalTitle.textContent = contact ? '编辑联系人' : '新增联系人';
    els.contactId.value = contact ? contact.id : '';
    els.contactName.value = contact ? contact.name : '';
    els.contactNickname.value = contact ? (contact.nickname || '') : '';
    els.contactPhone.value = contact ? (contact.phone || '') : '';
    els.contactLandline.value = contact ? (contact.landline || '') : '';
    els.contactEmail.value = contact ? (contact.email || '') : '';
    els.contactAge.value = contact ? (contact.age || '') : '';
    els.contactGender.value = contact ? (contact.gender || '') : '';
    els.contactAddress.value = contact ? (contact.address || '') : '';
    els.contactNote.value = contact ? (contact.note || '') : '';
    els.contactModal.style.display = 'flex';
    els.contactName.focus();
  },

  _esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  // ========== 便签 ==========

  /** 渲染便签列表 */
  renderStickies() {
    const els = this.elements;
    const userId = AppState.currentUser?.id;
    if (!userId) return;
    const list = Store.getStickies(userId);
    els.stickyEmpty.style.display = list.length ? 'none' : '';
    els.stickyList.style.display = list.length ? '' : 'none';

    let html = '';
    for (const s of list) {
      const color = s.color || '#fff9c4';
      const titleHtml = s.title ? `<div class="sticky-card-title">${this._esc(s.title)}</div>` : '';
      const dateStr = s.updatedAt || s.createdAt || '';
      const dateLabel = dateStr ? new Date(dateStr).toLocaleDateString('zh-CN') : '';
      html += `<div class="sticky-card" style="background:${color};" data-id="${s.id}">`;
      html +=   titleHtml;
      html +=   `<div class="sticky-card-content">${this._esc(s.content)}</div>`;
      html +=   `<div class="sticky-card-footer">`;
      html +=     `<span class="sticky-card-date">${this._esc(dateLabel)}</span>`;
      html +=     `<div class="sticky-card-actions">`;
      html +=       `<button class="btn sticky-edit">编辑</button>`;
      html +=       `<button class="btn sticky-del">删除</button>`;
      html +=     `</div>`;
      html +=   `</div>`;
      html += `</div>`;
    }
    els.stickyList.innerHTML = html;

    // 绑定编辑
    els.stickyList.querySelectorAll('.sticky-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.sticky-card');
        const id = card.dataset.id;
        const sticky = list.find(s => s.id === id);
        if (sticky) this.openStickyEditor(sticky);
      });
    });
    // 绑定删除
    els.stickyList.querySelectorAll('.sticky-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.sticky-card').dataset.id;
        if (confirm('确定删除该便签吗？')) {
          Store.deleteSticky(userId, id).then(() => this.renderStickies());
        }
      });
    });
  },

  /** 打开便签编辑模态框（null=新增） */
  openStickyEditor(sticky) {
    const els = this.elements;
    const draft = sticky ? null : Drafts.load('sticky');
    els.stickyModalTitle.textContent = sticky ? '编辑便签' : '新增便签';
    els.stickyId.value = sticky ? sticky.id : '';
    els.stickyTitle.value = sticky ? (sticky.title || '') : (draft?.title || '');
    els.stickyContent.value = sticky ? (sticky.content || '') : (draft?.content || '');
    // 设置颜色
    const color = sticky ? (sticky.color || '#fff9c4') : (draft?.color || '#fff9c4');
    const colorRadio = els.stickyColorPicker.querySelector(`input[value="${color}"]`);
    if (colorRadio) colorRadio.checked = true;
    els.stickyModal.style.display = 'flex';
    els.stickyTitle.focus();
  },

  /** 处理便签表单提交 */
  async handleStickyFormSubmit(e) {
    e.preventDefault();
    const els = this.elements;
    const userId = AppState.currentUser?.id;
    if (!userId) return;

    const id = els.stickyId.value;
    const title = els.stickyTitle.value.trim();
    const content = els.stickyContent.value.trim();
    const color = els.stickyColorPicker.querySelector('input[name="stickyColor"]:checked')?.value || '#fff9c4';

    if (!content) {
      this.toast('请输入便签内容', 'error');
      return;
    }

    const now = new Date().toISOString();
    Drafts.clear('sticky');
    if (id) {
      await Store.updateSticky(userId, id, { title, content, color, updatedAt: now });
      this.toast('便签已更新');
    } else {
      const sticky = {
        id: generateId(),
        title,
        content,
        color,
        createdAt: now,
        updatedAt: now
      };
      await Store.addSticky(userId, sticky);
      this.toast('便签已添加');
    }
    els.stickyModal.style.display = 'none';
    if (els.stickiesView.style.display !== 'none') this.renderStickies();
  },

  /** 切换到管理页面 */
  showManagePage(user) {
    const els = this.elements;
    els.authPage.classList.remove('active');
    els.managePage.classList.add('active');
    els.displayUser.textContent = user.username;

    this.loadVersion();
    this.startClock();
    Calendar.init();

    this.switchTab('passwords');
    this.renderPasswordList();
  },

  /** 切换导航项 */
  switchTab(tab) {
    const els = this.elements;
    document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');

    // 全部隐藏
    els.passwordsView.style.display = 'none';
    els.memosView.style.display = 'none';
    els.stickiesView.style.display = 'none';
    els.contactsView.style.display = 'none';
    els.addBtn.style.display = 'none';
    els.addStickyBtn.style.display = 'none';
    els.addContactBtn.style.display = 'none';

    if (tab === 'passwords') {
      els.passwordsView.style.display = 'block';
      els.addBtn.style.display = '';
    } else if (tab === 'stickies') {
      els.stickiesView.style.display = 'block';
      els.addStickyBtn.style.display = '';
      this.renderStickies();
    } else if (tab === 'contacts') {
      els.contactsView.style.display = 'block';
      els.addContactBtn.style.display = '';
      this.renderContacts(els.contactSearch.value);
    } else {
      els.memosView.style.display = 'block';
      Calendar.render();
      this.renderTodayMemo();
    }
  },

  /** 渲染今日备忘录面板 */
  renderTodayMemo() {
    const els = this.elements;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const content = Store.getMemo(today);
    const weekNames = ['日','一','二','三','四','五','六'];
    els.todayMemoDate.textContent = `${today} 星期${weekNames[now.getDay()]}`;
    els.todayMemoContent.innerHTML = content
      ? this._esc(content).replace(/\n/g, '<br>')
      : '<span class="today-memo-empty">今日暂无备忘录</span>';
  },

  /** 切换到登录/注册页面 */
  showAuthPage() {
    const els = this.elements;
    els.authPage.classList.add('active');
    els.managePage.classList.remove('active');
  },

  // ========== 表单切换 ==========

  /** 显示登录表单 */
  showLoginForm() {
    this.elements.registerForm.classList.remove('active-form');
    this.elements.loginForm.classList.add('active-form');
  },

  /** 显示注册表单 */
  showRegisterForm() {
    this.elements.loginForm.classList.remove('active-form');
    this.elements.registerForm.classList.add('active-form');
  },

  // ========== 密码列表渲染 ==========

  /** 渲染密码列表 */
  renderPasswordList() {
    const els = this.elements;
    const user = AppState.currentUser;
    if (!user) return;

    const passwords = PasswordManager.list(user.id);

    if (passwords.length === 0) {
      els.emptyState.style.display = 'block';
      els.tableWrapper.style.display = 'none';
      return;
    }

    els.emptyState.style.display = 'none';
    els.tableWrapper.style.display = 'block';

    els.passwordList.innerHTML = passwords.map(p => `
      <tr>
        <td>${this.escapeHtml(p.name || '')}</td>
        <td>${this.escapeHtml(p.address)}</td>
        <td>${this.escapeHtml(p.username)}</td>
        <td>
          <button class="btn btn-outline edit-btn" data-id="${p.id}" style="width:auto;font-size:0.82rem;padding:0.3rem 0.7rem;">编辑</button>
          <button class="btn btn-outline decrypt-btn" data-id="${p.id}" style="width:auto;font-size:0.82rem;padding:0.3rem 0.7rem;">解密</button>
          <button class="btn btn-danger delete-btn" data-id="${p.id}" style="width:auto;font-size:0.82rem;padding:0.3rem 0.7rem;">删除</button>
        </td>
      </tr>
    `).join('');

    // 绑定事件
    els.passwordList.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const entry = passwords.find(p => p.id === btn.dataset.id);
        if (entry) this.openAddModal(entry);
      });
    });
    els.passwordList.querySelectorAll('.decrypt-btn').forEach(btn => {
      btn.addEventListener('click', () => this.openDecryptModal(btn.dataset.id));
    });
    els.passwordList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleDelete(btn.dataset.id));
    });
  },

  /** HTML 转义 */
  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  // ========== 新增密码模态框 ==========

  /** 打开新增密码模态框（entry 不为空时为编辑模式） */
  openAddModal(entry) {
    const els = this.elements;
    const editing = !!entry;
    els.addEntryId.value = entry ? entry.id : '';
    els.addModalTitle.textContent = editing ? '编辑密码' : '新增密码';
    els.addName.value = entry ? (entry.name || '') : '';
    els.addAddress.value = entry ? entry.address : '';
    els.addAddress.disabled = editing;
    els.addUsername.value = entry ? entry.username : '';
    els.addUsername.disabled = editing;
    els.addPassword.value = '';
    els.addToken.value = '';
    els.addModal.style.display = 'flex';
    els.addName.focus();
  },

  /** 关闭新增密码模态框 */
  closeAddModal() {
    this.elements.addModal.style.display = 'none';
  },

  /** 处理新增/编辑密码提交 */
  async handleAddPassword(e) {
    e.preventDefault();
    const els = this.elements;
    const user = AppState.currentUser;
    if (!user) return;

    const entryId = els.addEntryId.value;
    const name = els.addName.value;
    const address = els.addAddress.value;
    const username = els.addUsername.value;
    const password = els.addPassword.value;
    const token = els.addToken.value;

    if (!token.trim()) {
      this.toast('请输入加密令牌', 'error');
      return;
    }

    // 验证 token 是否正确
    const tokenValid = await Auth.verifyToken(token, user.tokenHash);
    if (!tokenValid) {
      this.toast('加密令牌错误', 'error');
      return;
    }

    const editing = !!entryId;
    const result = editing
      ? await PasswordManager.update(user.id, entryId, name, address, username, password, token)
      : await PasswordManager.add(user.id, name, address, username, password, token);

    if (result.success) {
      this.toast(editing ? '密码已更新' : '密码已保存');
      this.closeAddModal();
      this.renderPasswordList();
    } else {
      this.toast(result.message, 'error');
    }
  },

  // ========== 解密模态框 ==========

  /** 打开解密模态框 */
  openDecryptModal(passwordId) {
    const els = this.elements;
    const user = AppState.currentUser;
    if (!user) return;

    const passwords = PasswordManager.list(user.id);
    const entry = passwords.find(p => p.id === passwordId);
    if (!entry) {
      this.toast('未找到该密码记录', 'error');
      return;
    }

    AppState.decryptTarget = entry;
    els.decryptName.textContent = entry.name || '';
    els.decryptAddress.textContent = entry.address;
    els.decryptUser.textContent = entry.username;
    els.decryptToken.value = '';
    els.decryptResult.style.display = 'none';
    els.decryptError.style.display = 'none';
    els.decryptSubmit.disabled = false;
    els.decryptSubmit.textContent = '验证并解密';
    els.decryptModal.style.display = 'flex';
    els.decryptToken.focus();
  },

  /** 关闭解密模态框 */
  closeDecryptModal() {
    this.elements.decryptModal.style.display = 'none';
    AppState.decryptTarget = null;
  },

  /** 处理解密提交 */
  async handleDecrypt(e) {
    e.preventDefault();
    const els = this.elements;
    const entry = AppState.decryptTarget;
    const user = AppState.currentUser;
    if (!entry || !user) return;

    const token = els.decryptToken.value;
    if (!token) {
      els.decryptError.textContent = '请输入加密令牌';
      els.decryptError.style.display = 'block';
      els.decryptResult.style.display = 'none';
      return;
    }

    // 验证 token
    els.decryptSubmit.disabled = true;
    els.decryptSubmit.textContent = '验证中...';

    const tokenValid = await Auth.verifyToken(token, user.tokenHash);
    if (!tokenValid) {
      els.decryptError.textContent = 'Token 错误，请重试';
      els.decryptError.style.display = 'block';
      els.decryptResult.style.display = 'none';
      els.decryptSubmit.disabled = false;
      els.decryptSubmit.textContent = '验证并解密';
      return;
    }

    // 解密
    const result = await PasswordManager.decrypt(entry, token);
    if (result.success) {
      els.decryptError.style.display = 'none';
      els.decryptResult.style.display = 'block';
      els.decryptedPassword.textContent = result.data;
      els.decryptSubmit.textContent = '解密成功';
      setTimeout(() => {
        els.decryptSubmit.disabled = false;
        els.decryptSubmit.textContent = '验证并解密';
      }, 1500);
    } else {
      els.decryptError.textContent = result.message;
      els.decryptError.style.display = 'block';
      els.decryptResult.style.display = 'none';
      els.decryptSubmit.disabled = false;
      els.decryptSubmit.textContent = '验证并解密';
    }
  },

  /** 隐藏解密结果 */
  hideDecryptResult() {
    const els = this.elements;
    els.decryptResult.style.display = 'none';
    els.decryptedPassword.textContent = '';
  },

  // ========== 删除密码 ==========

  /** 处理删除密码 */
  async handleDelete(passwordId) {
    const user = AppState.currentUser;
    if (!user) return;

    if (!confirm('确定要删除这条密码记录吗？')) return;

    await PasswordManager.delete(user.id, passwordId);
    this.toast('密码已删除');
    this.renderPasswordList();
  },

  // ========== 绑定事件 ==========

  /** 绑定所有事件 */
  bindEvents() {
    const els = this.elements;

    // 登录/注册切换
    els.showRegister.addEventListener('click', (e) => { e.preventDefault(); this.showRegisterForm(); });
    els.showLogin.addEventListener('click', (e) => { e.preventDefault(); this.showLoginForm(); });

    // 登录提交
    els.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = els.loginUsername.value;
      const password = els.loginPassword.value;
      const result = await Auth.login(username, password);
      if (result.success) {
        // 记住密码
        if (els.rememberMe.checked) {
          localStorage.setItem('pbook_remember', btoa(encodeURIComponent(JSON.stringify({ username, password }))));
        } else {
          localStorage.removeItem('pbook_remember');
        }
        AppState.setUser(result.user);
        this.showManagePage(result.user);
        this.toast('登录成功');
      } else {
        this.toast(result.message, 'error');
      }
    });

    // 注册提交
    els.registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = els.regUsername.value;
      const password = els.regPassword.value;
      const token = els.regToken.value;
      const confirmToken = els.regConfirmToken.value;

      if (token !== confirmToken) {
        this.toast('两次输入的令牌不一致', 'error');
        return;
      }

      const result = await Auth.register(username, password, token);
      if (result.success) {
        this.toast('注册成功，请登录');
        this.showLoginForm();
        els.loginUsername.value = username;
        els.loginPassword.value = '';
        // 清空注册表单
        els.regUsername.value = '';
        els.regPassword.value = '';
        els.regToken.value = '';
        els.regConfirmToken.value = '';
      } else {
        this.toast(result.message, 'error');
      }
    });

    // 退出登录
    els.logoutBtn.addEventListener('click', () => {
      AppState.setUser(null);
      this.showAuthPage();
      this.toast('已退出登录');
    });

    // 导出
    els.exportBtn.addEventListener('click', async () => {
      await Store.exportData();
      UI.toast('数据已导出');
    });

    // 侧边栏导航切换
    if (els.sidebarNav) {
      els.sidebarNav.addEventListener('click', (e) => {
        const navItem = e.target.closest('.nav-item');
        if (navItem) this.switchTab(navItem.dataset.tab);
      });
    }

    // 日历导航
    els.prevMonth.addEventListener('click', () => Calendar.prevMonth());
    els.nextMonth.addEventListener('click', () => Calendar.nextMonth());

    // 备忘录编辑 — 关闭时自动保存草稿
    function _closeMemoModal() {
      const dateStr = els.memoModal.dataset.date;
      const content = els.memoContent.value.trim();
      if (content) Drafts.save('memo', { date: dateStr, content });
      els.memoModal.style.display = 'none';
    }
    els.closeMemoModal.addEventListener('click', _closeMemoModal);
    els.cancelMemo.addEventListener('click', _closeMemoModal);
    els.memoModal.addEventListener('click', (e) => {
      if (e.target === els.memoModal) _closeMemoModal();
    });
    els.saveMemoBtn.addEventListener('click', async () => {
      const dateStr = els.memoModal.dataset.date;
      const content = els.memoContent.value;
      await Store.saveMemo(dateStr, content);
      Drafts.clear('memo');
      els.memoModal.style.display = 'none';
      this.toast('备忘录已保存');
      Calendar.render();
      this.renderTodayMemo();
    });

    // 便签新增
    els.addStickyBtn.addEventListener('click', () => this.openStickyEditor(null));

    // 便签模态框 — 关闭时自动保存草稿
    function _closeStickyModal() {
      const title = els.stickyTitle.value.trim();
      const content = els.stickyContent.value.trim();
      if (title || content) {
        Drafts.save('sticky', {
          title,
          content,
          color: els.stickyColorPicker.querySelector('input[name="stickyColor"]:checked')?.value || '#fff9c4'
        });
      }
      els.stickyModal.style.display = 'none';
    }
    els.closeStickyModal.addEventListener('click', _closeStickyModal);
    els.cancelSticky.addEventListener('click', _closeStickyModal);
    els.stickyModal.addEventListener('click', (e) => {
      if (e.target === els.stickyModal) _closeStickyModal();
    });
    els.stickyForm.addEventListener('submit', (e) => this.handleStickyFormSubmit(e));

    // 联系人搜索
    els.contactSearch.addEventListener('input', () => this.renderContacts(els.contactSearch.value));

    // 联系人新增
    els.addContactBtn.addEventListener('click', () => this.openContactEditor(null));

    // 联系人表单提交
    els.contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = AppState.currentUser?.id;
      if (!userId) return;
      const id = els.contactId.value;
      const data = {
        name: els.contactName.value.trim(),
        nickname: els.contactNickname.value.trim(),
        phone: els.contactPhone.value.trim(),
        landline: els.contactLandline.value.trim(),
        email: els.contactEmail.value.trim(),
        age: els.contactAge.value ? Number(els.contactAge.value) : 0,
        gender: els.contactGender.value,
        address: els.contactAddress.value.trim(),
        note: els.contactNote.value.trim()
      };
      if (!data.name) { this.toast('请输入姓名', 'error'); return; }
      if (id) {
        await Store.updateContact(userId, id, data);
        this.toast('联系人已更新');
      } else {
        data.id = generateId();
        await Store.addContact(userId, data);
        this.toast('联系人已添加');
      }
      els.contactModal.style.display = 'none';
      if (els.contactsView.style.display !== 'none') this.renderContacts();
    });

    // 联系人模态框关闭
    els.closeContactModal.addEventListener('click', () => { els.contactModal.style.display = 'none'; });
    els.cancelContact.addEventListener('click', () => { els.contactModal.style.display = 'none'; });
    els.contactModal.addEventListener('click', (e) => {
      if (e.target === els.contactModal) els.contactModal.style.display = 'none';
    });

    // 登录页导入
    els.authImportBtn.addEventListener('click', () => els.authImportFileInput.click());
    els.authImportFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const result = await Store.importData(file);
      if (result.success) {
        this.toast('数据导入成功，请登录');
      } else {
        this.toast(result.message, 'error');
      }
      els.authImportFileInput.value = '';
    });

    // 新增密码
    els.addBtn.addEventListener('click', () => this.openAddModal());
    els.closeAddModal.addEventListener('click', () => this.closeAddModal());
    els.cancelAdd.addEventListener('click', () => this.closeAddModal());
    els.addPasswordForm.addEventListener('submit', (e) => this.handleAddPassword(e));

    // 解密相关
    els.closeDecryptModal.addEventListener('click', () => this.closeDecryptModal());
    els.decryptForm.addEventListener('submit', (e) => this.handleDecrypt(e));
    els.hidePasswordBtn.addEventListener('click', () => this.hideDecryptResult());

    // 点击遮罩关闭模态框
    els.addModal.addEventListener('click', (e) => {
      if (e.target === els.addModal) this.closeAddModal();
    });
    els.decryptModal.addEventListener('click', (e) => {
      if (e.target === els.decryptModal) this.closeDecryptModal();
    });

    // Enter 键提交支持
    els.decryptToken.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.decryptForm.dispatchEvent(new Event('submit'));
      }
    });
  }
};

// ======================================================================
// Sakura 春天动态背景
// ======================================================================

const Sakura = {
  canvas: null,
  ctx: null,
  petals: [],
  animId: null,
  count: 28,

  // 春天粉色系
  colors: [
    { r: 255, g: 183, b: 197 },
    { r: 255, g: 155, b: 180 },
    { r: 252, g: 200, b: 212 },
    { r: 255, g: 218, b: 224 },
    { r: 248, g: 228, b: 236 },
    { r: 255, g: 240, b: 245 },
  ],

  init() {
    this.canvas = document.getElementById('sakuraCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.createPetals();
    this.animate();
  },

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  createPetals() {
    this.petals = [];
    for (let i = 0; i < this.count; i++) {
      this.petals.push(this._createPetal(true));
    }
  },

  _createPetal(onScreen) {
    const c = this.colors[Math.floor(Math.random() * this.colors.length)];
    return {
      x: Math.random() * this.canvas.width,
      y: onScreen ? Math.random() * this.canvas.height : -20 - Math.random() * 100,
      size: 5 + Math.random() * 8,
      speedY: 0.2 + Math.random() * 0.4,
      speedX: -0.15 + Math.random() * 0.3,
      sway: Math.random() * Math.PI * 2,
      swayAmp: 0.3 + Math.random() * 0.5,
      swaySpeed: 0.008 + Math.random() * 0.015,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: -0.008 + Math.random() * 0.016,
      alpha: 0.35 + Math.random() * 0.35,
      color: c,
      phase: Math.random() * Math.PI * 2,
    };
  },

  animate() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    for (const p of this.petals) {
      p.sway += p.swaySpeed;
      p.rotation += p.rotSpeed;
      p.x += p.speedX + Math.sin(p.sway) * p.swayAmp * 0.15;
      p.y += p.speedY;

      if (p.y > h + 30) {
        Object.assign(p, this._createPetal(false));
        p.y = -20 - Math.random() * 50;
      }
      if (p.x > w + 30) p.x = -30;
      if (p.x < -30) p.x = w + 30;

      this.drawPetal(p);
    }

    this.animId = requestAnimationFrame(() => this.animate());
  },

  drawPetal(p) {
    const ctx = this.ctx;
    const s = p.size;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = p.alpha;

    const { r, g, b } = p.color;
    ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;

    // 花瓣形状: 用贝塞尔曲线绘制樱花花瓣
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.bezierCurveTo(s * 0.7, -s * 0.6, s * 0.9, s * 0.2, 0, s * 0.7);
    ctx.bezierCurveTo(-s * 0.9, s * 0.2, -s * 0.7, -s * 0.6, 0, -s);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${Math.min(r+20,255)},${Math.min(g+10,255)},${Math.min(b+10,255)},0.25)`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.1);
    ctx.lineTo(0, s * 0.4);
    ctx.stroke();

    ctx.restore();
  },

  stop() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }
};

// ======================================================================
// 应用启动
// ======================================================================

async function init() {
  UI.initElements();
  Sakura.init();

  // 初始化 IndexedDB 存储
  await Store.init();

  // 尝试恢复登录
  const restored = AppState.restoreSession();
  if (restored) {
    UI.showManagePage(AppState.currentUser);
    UI.toast('已恢复登录状态');
  } else {
    UI.showAuthPage();
  }

  UI.bindEvents();

  // 自动填充记住的密码
  const saved = localStorage.getItem('pbook_remember');
  if (saved) {
    try {
      const { username, password } = JSON.parse(decodeURIComponent(atob(saved)));
      UI.elements.loginUsername.value = username || '';
      UI.elements.loginPassword.value = password || '';
      UI.elements.rememberMe.checked = true;
    } catch (_) { localStorage.removeItem('pbook_remember'); }
  }
}

document.addEventListener('DOMContentLoaded', init);
