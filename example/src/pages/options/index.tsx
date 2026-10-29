import type { PDFDocumentProxy } from 'pdfjs-dist';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  addBook,
  Book,
  BookMark,
  BookMarkStyle,
  BookPosition,
  listBooks,
  removeBook,
  updateBook,
  updateBookPosition,
} from '../../utils/library';
import styles from './index.css';
import {
  EpubReader,
  pdfPageBackground,
  PdfPageThumbnail,
  PdfReader,
  ReaderLayout,
  ReaderNavItem,
  ReaderTheme,
} from './Readers';

type SidebarTab = 'toc' | 'thumbnails';
interface ReaderPreferences {
  fontSize: number;
  theme: ReaderTheme;
  layout: ReaderLayout;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  showProgress: boolean;
  allowPdfBackground: boolean;
  readerWidth: number;
  markColor: string;
  markStyle: BookMarkStyle;
}

const READER_PREFERENCES_KEY = 'paperbound-reader-preferences';

function isReaderPreferences(
  value: unknown,
): value is Partial<ReaderPreferences> {
  return typeof value === 'object' && value !== null;
}

function parseReaderPreferences(value: unknown): Partial<ReaderPreferences> {
  if (!isReaderPreferences(value)) {
    throw new Error('阅读设置数据格式无效');
  }
  const preferences: Partial<ReaderPreferences> = {};
  const themes: ReaderTheme[] = [
    'light',
    'blue',
    'sepia',
    'green',
    'rose',
    'dark',
  ];
  if (typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)) {
    preferences.fontSize = Math.min(36, Math.max(12, value.fontSize));
  }
  if (themes.includes(value.theme as ReaderTheme)) {
    preferences.theme = value.theme as ReaderTheme;
  }
  if (value.layout === 'scroll' || value.layout === 'single') {
    preferences.layout = value.layout;
  }
  if (value.sidebarTab === 'toc' || value.sidebarTab === 'thumbnails') {
    preferences.sidebarTab = value.sidebarTab;
  }
  if (typeof value.sidebarOpen === 'boolean') {
    preferences.sidebarOpen = value.sidebarOpen;
  }
  if (typeof value.showProgress === 'boolean') {
    preferences.showProgress = value.showProgress;
  }
  if (typeof value.allowPdfBackground === 'boolean') {
    preferences.allowPdfBackground = value.allowPdfBackground;
  }
  if (
    typeof value.readerWidth === 'number' &&
    Number.isFinite(value.readerWidth)
  ) {
    preferences.readerWidth = Math.min(1400, Math.max(560, value.readerWidth));
  }
  if (
    typeof value.markColor === 'string' &&
    /^#[\da-f]{6}$/i.test(value.markColor)
  ) {
    preferences.markColor = value.markColor;
  }
  if (
    value.markStyle === 'highlight' ||
    value.markStyle === 'underline' ||
    value.markStyle === 'wavy'
  ) {
    preferences.markStyle = value.markStyle;
  }
  return preferences;
}

interface PendingMark {
  text: string;
  start?: number;
  end?: number;
  cfiRange?: string;
}

type PositionedBookMark = BookMark & { start: number; end: number };

const markColors = [
  '#f2d94e',
  '#ef476f',
  '#ff9f1c',
  '#35b6c8',
  '#8e4a8f',
  '#ef8354',
];

