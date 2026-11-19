import styles from './LiquidBackground.module.css'

/** 蓝白液体背景：底层渐变 + 三团缓慢漂移的光斑，纯 CSS，尊重减少动效设置。 */
export const LiquidBackground = () => (
  <div className={styles.root} aria-hidden="true">
    <div className={styles.base} />
    <div className={styles.blobA} />
    <div className={styles.blobB} />
    <div className={styles.blobC} />
    <div className={styles.sheen} />
  </div>
)
