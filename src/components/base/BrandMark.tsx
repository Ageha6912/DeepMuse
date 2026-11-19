/** DeepMuse 单色品牌标记：弯月映于层叠水纹，寓意「沉思 · 灵感之深」。
 *  图形使用 currentColor，由主题变量决定浅色/深色下的墨色。 */
export const BrandMark = ({ size = 32 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <mask id="deepmuse-crescent-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="#000" />
        <circle cx="30" cy="25" r="13" fill="#fff" />
        <circle cx="37" cy="20" r="12" fill="#000" />
      </mask>
    </defs>
    <rect width="64" height="64" fill="currentColor" mask="url(#deepmuse-crescent-mask)" />
    <path d="M17 42Q32 49 47 42" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d="M21 48Q32 53 43 48" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M26 54Q32 57 38 54" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path
      d="M46 10L47.6 14.4L52 16L47.6 17.6L46 22L44.4 17.6L40 16L44.4 14.4Z"
      fill="currentColor"
    />
  </svg>
)