function applyTextMarks(root: HTMLElement, marks: BookMark[]): void {
  root
    .querySelectorAll<HTMLElement>('[data-reader-mark]')
    .forEach((wrapper) => {
      wrapper.replaceWith(...Array.from(wrapper.childNodes));
    });
  root.normalize();

  const textNodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent) textNodes.push(node as Text);
  }

  let documentOffset = 0;
  textNodes.forEach((textNode) => {
    const textLength = textNode.data.length;
    const nodeStart = documentOffset;
    const nodeEnd = nodeStart + textLength;
    documentOffset = nodeEnd;
    const overlappingMarks = marks.filter(
      (mark): mark is PositionedBookMark =>
        typeof mark.start === 'number' &&
        typeof mark.end === 'number' &&
        mark.start < nodeEnd &&
        mark.end > nodeStart,
    );
    if (!overlappingMarks.length) return;

    const boundaries = new Set<number>([0, textLength]);
    overlappingMarks.forEach((mark) => {
      boundaries.add(Math.max(0, mark.start - nodeStart));
      boundaries.add(Math.min(textLength, mark.end - nodeStart));
    });
    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
    const segments: { node: Text; start: number; end: number }[] = [];
    let remaining = textNode;
    let previousBoundary = 0;
    sortedBoundaries.slice(1, -1).forEach((boundary) => {
      const next = remaining.splitText(boundary - previousBoundary);
      segments.push({
        node: remaining,
        start: previousBoundary,
        end: boundary,
      });
      remaining = next;
      previousBoundary = boundary;
    });
    segments.push({
      node: remaining,
      start: previousBoundary,
      end: textLength,
    });

    segments.forEach((segment) => {
      const segmentStart = nodeStart + segment.start;
      const segmentEnd = nodeStart + segment.end;
      const segmentMarks = overlappingMarks.filter(
        (mark) => mark.start < segmentEnd && mark.end > segmentStart,
      );
      if (!segmentMarks.length || !segment.node.parentNode) return;

      const wrapper = root.ownerDocument.createElement('span');
      wrapper.dataset.readerMark = 'true';
      wrapper.title = segmentMarks.map((mark) => mark.text).join(' · ');
      const highlight = segmentMarks
        .filter((mark) => mark.style === 'highlight')
        .pop();
      const underline = segmentMarks
        .filter((mark) => mark.style !== 'highlight')
        .pop();
      if (highlight) {
        wrapper.style.backgroundColor = `color-mix(in srgb, ${highlight.color} 48%, transparent)`;
        wrapper.style.borderRadius = '2px';
      }
      if (underline) {
        wrapper.style.textDecorationLine = 'underline';
        wrapper.style.textDecorationColor = underline.color;
        wrapper.style.textDecorationThickness = '2px';
        wrapper.style.textDecorationStyle =
          underline.style === 'wavy' ? 'wavy' : 'solid';
      }
      segment.node.parentNode.replaceChild(wrapper, segment.node);
      wrapper.appendChild(segment.node);
    });
  });
}

