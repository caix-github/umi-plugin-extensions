export interface Book {
  id: string;
  title: string;
  fileName: string;
  format: 'txt' | 'md' | 'html';
  content: string;
  addedAt: number;
  updatedAt: number;
  progress: number;
  scrollTop: number;
}

const DATABASE_NAME = 'paperbound-library';
const STORE_NAME = 'books';
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        databasePromise = undefined;
        reject(request.error ?? new Error('无法打开本地书架'));
      };
      request.onblocked = () => {
        databasePromise = undefined;
        reject(new Error('本地书架正在升级，请关闭其他阅读器窗口后重试'));
      };
    });
  }
  return databasePromise;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('保存书架数据失败'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('书架数据操作已取消'));
  });
}

export async function listBooks(): Promise<Book[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<
    Book[]
  >;
  let result: Book[] = [];
  request.onsuccess = () => {
    result = request.result;
  };
  await transactionDone(transaction);
  return result;
}

export async function addBook(book: Book): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).add(book);
  await transactionDone(transaction);
}

export async function updateBook(book: Book): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(book);
  await transactionDone(transaction);
}

export async function removeBook(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
}
