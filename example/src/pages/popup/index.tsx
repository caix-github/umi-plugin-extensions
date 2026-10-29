import React from 'react';
import styles from './index.css';

export default function PopupPage() {
  return (
    <main className={styles.popup}>
      <header className={styles.brand}>
        <span className={styles.brandMark}>⌑</span>
        <span>
          <strong>纸间</strong>
          <small>给自己一点阅读时间</small>
        </span>
      </header>
      <p className={styles.description}>你的私人书架，安静地待在浏览器里。</p>
      <a className={styles.openButton} href="options.html" target="_blank">
        打开我的书架 <span aria-hidden="true">↗</span>
      </a>
      <p className={styles.formats}>支持 TXT · Markdown · HTML</p>
    </main>
  );
}
