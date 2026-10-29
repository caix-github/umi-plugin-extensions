import {
  addBook,
  Book,
  listBooks,
  removeBook,
  updateBook,
} from '@/utils/library';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './index.css';

type Theme = 'light' | 'sepia' | 'dark';

function getFormat(fileName: string): Book['format'] | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'txt') return 'txt';
  if (extension === 'md' || extension === 'markdown') return 'md';
  if (extension === 'html' || extension === 'htm') return 'html';
  return undefined;
}

function htmlToText(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html');
  document
    .querySelectorAll('script, style, noscript, svg, iframe')
    .forEach((element) => element.remove());

  const blockTags = new Set([
    'ADDRESS',
    'ARTICLE',
    'BLOCKQUOTE',
    'BR',
    'DIV',
    'H1',
    'H2',
    'H3',
    'H4',
    'LI',
    'P',
    'SECTION',
    'TR',
  ]);
  const extract = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const element = node as Element;
    if (element.tagName === 'BR') return '\n';
    const text = Array.from(element.childNodes, extract).join('');
    return blockTags.has(element.tagName) ? `\n${text}\n` : text;
  };
  return extract(document.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderBookContent(content: string): React.ReactNode[] {
  return content.split(/\n\s*\n/).map((block, index) => {
    const lines = block.split('\n');
    const heading = lines.length === 1 && /^(#{1,3})\s+(.+)$/.exec(lines[0]);
    if (heading) {
      const Heading = `h${heading[1].length}` as 'h1' | 'h2' | 'h3';
      return <Heading key={index}>{heading[2]}</Heading>;
    }

    if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
      return (
        <ul key={index}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{line.replace(/^\s*[-*+]\s+/, '')}</li>
          ))}
        </ul>
      );
    }

    if (
      lines.every((line) => /^\s*&gt;\s?/.test(line) || /^\s*>\s?/.test(line))
    ) {
      return (
        <blockquote key={index}>
          {lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' ')}
        </blockquote>
      );
    }

    return (
      <p key={index}>
        {lines.map((line, lineIndex) => (
          <React.Fragment key={lineIndex}>
            {lineIndex > 0 && <br />}
            {line}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

function formatReadDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}

export default function OptionsPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [activeBook, setActiveBook] = useState<Book>();
  const [isReaderOpen, setReaderOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [fontSize, setFontSize] = useState(18);
  const [theme, setTheme] = useState<Theme>('light');
  const [readProgress, setReadProgress] = useState(0);
  const [isLoading, setLoading] = useState(true);
  const [isImporting, setImporting] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const readerScroll = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number>();

  useEffect(() => {
    listBooks()
      .then((savedBooks) => {
        setBooks(savedBooks.sort((a, b) => b.updatedAt - a.updatedAt));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '读取书架失败');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeBook || !isReaderOpen) return;
    setReadProgress(activeBook.progress);
    const frame = window.requestAnimationFrame(() => {
      if (readerScroll.current) {
        readerScroll.current.scrollTop = activeBook.scrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeBook?.id, isReaderOpen]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    },
    [],
  );

  const visibleBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return books;
    return books.filter((book) =>
      book.title.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [books, query]);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setImporting(true);
    try {
      const imported: Book[] = [];
      for (const file of Array.from(files)) {
        const format = getFormat(file.name);
        if (!format) {
          throw new Error(`${file.name}：目前支持 TXT、Markdown 和 HTML 文件`);
        }
        const source = await file.text();
        const content = format === 'html' ? htmlToText(source) : source;
        if (!content.trim()) throw new Error(`${file.name}：文件内容为空`);
        const now = Date.now();
        imported.push({
          id: crypto.randomUUID(),
          title: file.name.replace(/\.(txt|md|markdown|html|htm)$/i, ''),
          fileName: file.name,
          format,
          content,
          addedAt: now,
          updatedAt: now,
          progress: 0,
          scrollTop: 0,
        });
      }
      for (const book of imported) {
        await addBook(book);
        setBooks((current) =>
          [book, ...current].sort((a, b) => b.updatedAt - a.updatedAt),
        );
      }
      if (imported.length === 1) {
        setActiveBook(imported[0]);
        setReaderOpen(true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入文件失败');
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const persistPosition = async (book: Book, element: HTMLDivElement) => {
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    const progress =
      scrollableHeight > 0
        ? Math.min(
            100,
            Math.round((element.scrollTop / scrollableHeight) * 100),
          )
        : 0;
    const updatedBook = {
      ...book,
      progress,
      scrollTop: element.scrollTop,
      updatedAt: Date.now(),
    };
    try {
      await updateBook(updatedBook);
      setBooks((current) =>
        current
          .map((item) => (item.id === book.id ? updatedBook : item))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存阅读进度失败');
    }
  };

  const onReaderScroll = () => {
    if (!activeBook || !readerScroll.current) return;
    const element = readerScroll.current;
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    const progress =
      scrollableHeight > 0
        ? Math.min(
            100,
            Math.round((element.scrollTop / scrollableHeight) * 100),
          )
        : 0;
    setReadProgress(progress);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persistPosition(activeBook, element);
    }, 700);
  };

  const closeReader = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (activeBook && readerScroll.current) {
      void persistPosition(activeBook, readerScroll.current);
    }
    setReaderOpen(false);
    setActiveBook(undefined);
  };

  const deleteActiveBook = async () => {
    if (!activeBook) return;
    if (!window.confirm(`确定从书架移除《${activeBook.title}》吗？`)) return;
    try {
      await removeBook(activeBook.id);
      setBooks((current) =>
        current.filter((book) => book.id !== activeBook.id),
      );
      setReaderOpen(false);
      setActiveBook(undefined);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除图书失败');
    }
  };

  const openBook = (book: Book) => {
    setError('');
    setActiveBook(book);
    setReaderOpen(true);
  };

  return (
    <div className={`${styles.app} ${styles[theme]}`}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>⌑</span>
          <span>纸间</span>
        </div>
        <div className={styles.topActions}>
          <input
            className={styles.search}
            aria-label="搜索书架"
            placeholder="搜索书名…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html"
            multiple
            onChange={(event) => void importFiles(event.target.files)}
          />
          <button
            className={styles.importButton}
            type="button"
            disabled={isImporting}
            onClick={() => fileInput.current?.click()}
          >
            <span aria-hidden="true">＋</span>
            {isImporting ? '正在导入…' : '导入书籍'}
          </button>
        </div>
      </header>

      <main className={styles.layout}>
        <section className={styles.mainColumn}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>YOUR QUIET READING SPACE</p>
            <h1>把时间留给阅读。</h1>
            <p>你的书籍保存在这台设备上，随时回来继续读。</p>
          </div>

          <div className={styles.sectionHeading}>
            <h2>{query ? '搜索结果' : '我的书架'}</h2>
            <span className={styles.bookCount}>{visibleBooks.length} 本书</span>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className={styles.emptyState}>正在打开你的书架…</div>
          ) : visibleBooks.length ? (
            <div className={styles.bookGrid}>
              {visibleBooks.map((book) => (
                <button
                  className={styles.bookCard}
                  key={book.id}
                  type="button"
                  onClick={() => openBook(book)}
                >
                  <span className={styles.bookCover}>
                    <span className={styles.formatLabel}>{book.format}</span>
                    <span className={styles.coverTitle}>{book.title}</span>
                  </span>
                  <span className={styles.bookTitle}>
                    <strong>{book.title}</strong>
                    <span>{book.format}</span>
                  </span>
                  <span className={styles.cardProgress}>
                    <span style={{ width: `${book.progress}%` }} />
                  </span>
                  <span className={styles.bookMeta}>
                    <span>
                      {book.progress ? `${book.progress}% 已读` : '尚未开始'}
                    </span>
                    <span>{formatReadDate(book.updatedAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>⌑</span>
              <strong>{query ? '没有找到这本书' : '书架还空着'}</strong>
              <p>
                {query
                  ? '试试其他书名，或清空搜索内容。'
                  : '导入一本 TXT、Markdown 或 HTML 书籍，开始你的阅读。'}
              </p>
              {!query && (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => fileInput.current?.click()}
                >
                  选择书籍文件
                </button>
              )}
            </div>
          )}
        </section>

        <aside className={styles.sidePanel}>
          <h2>最近阅读</h2>
          {books.length ? (
            <div className={styles.recentList}>
              {books.slice(0, 3).map((book) => (
                <button
                  className={styles.recentBook}
                  key={book.id}
                  type="button"
                  onClick={() => openBook(book)}
                >
                  <span className={styles.miniCover}>⌑</span>
                  <span>
                    <strong>{book.title}</strong>
                    <small>
                      {book.progress ? `读到 ${book.progress}%` : '开始阅读'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.tip}>导入的书籍会出现在这里，方便继续阅读。</p>
          )}
          <div className={styles.sideDivider} />
          <h2>关于你的书架</h2>
          <p className={styles.tip}>
            书籍和阅读进度仅保存在当前浏览器的本地空间，不会上传到网络。
          </p>
        </aside>
      </main>

      {isReaderOpen && activeBook && (
        <section
          className={styles.reader}
          aria-label={`阅读：${activeBook.title}`}
        >
          <header className={styles.readerHeader}>
            <button
              className={styles.backButton}
              type="button"
              onClick={closeReader}
            >
              ← 返回书架
            </button>
            <strong className={styles.readerBookName}>
              {activeBook.title}
            </strong>
            <button
              className={styles.iconButton}
              type="button"
              aria-label="从书架移除"
              title="从书架移除"
              onClick={() => void deleteActiveBook()}
            >
              ×
            </button>
          </header>
          <div className={styles.readerToolbar}>
            <div className={styles.readerControls} aria-label="字号">
              <button
                type="button"
                aria-label="缩小字号"
                onClick={() => setFontSize((size) => Math.max(14, size - 1))}
              >
                A−
              </button>
              <span className={styles.fontSize}>{fontSize}px</span>
              <button
                type="button"
                aria-label="放大字号"
                onClick={() => setFontSize((size) => Math.min(28, size + 1))}
              >
                A+
              </button>
            </div>
            <span className={styles.toolbarDivider} />
            {(['light', 'sepia', 'dark'] as Theme[]).map((option) => (
              <button
                key={option}
                className={`${styles.themeButton} ${
                  styles[`theme${option[0].toUpperCase()}${option.slice(1)}`]
                } ${theme === option ? styles.activeTheme : ''}`}
                type="button"
                aria-label={`${option} 阅读主题`}
                title={`${option} 阅读主题`}
                onClick={() => setTheme(option)}
              />
            ))}
          </div>
          <div
            className={styles.readerScroll}
            ref={readerScroll}
            onScroll={onReaderScroll}
          >
            <article
              className={styles.readerText}
              style={{ fontSize: `${fontSize}px` }}
            >
              {renderBookContent(activeBook.content)}
            </article>
          </div>
          <footer className={styles.progressLine}>
            <span>{readProgress}%</span>
            <span className={styles.progressTrack}>
              <span style={{ width: `${readProgress}%` }} />
            </span>
            <span>阅读进度</span>
          </footer>
        </section>
      )}
    </div>
  );
}
