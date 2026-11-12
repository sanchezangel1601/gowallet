const DB_NAME = 'gastos-db';
const DB_VERSION = 2;
const VAULT_ID = 'private-data';
const LOCAL_BACKUP_ID = 'local-backup';
const PBKDF2_ITERATIONS = 310000;
const CATEGORIES = {
  egreso: ['Comida', 'Transporte', 'Casa', 'Salud', 'Ocio', 'Educación', 'Otros'],
  ingreso: ['Salario', 'Becas', 'Ventas', 'Otros']
};
let dbp;
let vaultKey = null;
let vaultSalt = null;
let vaultData = null;
let pendingWrite = Promise.resolve();

function db() {
  return dbp ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('transactions')) {
        const transactions = database.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        transactions.createIndex('date', 'date');
      }
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('vault')) {
        database.createObjectStore('vault', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cierra otras pestañas de la aplicación e inténtalo de nuevo.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

async function getVaultRecord() {
  const database = await db();
  const transaction = database.transaction('vault', 'readonly');
  const done = transactionDone(transaction);
  const record = await requestResult(transaction.objectStore('vault').get(VAULT_ID));
  await done;
  return record;
}

async function getLocalBackupRecord() {
  const database = await db();
  const transaction = database.transaction('vault', 'readonly');
  const done = transactionDone(transaction);
  const record = await requestResult(transaction.objectStore('vault').get(LOCAL_BACKUP_ID));
  await done;
  return record;
}

export async function hasEncryptedVault() {
  return Boolean(await getVaultRecord());
}

async function readLegacyData() {
  const database = await db();
  const transaction = database.transaction(['transactions', 'settings'], 'readonly');
  const done = transactionDone(transaction);
  const transactions = requestResult(transaction.objectStore('transactions').getAll());
  const settings = requestResult(transaction.objectStore('settings').getAll());
  const [records, settingRecords] = await Promise.all([transactions, settings]);
  await done;
  return {
    transactions: records,
    settings: Object.fromEntries(settingRecords.map(({ key, value }) => [key, value]))
  };
}

async function clearLegacyData() {
  const database = await db();
  const transaction = database.transaction(['transactions', 'settings'], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('transactions').clear();
  transaction.objectStore('settings').clear();
  await done;
}

function assertVaultData(data) {
  if (!data || !Array.isArray(data.transactions) || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
    throw new Error('Los datos cifrados no tienen un formato válido.');
  }
  if (!data.transactions.every(transaction =>
    transaction && Number.isSafeInteger(transaction.id) && transaction.id > 0 &&
    isValidTransaction(transaction)
  )) {
    throw new Error('La bóveda contiene movimientos inválidos.');
  }
  return data;
}

function isValidTransaction(transaction) {
  const date = typeof transaction.date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(transaction.date);
  if (!date) return false;
  const parsedDate = new Date(0);
  parsedDate.setUTCHours(0, 0, 0, 0);
  parsedDate.setUTCFullYear(+date[1], +date[2] - 1, +date[3]);
  return ['egreso', 'ingreso'].includes(transaction.type) &&
    Number.isFinite(transaction.amount) && transaction.amount > 0 && transaction.amount <= 9999999 &&
    typeof transaction.desc === 'string' && transaction.desc.trim().length >= 2 && transaction.desc.length <= 60 &&
    parsedDate.toISOString().slice(0, 10) === transaction.date &&
    CATEGORIES[transaction.type].includes(transaction.category);
}

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptRecord(data, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { id: VAULT_ID, version: 1, salt, iv, ciphertext };
}

function makeLocalBackup(record) {
  return { ...record, id: LOCAL_BACKUP_ID, savedAt: Date.now() };
}

async function writeVaultRecords(record, backupRecord) {
  const database = await db();
  const transaction = database.transaction('vault', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('vault');
  store.put(record);
  if (backupRecord) store.put(backupRecord);
  await done;
}

async function writeVaultRecord(record) {
  await writeVaultRecords(record);
}

function copyData(data) {
  if (data === undefined) return undefined;
  return JSON.parse(JSON.stringify(data));
}

function requireUnlocked() {
  if (!vaultKey || !vaultData) throw new Error('Desbloquea la aplicación para acceder a tus datos.');
}

async function saveData(nextData) {
  requireUnlocked();
  const record = await encryptRecord(nextData, vaultKey, vaultSalt);
  const previousRecord = await getVaultRecord();
  if (!previousRecord) throw new Error('No se encontró la bóveda local para guardar los cambios.');
  await writeVaultRecords(record, makeLocalBackup(previousRecord));
  vaultData = nextData;
}

async function updateData(mutator) {
  const operation = pendingWrite.then(async () => {
    requireUnlocked();
    const nextData = copyData(vaultData);
    const result = mutator(nextData);
    await saveData(nextData);
    return result;
  });
  pendingWrite = operation.catch(() => {});
  return operation;
}

export async function unlockVault(password) {
  if (!globalThis.crypto?.subtle) throw new Error('Este navegador no permite cifrado seguro. Abre la app mediante HTTPS o localhost.');
  const record = await getVaultRecord();
  if (record) {
    if (record.version !== 1) throw new Error('La versión de la bóveda no es compatible.');
    const key = await deriveKey(password, record.salt);
    let decrypted;
    try {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.ciphertext);
      decrypted = assertVaultData(JSON.parse(new TextDecoder().decode(plaintext)));
    } catch {
      throw new Error('Contraseña incorrecta o datos dañados.');
    }
    await clearLegacyData();
    vaultKey = key;
    vaultSalt = record.salt;
    vaultData = decrypted;
    if (!(await getLocalBackupRecord())) {
      await writeVaultRecords(record, makeLocalBackup(record));
    }
    return;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const legacyData = assertVaultData(await readLegacyData());
  const encryptedRecord = await encryptRecord(legacyData, key, salt);
  await writeVaultRecords(encryptedRecord, makeLocalBackup(encryptedRecord));
  await clearLegacyData();
  vaultKey = key;
  vaultSalt = salt;
  vaultData = legacyData;
}

export async function lockVault() {
  await pendingWrite;
  vaultKey = null;
  vaultSalt = null;
  vaultData = null;
  pendingWrite = Promise.resolve();
}

export async function getAll() {
  requireUnlocked();
  return copyData(vaultData.transactions);
}

export function addTx(transaction) {
  return updateData(data => {
    const id = data.transactions.reduce((max, current) => Math.max(max, Number(current.id) || 0), 0) + 1;
    data.transactions.push({ ...transaction, id });
    return id;
  });
}

export function updateTx(transaction) {
  return updateData(data => {
    const index = data.transactions.findIndex(current => current.id === transaction.id);
    if (index < 0) throw new Error('No se encontró el movimiento que intentas actualizar.');
    data.transactions[index] = { ...transaction };
  });
}

export function deleteTx(id) {
  return updateData(data => {
    const index = data.transactions.findIndex(transaction => transaction.id === id);
    if (index < 0) throw new Error('No se encontró el movimiento que intentas eliminar.');
    data.transactions.splice(index, 1);
  });
}

export async function getSetting(key) {
  requireUnlocked();
  return copyData(vaultData.settings[key]);
}

export async function getLocalBackupInfo() {
  requireUnlocked();
  const record = await getLocalBackupRecord();
  return record ? { savedAt: record.savedAt } : null;
}

export async function restoreLocalBackup() {
  requireUnlocked();
  const record = await getLocalBackupRecord();
  if (!record) throw new Error('Todavía no hay una copia local para restaurar.');
  if (record.version !== 1) throw new Error('La versión de la copia local no es compatible.');

  let restored;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, vaultKey, record.ciphertext);
    restored = assertVaultData(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch {
    throw new Error('La copia local está dañada o no corresponde a esta bóveda.');
  }

  await updateData(data => {
    data.transactions = restored.transactions;
    data.settings = restored.settings;
  });
  return restored.transactions.length;
}

export function setSetting(key, value) {
  return updateData(data => { data.settings[key] = value; });
}

export async function exportEncryptedBackup() {
  requireUnlocked();
  const record = await encryptRecord(vaultData, vaultKey, vaultSalt);
  return {
    format: 'control-gastos-encrypted-backup',
    version: 1,
    salt: Array.from(record.salt),
    iv: Array.from(record.iv),
    ciphertext: Array.from(new Uint8Array(record.ciphertext))
  };
}

export async function importBackup(backup, password) {
  requireUnlocked();
  let imported;
  if (backup?.format === 'control-gastos-encrypted-backup' && backup.version === 1) {
    try {
      const salt = new Uint8Array(backup.salt);
      const iv = new Uint8Array(backup.iv);
      const ciphertext = new Uint8Array(backup.ciphertext);
      const key = await deriveKey(password, salt);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      imported = assertVaultData(JSON.parse(new TextDecoder().decode(plaintext)));
    } catch {
      throw new Error('No se pudo descifrar el respaldo. Revisa la contraseña y el archivo.');
    }
  } else if (backup && Array.isArray(backup.txs)) {
    const legacyTransactions = backup.txs.map(transaction => ({
      id: Number(transaction.id),
      type: transaction.type,
      amount: Number(transaction.amount),
      category: transaction.category,
      desc: String(transaction.desc || '').slice(0, 60),
      date: transaction.date
    })).filter(transaction => isValidTransaction(transaction));
    imported = { transactions: legacyTransactions, settings: {} };
  } else {
    throw new Error('El archivo no es un respaldo compatible.');
  }

  await updateData(data => {
    const nextId = data.transactions.reduce((max, current) => Math.max(max, Number(current.id) || 0), 0) + 1;
    data.transactions.push(...imported.transactions.map((transaction, index) => ({ ...transaction, id: nextId + index })));
    Object.assign(data.settings, imported.settings);
  });
  return imported.transactions.length;
}
