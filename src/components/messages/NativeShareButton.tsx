import { useTranslate } from '../../i18n/index.js'
import { IconButton } from '../base/IconButton.js'
import { isNative, shareText } from '../../services/nativeBridge.js'

const IconShareOutline16 = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11 5.5L5.2 8.3M11 5.5L5.4 2.4M11 5.5L5.4 12.1"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="4" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

/** 仅在原生容器内显示的系统分享按钮；Web 端返回 null，不改变现有界面 */
export const NativeShareButton = ({ text }: { text: string }) => {
  const t = useTranslate()
  if (!isNative()) {
    return null
  }
  return (
    <IconButton
      icon={<IconShareOutline16 />}
      tooltip={t('share')}
      tooltipPlacement="bottom"
      onClick={() => void shareText(text, 'DeepMuse')}
    />
  )
}
