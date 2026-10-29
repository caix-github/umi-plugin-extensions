export type BookFormat = 'txt' | 'md' | 'html' | 'epub' | 'pdf' | 'mobi';

export type BookMarkStyle = 'highlight' | 'underline' | 'wavy';

export interface BookMark {
  id: string;
  text: string;
  color: string;
  style: BookMarkStyle;
  start?: number;
  end?: number;
  cfiRange?: string;
}

export interface Book {
  id: string;
  title: string;
  fileName: string;
  format: BookFormat;
  content?: string;
  binaryData?: ArrayBuffer;
  addedAt: number;
  updatedAt: number;
  progress: number;
  scrollTop?: number;
  page?: number;
  chapter?: string;
  readerMode?: 'text' | 'epub' | 'pdf';
  marks?: BookMark[];
}

export type BookPosition = Pick<Book, 'progress' | 'updatedAt'> &
  Partial<Pick<Book, 'scrollTop' | 'page' | 'chapter'>>;

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

export async function updateBookPosition(
  id: string,
  position: BookPosition,
): Promise<Book> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(id) as IDBRequest<Book | undefined>;
  let updatedBook: Book | undefined;
  request.onsuccess = () => {
    if (!request.result) {
      transaction.abort();
      return;
    }
    updatedBook = { ...request.result, ...position };
    store.put(updatedBook);
  };
  await transactionDone(transaction);
  if (!updatedBook) throw new Error('书籍已从书架移除，无法保存阅读进度');
  return updatedBook;
}

export async function removeBook(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
}
