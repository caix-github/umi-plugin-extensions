import type {
  Book as EpubBook,
  Location as EpubLocation,
  NavItem,
  Rendition,
} from 'epubjs';
import ePub from 'epubjs';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Book, BookPosition } from '../../utils/library';
import styles from './index.css';

export type ReaderTheme =
  | 'light'
  | 'blue'
  | 'sepia'
  | 'green'
  | 'rose'
  | 'dark';
export type ReaderLayout = 'scroll' | 'single';

export interface ReaderNavItem {
  label: string;
  target: string;
}

interface ReaderProps {
  book: Book;
  fontSize: number;
  theme: ReaderTheme;
  layout: ReaderLayout;
  navigationTarget?: string;
  contentWidth?: number;
  onPosition: (position: BookPosition) => void;
  onToc?: (items: ReaderNavItem[]) => void;
  onCurrentChapter?: (target: string) => void;
  onError: (message: string) => void;
}

interface PdfReaderProps extends ReaderProps {
  zoom: number;
  rotation: number;
  jumpToPage: number;
  allowPdfBackground: boolean;
  onToc: (items: ReaderNavItem[]) => void;
  onPageCount: (count: number) => void;
  onDocument: (document?: PDFDocumentProxy) => void;
}

function flattenToc(items: NavItem[]): NavItem[] {
  return items.reduce<NavItem[]>((flattened, item) => {
    flattened.push(item);
    if (item.subitems) flattened.push(...flattenToc(item.subitems));
    return flattened;
  }, []);
}

function epubTheme(theme: ReaderTheme): { color: string; background: string } {
  if (theme === 'dark') return { color: '#e8e8de', background: '#20231f' };
  if (theme === 'sepia') return { color: '#493b2c', background: '#f6ecd9' };
  if (theme === 'blue') return { color: '#263747', background: '#e8f1f7' };
  if (theme === 'green') return { color: '#263b2d', background: '#e7f1e7' };
  if (theme === 'rose') return { color: '#49363a', background: '#f4e8e9' };
  return { color: '#242a25', background: '#fffefa' };
}

export function pdfPageBackground(theme: ReaderTheme): string {
  return {
    light: '#fffefa',
    blue: '#e8f1f7',
    sepia: '#f6ecd9',
    green: '#e7f1e7',
    rose: '#f4e8e9',
    dark: '#20231f',
  }[theme];
}

