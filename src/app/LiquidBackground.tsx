import styles from './LiquidBackground.module.css'

/**
 * 蓝白液体背景：底层渐变 + 三团缓慢漂移的光斑，纯 CSS，尊重减少动效设置。
 * 光斑带 64px 高斯模糊并持续漂移，在安卓 WebView 里开销很大，
 * 因此暴露 data-liquid 标记，供全局样式在原生容器内关闭。
 */
export const LiquidBackground = () => (
  <div className={styles.root} aria-hidden="true" data-liquid="root">
    <div className={styles.base} />
    <div className={styles.blobA} data-liquid="blob" />
    <div className={styles.blobB} data-liquid="blob" />
    <div className={styles.blobC} data-liquid="blob" />
    <div className={styles.sheen} data-liquid="sheen" />
  </div>
)