function getFormat(fileName: string): Book['format'] | undefined {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'txt') return 'txt';
  if (extension === 'md' || extension === 'markdown') return 'md';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'epub') return 'epub';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'mobi') return 'mobi';
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
    const markdownHeading = /^(#{1,3})\s+(.+)$/.exec(lines[0]);
    const chapterHeading =
      /^(第[0-9一二三四五六七八九十百零两〇]+[章节回卷].*)$/.exec(
        lines[0].trim(),
      );
    const heading = markdownHeading
      ? { level: markdownHeading[1].length, text: markdownHeading[2] }
      : chapterHeading
      ? { level: 2, text: chapterHeading[1] }
      : undefined;
    if (heading) {
      const Heading = `h${heading.level}` as 'h1' | 'h2' | 'h3';
      return (
        <React.Fragment key={index}>
          <Heading id={`reading-section-${index}`}>{heading.text}</Heading>
          {lines.length > 1 && <p>{lines.slice(1).join('\n')}</p>}
        </React.Fragment>
      );
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

function getTextNavigation(content: string): ReaderNavItem[] {
  return content.split(/\n\s*\n/).flatMap((block, index) => {
    const label = block.trim().split('\n', 1)[0];
    const isHeading =
      /^#{1,3}\s+.+$/.test(label) ||
      /^第[0-9一二三四五六七八九十百零两〇]+[章节回卷].*$/.test(label);
    if (!isHeading) return [];
    return [
      {
        label: label.replace(/^#{1,3}\s+/, ''),
        target: `reading-section-${index}`,
      },
    ];
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
  const [theme, setTheme] = useState<ReaderTheme>('light');
  const [layout, setLayout] = useState<ReaderLayout>('scroll');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('toc');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showProgress, setShowProgress] = useState(true);
  const [allowPdfBackground, setAllowPdfBackground] = useState(false);
  const [readerWidth, setReaderWidth] = useState(980);
  const [zoom, setZoom] = useState(1);
  const [isAutoZoom, setAutoZoom] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [readProgress, setReadProgress] = useState(0);
  const [navigationItems, setNavigationItems] = useState<ReaderNavItem[]>([]);
  const [navigationTarget, setNavigationTarget] = useState('');
  const [selectedChapter, setSelectedChapter] = useState('');
  const [epubPageTotal, setEpubPageTotal] = useState(0);
  const [jumpToPage, setJumpToPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy>();
  const [pendingMark, setPendingMark] = useState<PendingMark>();
  const [markColor, setMarkColor] = useState(markColors[0]);
  const [markStyle, setMarkStyle] = useState<BookMarkStyle>('highlight');
  const [navSearch, setNavSearch] = useState('');
  const [isLoading, setLoading] = useState(true);
  const [isImporting, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [canSavePreferences, setCanSavePreferences] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mobiEpubInput = useRef<HTMLInputElement>(null);
  const readerScroll = useRef<HTMLDivElement>(null);
  const textReaderRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<number>();

  useLayoutEffect(() => {
    const article = textReaderRef.current;
    if (!article) return;
    applyTextMarks(
      article,
      activeBook?.format === 'epub' ? [] : activeBook?.marks ?? [],
    );
  }, [activeBook?.id, activeBook?.content, activeBook?.marks]);

  useEffect(() => {
    try {
      const savedPreferences = window.localStorage.getItem(
        READER_PREFERENCES_KEY,
      );
      if (savedPreferences) {
        const preferences = parseReaderPreferences(
          JSON.parse(savedPreferences) as unknown,
        );
        if (preferences.fontSize !== undefined)
          setFontSize(preferences.fontSize);
        if (preferences.theme) setTheme(preferences.theme);
        if (preferences.layout) setLayout(preferences.layout);
        if (preferences.sidebarTab) setSidebarTab(preferences.sidebarTab);
        if (preferences.sidebarOpen !== undefined)
          setSidebarOpen(preferences.sidebarOpen);
        if (preferences.showProgress !== undefined)
          setShowProgress(preferences.showProgress);
        if (preferences.allowPdfBackground !== undefined)
          setAllowPdfBackground(preferences.allowPdfBackground);
        if (preferences.readerWidth !== undefined)
          setReaderWidth(preferences.readerWidth);
        if (preferences.markColor) setMarkColor(preferences.markColor);
        if (preferences.markStyle) setMarkStyle(preferences.markStyle);
      }
      setCanSavePreferences(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `读取阅读设置失败：${cause.message}`
          : '读取阅读设置失败',
      );
    } finally {
      setPreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!preferencesLoaded || !canSavePreferences) return;
    const preferences: ReaderPreferences = {
      fontSize,
      theme,
      layout,
      sidebarTab,
      sidebarOpen,
      showProgress,
      allowPdfBackground,
      readerWidth,
      markColor,
      markStyle,
    };
    try {
      window.localStorage.setItem(
        READER_PREFERENCES_KEY,
        JSON.stringify(preferences),
      );
    } catch (cause) {
      setCanSavePreferences(false);
      setError(
        cause instanceof Error
          ? `保存阅读设置失败：${cause.message}`
          : '保存阅读设置失败',
      );
    }
  }, [
    allowPdfBackground,
    canSavePreferences,
    fontSize,
    layout,
    markColor,
    markStyle,
    preferencesLoaded,
    readerWidth,
    showProgress,
    sidebarOpen,
    sidebarTab,
    theme,
  ]);

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
      if (readerScroll.current && activeBook.scrollTop !== undefined) {
        readerScroll.current.scrollTop = activeBook.scrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeBook?.id, isReaderOpen]);

  useEffect(() => {
    if (!isReaderOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isReaderOpen]);

  useEffect(() => {
    setNavigationItems([]);
    setNavigationTarget('');
    setSelectedChapter('');
    setPendingMark(undefined);
    setJumpToPage(activeBook?.page ?? 1);
    setPageCount(0);
    setNavSearch('');
    setZoom(1);
    setAutoZoom(true);
    setRotation(0);
  }, [activeBook?.id]);

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

  const visibleNavigationItems = useMemo(() => {
    const search = navSearch.trim().toLocaleLowerCase();
    const activeNavigationItems =
      activeBook?.format === 'txt' ||
      activeBook?.format === 'md' ||
      activeBook?.format === 'html'
        ? getTextNavigation(activeBook.content ?? '')
        : navigationItems;
    return search
      ? activeNavigationItems.filter((item) =>
          item.label.toLocaleLowerCase().includes(search),
        )
      : activeNavigationItems;
  }, [activeBook?.content, activeBook?.format, navigationItems, navSearch]);

  const handleReaderToc = useCallback((items: ReaderNavItem[]) => {
    setNavigationItems(items);
  }, []);

  const handleEpubTextSelection = useCallback(
    (cfiRange: string, selectedText: string) => {
      const text = selectedText.trim();
      if (text) setPendingMark({ text, cfiRange });
    },
    [],
  );

  const captureTextSelection = () => {
    const article = textReaderRef.current;
    const selection = window.getSelection();
    if (
      !article ||
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount
    ) {
      setPendingMark(undefined);
      return;
    }
    const range = selection.getRangeAt(0);
    if (
      !article.contains(range.startContainer) ||
      !article.contains(range.endContainer)
    ) {
      setPendingMark(undefined);
      return;
    }
    const selectedText = range.toString();
    const text = selectedText.trim();
    if (!text) {
      setPendingMark(undefined);
      return;
    }

    const leadingWhitespace =
      selectedText.length - selectedText.trimStart().length;
    const prefix = article.ownerDocument.createRange();
    prefix.selectNodeContents(article);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length + leadingWhitespace;
    setPendingMark({ text, start, end: start + text.length });
  };

  const savePendingMark = async () => {
    if (!activeBook || !pendingMark) return;
    const mark: BookMark = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: pendingMark.text,
      color: markColor,
      style: markStyle,
      ...(pendingMark.start !== undefined ? { start: pendingMark.start } : {}),
      ...(pendingMark.end !== undefined ? { end: pendingMark.end } : {}),
      ...(pendingMark.cfiRange ? { cfiRange: pendingMark.cfiRange } : {}),
    };
    const updatedBook: Book = {
      ...activeBook,
      marks: [...(activeBook.marks ?? []), mark],
      updatedAt: Date.now(),
    };
    try {
      await updateBook(updatedBook);
      setBooks((current) =>
        current.map((book) =>
          book.id === updatedBook.id ? updatedBook : book,
        ),
      );
      setActiveBook(updatedBook);
      setPendingMark(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存标记失败');
    }
  };

  const handleChapterChange = useCallback(
    (target: string, totalPages: number) => {
      setSelectedChapter(target);
      setEpubPageTotal(totalPages);
    },
    [],
  );

  const handlePdfPageCount = useCallback((count: number) => {
    setPageCount(count);
  }, []);

  const handlePdfDocument = useCallback((document?: PDFDocumentProxy) => {
    setPdfDocument(document);
  }, []);

  const navigateFromSidebar = (item: ReaderNavItem) => {
    if (activeBook?.format === 'epub') {
      setNavigationTarget(item.target);
      setSelectedChapter(item.target);
    } else if (activeBook?.format === 'pdf') {
      const targetPage = Number(item.target);
      if (Number.isInteger(targetPage)) {
        setJumpToPage(targetPage);
        setSelectedChapter(item.target);
      }
    } else {
      document
        .getElementById(item.target)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setSelectedChapter(item.target);
    }
  };

  const adjustZoom = (direction: -1 | 1) => {
    if (activeBook?.format === 'pdf') {
      setAutoZoom(false);
      setZoom((current) =>
        Math.min(
          2,
          Math.max(0.6, Math.round((current + direction * 0.1) * 10) / 10),
        ),
      );
    } else {
      setFontSize((current) => Math.min(36, Math.max(12, current + direction)));
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setImporting(true);
    try {
      const imported: Book[] = [];
      for (const file of Array.from(files)) {
        const format = getFormat(file.name);
        if (!format) {
          throw new Error(
            `${file.name}：目前支持 TXT、Markdown、HTML、EPUB、PDF 以及 MOBI 转换导入`,
          );
        }

        const now = Date.now();

        if (format === 'mobi') {
          imported.push({
            id: crypto.randomUUID(),
            title: file.name.replace(/\.mobi$/i, '') || file.name,
            fileName: file.name,
            format,
            addedAt: now,
            updatedAt: now,
            progress: 0,
          });
          continue;
        }

        if (format === 'epub' || format === 'pdf') {
          const binaryData = await file.arrayBuffer();
          const normalizedTitle = file.name.replace(
            /\.(txt|md|markdown|html|htm|epub|pdf)$/i,
            '',
          );
          imported.push({
            id: crypto.randomUUID(),
            title: normalizedTitle || file.name,
            fileName: file.name,
            format,
            binaryData,
            addedAt: now,
            updatedAt: now,
            progress: 0,
            page: format === 'pdf' ? 1 : undefined,
          });
          continue;
        }

        const source = await file.text();
        const content = format === 'html' ? htmlToText(source) : source;
        if (!content.trim()) throw new Error(`${file.name}：文件内容为空`);
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
          readerMode: 'text',
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

  const saveBookPosition = useCallback(
    async (bookId: string, position: BookPosition) => {
      try {
        const updatedBook = await updateBookPosition(bookId, {
          ...position,
          updatedAt: Date.now(),
        });
        setBooks((current) =>
          current
            .map((item) =>
              item.id === bookId
                ? { ...item, ...position, updatedAt: updatedBook.updatedAt }
                : item,
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
        setActiveBook((current) =>
          current?.id === bookId
            ? { ...current, ...position, updatedAt: updatedBook.updatedAt }
            : current,
        );
        setReadProgress(position.progress);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存阅读进度失败');
      }
    },
    [],
  );

  const persistPosition = async (book: Book, element: HTMLDivElement) => {
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    const progress =
      scrollableHeight > 0
        ? Math.min(
            100,
            Math.round((element.scrollTop / scrollableHeight) * 100),
          )
        : 0;
    await saveBookPosition(book.id, {
      progress,
      scrollTop: element.scrollTop,
      updatedAt: Date.now(),
    });
  };

  const onReaderScroll = () => {
    if (!activeBook || !readerScroll.current) return;
    if (
      activeBook.format !== 'txt' &&
      activeBook.format !== 'md' &&
      activeBook.format !== 'html'
    ) {
      return;
    }
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

  const importConvertedEpub = async (file: File | undefined) => {
    if (!activeBook || activeBook.format !== 'mobi' || !file) return;
    setError('');
    try {
      if (getFormat(file.name) !== 'epub') {
        throw new Error('请选择已转换完成的 EPUB 文件');
      }
      const convertedBook: Book = {
        ...activeBook,
        title: file.name.replace(/\.epub$/i, '') || activeBook.title,
        fileName: file.name,
        format: 'epub',
        binaryData: await file.arrayBuffer(),
        progress: 0,
        chapter: undefined,
        page: undefined,
        scrollTop: 0,
        updatedAt: Date.now(),
      };
      await updateBook(convertedBook);
      setBooks((current) =>
        current.map((book) =>
          book.id === convertedBook.id ? convertedBook : book,
        ),
      );
      setActiveBook(convertedBook);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '导入转换后的 EPUB 失败',
      );
    } finally {
      if (mobiEpubInput.current) mobiEpubInput.current.value = '';
    }
  };

  const handleActivePosition = useCallback(
    (position: BookPosition) => {
      if (activeBook) void saveBookPosition(activeBook.id, position);
    },
    [activeBook?.id, saveBookPosition],
  );

  const renderReaderBody = () => {
    if (!activeBook) return null;
    if (activeBook.format === 'mobi') {
      return (
        <div className={styles.formatMessage}>
          <strong>此版本暂不直接阅读 MOBI</strong>
          <p>
            请先使用 Calibre 等桌面工具将此书转换为
            EPUB，再选择转换后的文件继续阅读。
            转换过程在你的设备上完成，书籍不会上传。
          </p>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => mobiEpubInput.current?.click()}
          >
            选择转换后的 EPUB
          </button>
          <input
            ref={mobiEpubInput}
            className={styles.fileInput}
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(event) =>
              void importConvertedEpub(event.target.files?.[0])
            }
          />
        </div>
      );
    }
    if (activeBook.format === 'epub') {
      return (
        <EpubReader
          key={activeBook.id}
          book={activeBook}
          fontSize={fontSize}
          theme={theme}
          layout={layout}
          contentWidth={readerWidth}
          navigationTarget={navigationTarget}
          onPosition={handleActivePosition}
          onToc={handleReaderToc}
          onCurrentChapter={handleChapterChange}
          onTextSelection={handleEpubTextSelection}
          onError={setError}
        />
      );
    }
    if (activeBook.format === 'pdf') {
      return (
        <PdfReader
          key={activeBook.id}
          book={activeBook}
          fontSize={fontSize}
          theme={theme}
          layout={layout}
          zoom={zoom}
          rotation={rotation}
          jumpToPage={jumpToPage}
          allowPdfBackground={allowPdfBackground}
          onPosition={handleActivePosition}
          onToc={handleReaderToc}
          onPageCount={handlePdfPageCount}
          onDocument={handlePdfDocument}
          onError={setError}
        />
      );
    }
    return (
      <article
        className={styles.readerText}
        ref={textReaderRef}
        style={{
          fontSize: `${fontSize}px`,
          maxWidth: `${readerWidth}px`,
        }}
      >
        {renderBookContent(activeBook.content ?? '')}
      </article>
    );
  };

  const closeReader = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (
      activeBook &&
      readerScroll.current &&
      ['txt', 'md', 'html'].includes(activeBook.format)
    ) {
      void persistPosition(activeBook, readerScroll.current);
    }
    setReaderOpen(false);
    setActiveBook(undefined);
    setPdfDocument(undefined);
    setPageCount(0);
    setEpubPageTotal(0);
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
      setPdfDocument(undefined);
      setPageCount(0);
      setEpubPageTotal(0);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除图书失败');
    }
  };

  const openBook = (book: Book) => {
    setError('');
    setPdfDocument(undefined);
    setPageCount(0);
    setEpubPageTotal(0);
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
            accept=".txt,.md,.markdown,.html,.htm,.epub,.pdf,.mobi,text/plain,text/markdown,text/html,application/pdf,application/epub+zip"
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
                  : '导入一本 TXT、Markdown、HTML、EPUB 或 PDF 书籍，开始你的阅读。'}
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
            <button
              className={styles.headerIconButton}
              type="button"
              aria-label={sidebarOpen ? '隐藏目录' : '显示目录'}
              title={sidebarOpen ? '隐藏目录' : '显示目录'}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <span className={styles.sidebarToggleIcon} aria-hidden="true">
                ☰
              </span>
              {!sidebarOpen && <span>目录</span>}
            </button>
            <div className={styles.headerSpacer} />
            <div className={styles.zoomControls} aria-label="缩放">
              <button
                type="button"
                aria-label="缩小"
                onClick={() => adjustZoom(-1)}
              >
                −
              </button>
              <span>
                {activeBook.format === 'pdf'
                  ? isAutoZoom
                    ? '适合窗口'
                    : `${Math.round(zoom * 100)}%`
                  : `${fontSize}px`}
              </span>
              <button
                type="button"
                aria-label="放大"
                onClick={() => adjustZoom(1)}
              >
                +
              </button>
              {activeBook.format === 'pdf' && (
                <button
                  className={styles.fitButton}
                  type="button"
                  title="适合窗口"
                  onClick={() => {
                    setZoom(1);
                    setAutoZoom(true);
                  }}
                >
                  自动缩放
                </button>
              )}
            </div>
            <button
              className={`${styles.headerIconButton} ${
                settingsOpen ? styles.headerIconActive : ''
              }`}
              type="button"
              aria-label="阅读设置"
              title="阅读设置"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              ⚙
            </button>
            <button
              className={styles.headerIconButton}
              type="button"
              aria-label="从书架移除"
              title="从书架移除"
              onClick={() => void deleteActiveBook()}
            >
              ×
            </button>
          </header>
          {error && (
            <div
              className={`${styles.error} ${styles.readerError}`}
              role="alert"
            >
              {error}
            </div>
          )}
          <div className={styles.readerWorkspace}>
            {sidebarOpen && (
              <aside className={styles.readerSidebar}>
                <div className={styles.sidebarBookTitle}>
                  <strong title={activeBook.title}>{activeBook.title}</strong>
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label="隐藏导航栏"
                    onClick={() => setSidebarOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <div className={styles.sidebarTabs}>
                  <button
                    className={
                      sidebarTab === 'toc' ? styles.activeSidebarTab : ''
                    }
                    type="button"
                    onClick={() => setSidebarTab('toc')}
                  >
                    目录
                  </button>
                  <button
                    className={
                      sidebarTab === 'thumbnails' ? styles.activeSidebarTab : ''
                    }
                    type="button"
                    onClick={() => setSidebarTab('thumbnails')}
                  >
                    缩略图
                  </button>
                </div>
                <input
                  className={styles.navSearch}
                  aria-label="筛选目录"
                  placeholder={
                    sidebarTab === 'thumbnails' ? '筛选页面…' : '筛选章节…'
                  }
                  value={navSearch}
                  onChange={(event) => setNavSearch(event.target.value)}
                />
                <div className={styles.sidebarList}>
                  {activeBook.format === 'pdf' &&
                  sidebarTab === 'thumbnails' &&
                  pageCount ? (
                    <div className={styles.thumbnailGrid}>
                      {Array.from({ length: pageCount }, (_, index) => {
                        const page = index + 1;
                        const matches =
                          !navSearch || String(page).includes(navSearch);
                        return matches ? (
                          pdfDocument ? (
                            <PdfPageThumbnail
                              key={page}
                              document={pdfDocument}
                              pageNumber={page}
                              background={
                                allowPdfBackground
                                  ? pdfPageBackground(theme)
                                  : '#ffffff'
                              }
                              matchThemeBackground={allowPdfBackground}
                              theme={theme}
                              isActive={activeBook.page === page}
                              onClick={() =>
                                navigateFromSidebar({
                                  label: `第 ${page} 页`,
                                  target: String(page),
                                })
                              }
                            />
                          ) : (
                            <div className={styles.thumbnail} key={page}>
                              正在载入…
                            </div>
                          )
                        ) : null;
                      })}
                    </div>
                  ) : activeBook.format === 'pdf' &&
                    sidebarTab === 'toc' &&
                    !visibleNavigationItems.length ? (
                    <p className={styles.sidebarEmpty}>
                      PDF 没有可用的书签目录。
                    </p>
                  ) : visibleNavigationItems.length ? (
                    visibleNavigationItems.map((item, index) => (
                      <button
                        key={`${item.target}-${index}`}
                        className={`${styles.navItem} ${
                          (
                            activeBook.format === 'pdf'
                              ? activeBook.page === Number(item.target)
                              : selectedChapter === item.target ||
                                selectedChapter.split('#')[0] ===
                                  item.target.split('#')[0]
                          )
                            ? styles.activeNavItem
                            : ''
                        } ${
                          sidebarTab === 'thumbnails' ? styles.navThumbnail : ''
                        }`}
                        type="button"
                        onClick={() => navigateFromSidebar(item)}
                      >
                        {sidebarTab === 'thumbnails' && (
                          <span className={styles.navThumbnailPreview}>
                            {item.label.slice(0, 2)}
                          </span>
                        )}
                        <span className={styles.navItemLabel}>
                          {item.label}
                        </span>
                        {sidebarTab === 'toc' &&
                          (item.page !== undefined ||
                            (item.pageProgress !== undefined &&
                              epubPageTotal > 0)) && (
                            <span
                              className={styles.navPage}
                              aria-label={
                                item.page !== undefined
                                  ? `第 ${item.page} 页`
                                  : `约第 ${Math.max(
                                      1,
                                      Math.round(
                                        (item.pageProgress ?? 0) *
                                          (epubPageTotal - 1),
                                      ) + 1,
                                    )} 页`
                              }
                              title={
                                item.page !== undefined
                                  ? `第 ${item.page} 页`
                                  : '根据章节位置估算'
                              }
                            >
                              {item.page !== undefined
                                ? item.page
                                : `~${Math.max(
                                    1,
                                    Math.round(
                                      (item.pageProgress ?? 0) *
                                        (epubPageTotal - 1),
                                    ) + 1,
                                  )}`}
                            </span>
                          )}
                      </button>
                    ))
                  ) : (
                    <p className={styles.sidebarEmpty}>
                      {activeBook.format === 'mobi'
                        ? '请将 MOBI 转换为 EPUB 后阅读目录。'
                        : activeBook.format === 'pdf'
                        ? 'PDF 暂无可显示的页面。'
                        : '这本书没有可用目录。'}
                    </p>
                  )}
                </div>
              </aside>
            )}
            <div
              className={`${styles.readerScroll} ${
                activeBook.format === 'epub'
                  ? styles.readerScrollEpub
                  : activeBook.format === 'pdf'
                  ? styles.readerScrollPdf
                  : ''
              }`}
              ref={readerScroll}
              onScroll={onReaderScroll}
              onMouseUp={captureTextSelection}
              onTouchEnd={captureTextSelection}
            >
              {renderReaderBody()}
            </div>
            {pendingMark &&
              activeBook.format !== 'pdf' &&
              activeBook.format !== 'mobi' && (
                <div
                  className={styles.markToolbar}
                  role="toolbar"
                  aria-label="文字标记"
                  onTouchStart={(event) => event.stopPropagation()}
                >
                  <div className={styles.markPalette}>
                    {markColors.map((color) => (
                      <button
                        key={color}
                        className={`${styles.markColor} ${
                          markColor === color ? styles.activeMarkColor : ''
                        }`}
                        type="button"
                        aria-label={`选择颜色 ${color}`}
                        title={color}
                        style={{ backgroundColor: color }}
                        onClick={() => setMarkColor(color)}
                      />
                    ))}
                    <label
                      className={`${styles.customMarkColor} ${
                        !markColors.includes(markColor)
                          ? styles.activeCustomMarkColor
                          : ''
                      }`}
                      title="自定义颜色"
                    >
                      <span aria-hidden="true">+</span>
                      <input
                        type="color"
                        aria-label="自定义标记颜色"
                        value={markColor}
                        onChange={(event) => setMarkColor(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className={styles.markActions}>
                    <button
                      className={
                        markStyle === 'highlight' ? styles.activeMarkStyle : ''
                      }
                      type="button"
                      aria-pressed={markStyle === 'highlight'}
                      onClick={() => setMarkStyle('highlight')}
                    >
                      底色
                    </button>
                    <button
                      className={
                        markStyle === 'underline' ? styles.activeMarkStyle : ''
                      }
                      type="button"
                      aria-pressed={markStyle === 'underline'}
                      onClick={() => setMarkStyle('underline')}
                    >
                      直线
                    </button>
                    <button
                      className={
                        markStyle === 'wavy' ? styles.activeMarkStyle : ''
                      }
                      type="button"
                      aria-pressed={markStyle === 'wavy'}
                      onClick={() => setMarkStyle('wavy')}
                    >
                      波浪
                    </button>
                    <button
                      className={styles.saveMarkButton}
                      type="button"
                      onClick={() => void savePendingMark()}
                    >
                      标记
                    </button>
                    <button
                      className={styles.dismissMarkButton}
                      type="button"
                      aria-label="取消标记"
                      onClick={() => setPendingMark(undefined)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}
            {settingsOpen && (
              <aside className={styles.settingsPanel}>
                <header className={styles.settingsHeader}>
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label="关闭设置"
                    onClick={() => setSettingsOpen(false)}
                  >
                    ←
                  </button>
                  <strong>设置</strong>
                  <button
                    className={styles.iconButton}
                    type="button"
                    aria-label="关闭设置"
                    onClick={() => setSettingsOpen(false)}
                  >
                    ×
                  </button>
                </header>
                <div className={styles.settingsContent}>
                  <label className={styles.settingRow}>
                    <span>底部进度条</span>
                    <input
                      type="checkbox"
                      checked={showProgress}
                      onChange={(event) =>
                        setShowProgress(event.target.checked)
                      }
                    />
                  </label>
                  <div className={styles.settingsSection}>排版</div>
                  {(activeBook.format === 'epub' ||
                    activeBook.format === 'pdf') && (
                    <div className={styles.settingRow}>
                      <span>阅读模式</span>
                      <div className={styles.segmentedControl}>
                        <button
                          className={
                            layout === 'scroll' ? styles.segmentActive : ''
                          }
                          type="button"
                          onClick={() => setLayout('scroll')}
                        >
                          滚动
                        </button>
                        <button
                          className={
                            layout === 'single' ? styles.segmentActive : ''
                          }
                          type="button"
                          onClick={() => setLayout('single')}
                        >
                          单页
                        </button>
                      </div>
                    </div>
                  )}
                  {activeBook.format !== 'pdf' &&
                    activeBook.format !== 'mobi' && (
                      <label className={styles.settingRange}>
                        <span>文字大小</span>
                        <input
                          type="range"
                          min="12"
                          max="36"
                          value={fontSize}
                          onChange={(event) =>
                            setFontSize(Number(event.target.value))
                          }
                        />
                        <small>{fontSize}px</small>
                      </label>
                    )}
                  {activeBook.format !== 'pdf' &&
                    activeBook.format !== 'mobi' && (
                      <label className={styles.settingRange}>
                        <span>正文宽度</span>
                        <input
                          type="range"
                          min="560"
                          max="1400"
                          step="40"
                          value={readerWidth}
                          onChange={(event) =>
                            setReaderWidth(Number(event.target.value))
                          }
                        />
                        <small>{readerWidth}px</small>
                      </label>
                    )}
                  {activeBook.format === 'pdf' && (
                    <div className={styles.settingRow}>
                      <span>旋转页面</span>
                      <div className={styles.segmentedControl}>
                        <button
                          type="button"
                          onClick={() => setRotation((value) => value - 90)}
                        >
                          ↶ 逆时针
                        </button>
                        <button
                          type="button"
                          onClick={() => setRotation((value) => value + 90)}
                        >
                          ↻ 顺时针
                        </button>
                      </div>
                    </div>
                  )}
                  <div className={styles.settingsSection}>页面样式</div>
                  {activeBook.format === 'pdf' && (
                    <label className={styles.settingRow}>
                      <span>
                        PDF 书籍背景与主题一致
                        <small className={styles.settingHint}>
                          勾选后页面和缩略图背景会随主题切换
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        checked={allowPdfBackground}
                        onChange={(event) =>
                          setAllowPdfBackground(event.target.checked)
                        }
                      />
                    </label>
                  )}
                  <div className={styles.settingRow}>
                    <span>主题</span>
                    <div className={styles.themeSwatches}>
                      {(
                        [
                          ['light', '#f4f4ef'],
                          ['blue', '#a8d1d8'],
                          ['sepia', '#d8bd78'],
                          ['green', '#8dc78c'],
                          ['rose', '#c99595'],
                          ['dark', '#171a17'],
                        ] as [ReaderTheme, string][]
                      ).map(([option, color]) => (
                        <button
                          key={option}
                          className={`${styles.themeSwatch} ${
                            theme === option ? styles.activeSwatch : ''
                          }`}
                          style={{ backgroundColor: color }}
                          type="button"
                          aria-label={`${option} 阅读主题`}
                          title={`${option} 阅读主题`}
                          onClick={() => setTheme(option)}
                        >
                          {theme === option ? '✓' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>
            )}
          </div>
          {showProgress && (
            <footer className={styles.progressLine}>
              <span>
                {activeBook.format === 'pdf' && activeBook.page
                  ? `第 ${activeBook.page} 页 · `
                  : ''}
                {readProgress}%
              </span>
              <span className={styles.progressTrack}>
                <span style={{ width: `${readProgress}%` }} />
              </span>
              <span>
                {activeBook.format === 'pdf' ? 'PDF 阅读进度' : '阅读进度'}
              </span>
            </footer>
          )}
        </section>
      )}
    </div>
  );
}