export function EpubReader({
  book,
  fontSize,
  theme,
  layout,
  navigationTarget,
  contentWidth,
  onPosition,
  onToc,
  onCurrentChapter,
  onError,
}: ReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition>();
  const epubBookRef = useRef<EpubBook>();
  const [isLoading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState('');

  useEffect(() => {
    let isMounted = true;
    const container = containerRef.current;
    if (!container || !book.binaryData) {
      setLoading(false);
      onError('EPUB 文件数据缺失，请从书架移除后重新导入。');
      return;
    }

    setLoading(true);
    const epubBook = ePub(book.binaryData.slice(0));
    epubBookRef.current = epubBook;
    const rendition = epubBook.renderTo(container, {
      flow: layout === 'scroll' ? 'scrolled-doc' : 'paginated',
      manager: layout === 'scroll' ? 'continuous' : undefined,
      width: '100%',
      height: '100%',
    });
    renditionRef.current = rendition;

    const handleRelocated = (location: EpubLocation) => {
      const cfi = location.start.cfi;
      const calculatedProgress = epubBook.locations.percentageFromCfi(cfi);
      const fallbackProgress = location.start.percentage;
      const percentage = Number.isFinite(calculatedProgress)
        ? calculatedProgress
        : fallbackProgress;
      const progress = Math.max(0, Math.min(100, Math.round(percentage * 100)));
      onCurrentChapter?.(location.start.href);
      setCurrentLocation(
        `${location.start.displayed.page} / ${location.start.displayed.total}`,
      );
      onPosition({ chapter: cfi, progress, updatedAt: Date.now() });
    };

    rendition.on('relocated', handleRelocated);
    void (async () => {
      try {
        await epubBook.ready;
        const navigation = await epubBook.loaded.navigation;
        const navigationItems = flattenToc(navigation.toc);
        onToc?.(
          navigationItems.map((item) => ({
            label: item.label,
            target: item.href,
          })),
        );
        await epubBook.locations.generate(1000);
        await rendition.display(book.chapter || undefined);
        if (isMounted) setLoading(false);
      } catch (cause) {
        if (isMounted) {
          setLoading(false);
          onError(
            cause instanceof Error
              ? `无法打开 EPUB：${cause.message}`
              : '无法打开 EPUB 文件',
          );
        }
      }
    })();

    return () => {
      isMounted = false;
      rendition.off('relocated', handleRelocated);
      rendition.destroy();
      epubBook.destroy();
      renditionRef.current = undefined;
      epubBookRef.current = undefined;
    };
  }, [
    book.id,
    book.binaryData,
    layout,
    onCurrentChapter,
    onError,
    onPosition,
    onToc,
  ]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const colors = epubTheme(theme);
    rendition.themes.default({
      body: {
        color: colors.color,
        background: colors.background,
        'font-size': `${fontSize}px`,
        'line-height': '1.8',
      },
    });
  }, [fontSize, theme]);

  useEffect(() => {
    if (!navigationTarget || !renditionRef.current) return;
    void renditionRef.current
      .display(navigationTarget)
      .catch((cause: unknown) => {
        onError(
          cause instanceof Error
            ? `无法打开该章节：${cause.message}`
            : '无法打开该章节',
        );
      });
  }, [navigationTarget, onError]);

  const move = (direction: 'previous' | 'next') => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const movement =
      direction === 'previous' ? rendition.prev() : rendition.next();
    void movement.catch((cause: unknown) => {
      onError(
        cause instanceof Error
          ? `章节跳转失败：${cause.message}`
          : '章节跳转失败',
      );
    });
  };

  return (
    <div className={styles.epubReader}>
      <div className={styles.formatReaderControls}>
        <button type="button" onClick={() => move('previous')}>
          上一页
        </button>
        <button type="button" onClick={() => move('next')}>
          下一页
        </button>
        <span className={styles.readerLocation}>{currentLocation}</span>
      </div>
      {isLoading && <p className={styles.readerLoading}>正在打开 EPUB…</p>}
      <div
        className={styles.epubSurface}
        ref={containerRef}
        style={{ maxWidth: contentWidth, margin: '0 auto' }}
      />
    </div>
  );
}

interface PdfState {
  document: PDFDocumentProxy;
  loadingTask: ReturnType<typeof getDocument>;
}

type PdfOutlineItem = Awaited<
  ReturnType<PDFDocumentProxy['getOutline']>
>[number];

async function getPdfNavigation(
  document: PDFDocumentProxy,
): Promise<ReaderNavItem[]> {
  const outline = await document.getOutline();
  const navigationItems: ReaderNavItem[] = [];

  const append = async (items: PdfOutlineItem[]): Promise<void> => {
    for (const item of items) {
      const destination =
        typeof item.dest === 'string'
          ? await document.getDestination(item.dest)
          : item.dest;
      if (destination?.[0]) {
        const pageIndex = await document.getPageIndex(destination[0]);
        navigationItems.push({
          label: item.title,
          target: String(pageIndex + 1),
        });
      }
      await append(item.items);
    }
  };

  await append(outline ?? []);
  return navigationItems;
}

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  root: HTMLDivElement;
  zoom: number;
  rotation: number;
  background: string;
  matchThemeBackground: boolean;
  theme: ReaderTheme;
  availableWidth: number;
  onCurrentPage: (pageNumber: number) => void;
  onError: (message: string) => void;
}

interface PdfPageThumbnailProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  background: string;
  matchThemeBackground: boolean;
  theme: ReaderTheme;
  isActive: boolean;
  onClick: () => void;
}

