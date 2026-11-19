import type { ReactNode } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import { setDraftText } from '../../services/chat/drafts.js'
import { BrandMark } from '../base/BrandMark.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

const IconPen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeLinejoin="round" />
    <path d="m14.5 6.5 3 3" strokeLinecap="round" />
  </svg>
)

const IconCode = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path
      d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13l-5.6-2 5.6-2L12 3.5Z"
      strokeLinejoin="round"
    />
    <path d="M19 17.5 19.7 19l1.5.7-1.5.8-.7 1.5-.7-1.5-1.5-.8 1.5-.7.7-1.5Z" strokeLinejoin="round" />
  </svg>
)

const IconCompass = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="m15.2 8.8-2 4.4-4.4 2 2-4.4 4.4-2Z" strokeLinejoin="round" />
  </svg>
)

type Prompt = {
  icon: ReactNode
  title: TranslationKey
  description: TranslationKey
  message: TranslationKey
}

const prompts: Prompt[] = [
  {
    icon: <IconPen />,
    title: 'promptWriteTitle',
    description: 'promptWriteDesc',
    message: 'promptWriteText',
  },
  {
    icon: <IconCode />,
    title: 'promptCodeTitle',
    description: 'promptCodeDesc',
    message: 'promptCodeText',
  },
  {
    icon: <IconSpark />,
    title: 'promptThinkTitle',
    description: 'promptThinkDesc',
    message: 'promptThinkText',
  },
  {
    icon: <IconCompass />,
    title: 'promptLearnTitle',
    description: 'promptLearnDesc',
    message: 'promptLearnText',
  },
]

/** 点击卡片只填入草稿并聚焦输入框，用户仍可修改后再发送。 */
const fillPrompt = (message: string) => {
  setDraftText(null, message)
  requestAnimationFrame(() => {
    const input = document.getElementById('deepmuse-chat-input') as HTMLTextAreaElement | null
    input?.focus({ preventScroll: true })
    input?.setSelectionRange(message.length, message.length)
  })
}

/** 新对话：品牌欢迎语 + 快捷提示词 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <div className={styles.hero}>
          <div className={styles.mark}>
            <BrandMark size={48} />
          </div>
          <div className={styles.eyebrow}>{t('brandTagline')}</div>
          <h1 className={styles.greeting}>{t('welcomeMessageChat250808')}</h1>
          <p className={styles.subtitle}>{t('welcomeSubtitle')}</p>
        </div>
        <div className={styles.inputArea}>
          <ChatInput sessionId={null} />
        </div>
        <div className={styles.prompts}>
          {prompts.map((prompt) => (
            <button
              key={prompt.title}
              type="button"
              className={styles.promptCard}
              onClick={() => fillPrompt(t(prompt.message))}
            >
              <span className={styles.promptIcon}>{prompt.icon}</span>
              <span className={styles.promptText}>
                <span className={styles.promptTitle}>{t(prompt.title)}</span>
                <span className={styles.promptDesc}>{t(prompt.description)}</span>
              </span>
            </button>
          ))}
        </div>
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