export function PdfPageThumbnail({
  document,
  pageNumber,
  background,
  matchThemeBackground,
  theme,
  isActive,
  onClick,
}: PdfPageThumbnailProps) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const [thumbnailError, setThumbnailError] = useState('');

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    let isMounted = true;
    let hasRendered = false;
    let renderTask: RenderTask | undefined;
    setThumbnailError('');

    const observer = new IntersectionObserver(
      (entries) => {
        if (hasRendered || !entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        hasRendered = true;
        void document
          .getPage(pageNumber)
          .then((page) => {
            if (!isMounted || !previewRef.current) return;
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = Math.min(
              280 / baseViewport.width,
              360 / baseViewport.height,
            );
            const viewport = page.getViewport({ scale });
            const canvas = window.document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器无法创建 PDF 缩略图画布');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
            canvas.style.backgroundColor = '#ffffff';
            canvas.className = matchThemeBackground
              ? theme === 'dark'
                ? styles.pdfCanvasDark
                : styles.pdfCanvasThemed
              : '';
            renderTask = page.render({
              canvasContext: context,
              viewport,
              background: '#ffffff',
            });
            return renderTask.promise.then(() => {
              if (isMounted) previewRef.current?.replaceChildren(canvas);
            });
          })
          .catch((cause: unknown) => {
            if (
              isMounted &&
              (!(cause instanceof Error) ||
                cause.name !== 'RenderingCancelledException')
            ) {
              setThumbnailError(
                cause instanceof Error
                  ? `缩略图加载失败：${cause.message}`
                  : '缩略图加载失败',
              );
            }
          });
      },
      { threshold: 0.1 },
    );
    observer.observe(preview);

    return () => {
      isMounted = false;
      observer.disconnect();
      renderTask?.cancel();
    };
  }, [background, document, matchThemeBackground, pageNumber, theme]);

  return (
    <button
      className={`${styles.thumbnail} ${
        isActive ? styles.activeThumbnail : ''
      }`}
      type="button"
      onClick={onClick}
    >
      <span
        className={styles.thumbnailPreview}
        ref={previewRef}
        style={{ backgroundColor: background }}
      >
        {thumbnailError}
      </span>
      <span className={styles.thumbnailLabel}>{pageNumber}</span>
    </button>
  );
}

function PdfPage({
  document,
  pageNumber,
  root,
  zoom,
  rotation,
  background,
  matchThemeBackground,
  theme,
  availableWidth,
  onCurrentPage,
  onError,
}: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask>();
  const [aspectRatio, setAspectRatio] = useState(1.414);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;
    let isMounted = true;
    let hasRendered = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onCurrentPage(pageNumber);
        if (hasRendered) return;
        hasRendered = true;

        void document
          .getPage(pageNumber)
          .then((page) => {
            if (!isMounted || !pageRef.current) return;
            const baseViewport = page.getViewport({ scale: 1, rotation });
            setAspectRatio(baseViewport.height / baseViewport.width);
            const viewport = page.getViewport({
              scale:
                (Math.max(280, availableWidth - 36) / baseViewport.width) *
                zoom,
              rotation,
            });
            const canvas = window.document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) throw new Error('浏览器无法创建 PDF 画布');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            canvas.style.width = `${Math.ceil(viewport.width)}px`;
            canvas.style.height = `${Math.ceil(viewport.height)}px`;
            canvas.style.backgroundColor = '#ffffff';
            canvas.className = matchThemeBackground
              ? theme === 'dark'
                ? styles.pdfCanvasDark
                : styles.pdfCanvasThemed
              : '';
            pageRef.current.replaceChildren(canvas);
            const renderTask = page.render({
              canvasContext: context,
              viewport,
              background: '#ffffff',
            });
            renderTaskRef.current = renderTask;
            return renderTask.promise;
          })
          .catch((cause: unknown) => {
            if (
              isMounted &&
              (!(cause instanceof Error) ||
                cause.name !== 'RenderingCancelledException')
            ) {
              onError(
                cause instanceof Error
                  ? `PDF 第 ${pageNumber} 页渲染失败：${cause.message}`
                  : `PDF 第 ${pageNumber} 页渲染失败`,
              );
            }
          });
      },
      { root, threshold: 0.25 },
    );
    observer.observe(element);

    return () => {
      isMounted = false;
      observer.disconnect();
      renderTaskRef.current?.cancel();
    };
  }, [
    availableWidth,
    document,
    onCurrentPage,
    onError,
    pageNumber,
    root,
    rotation,
    background,
    matchThemeBackground,
    theme,
    zoom,
  ]);

  return (
    <div
      className={styles.pdfPage}
      ref={pageRef}
      data-pdf-page={pageNumber}
      style={{
        aspectRatio: `1 / ${aspectRatio}`,
        backgroundColor: background,
      }}
      aria-label={`PDF 第 ${pageNumber} 页`}
    />
  );
}

export function PdfReader({
  book,
  layout,
  theme,
  zoom,
  rotation,
  jumpToPage,
  allowPdfBackground,
  onPosition,
  onToc,
  onPageCount,
  onDocument,
  onError,
}: PdfReaderProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pdfStateRef = useRef<PdfState>();
  const restoredPositionRef = useRef(false);
  const [page, setPage] = useState(book.page ?? 1);
  const [totalPages, setTotalPages] = useState(0);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    setPage(book.page ?? 1);
    setTotalPages(0);
    setLoading(true);
    restoredPositionRef.current = false;
    if (!book.binaryData) {
      setLoading(false);
      onError('PDF 文件数据缺失，请从书架移除后重新导入。');
      return;
    }

    GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    const loadingTask = getDocument({
      data: new Uint8Array(book.binaryData.slice(0)),
    });
    let isMounted = true;
    void loadingTask.promise
      .then((document) => {
        if (!isMounted) return;
        pdfStateRef.current = { document, loadingTask };
        onDocument(document);
        setTotalPages(document.numPages);
        onPageCount(document.numPages);
        void getPdfNavigation(document)
          .then((items) => {
            if (isMounted) onToc(items);
          })
          .catch((cause: unknown) => {
            if (isMounted) {
              onError(
                cause instanceof Error
                  ? `读取 PDF 目录失败：${cause.message}`
                  : '读取 PDF 目录失败',
              );
            }
          });
        setPage(Math.max(1, Math.min(book.page ?? 1, document.numPages)));
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (isMounted) {
          setLoading(false);
          onError(
            cause instanceof Error
              ? `无法打开 PDF：${cause.message}`
              : '无法打开 PDF 文件',
          );
        }
      });

    return () => {
      isMounted = false;
      pdfStateRef.current = undefined;
      onDocument(undefined);
      void loadingTask.destroy();
    };
  }, [book.id, book.binaryData, onDocument, onPageCount, onToc]);

  const onCurrentPage = useCallback(
    (pageNumber: number) => {
      setPage(pageNumber);
      onPosition({
        page: pageNumber,
        progress: Math.round((pageNumber / totalPages) * 100),
        updatedAt: Date.now(),
      });
    },
    [onPosition, totalPages],
  );
  const surface = surfaceRef.current;
  const pdfDocument = pdfStateRef.current?.document;

  useEffect(() => {
    if (!jumpToPage || !totalPages) return;
    const targetPage = Math.max(1, Math.min(jumpToPage, totalPages));
    setPage(targetPage);
    if (layout === 'scroll') {
      surfaceRef.current
        ?.querySelector(`[data-pdf-page="${targetPage}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      surfaceRef.current?.scrollTo({ top: 0 });
    }
  }, [jumpToPage, layout, totalPages]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(() => {
      setSurfaceWidth(surface.clientWidth);
    });
    observer.observe(surface);
    setSurfaceWidth(surface.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !totalPages || restoredPositionRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const savedPage = surface.querySelector(
        `[data-pdf-page="${page}"]`,
      ) as HTMLElement | null;
      savedPage?.scrollIntoView({ block: 'start' });
      restoredPositionRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page, totalPages]);

  return (
    <div className={styles.pdfReader}>
      <div className={styles.pdfSurface} ref={surfaceRef}>
        {isLoading && <p className={styles.readerLoading}>正在载入 PDF…</p>}
        {pdfDocument &&
          surface &&
          Array.from(
            { length: layout === 'scroll' ? totalPages : 1 },
            (_, index) => {
              const pageNumber = layout === 'scroll' ? index + 1 : page;
              return (
                <PdfPage
                  key={pageNumber}
                  document={pdfDocument}
                  pageNumber={pageNumber}
                  root={surface}
                  zoom={zoom}
                  rotation={rotation}
                  background={
                    allowPdfBackground ? pdfPageBackground(theme) : '#ffffff'
                  }
                  matchThemeBackground={allowPdfBackground}
                  theme={theme}
                  availableWidth={surfaceWidth}
                  onCurrentPage={onCurrentPage}
                  onError={onError}
                />
              );
            },
          )}
      </div>
    </div>
  );
}
