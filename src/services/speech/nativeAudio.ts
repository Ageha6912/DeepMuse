import { NativeAudio } from '@capgo/native-audio'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { isNative } from '../nativeBridge.js'

/**
 * 原生后台朗读能力。
 *
 * Web Audio 的 PCM 流在安卓切到后台后会被系统冻结。原生路径把整段 PCM
 * 缓存成 WAV 文件，交给系统音频引擎播放，从而支持后台与通知栏控制。
 * 代价是原生端需要等整段语音生成完才开始播放（Web 端仍是流式即到即播）。
 */

const TTS_SAMPLE_RATE = 24000
const AUDIO_ID = 'deepmuse-readaloud'
let configured = false

/** 在原生端启用后台播放；Web 端为 no-op */
export const configureBackgroundAudio = async (): Promise<void> => {
  if (!isNative() || configured) {
    return
  }
  try {
    await NativeAudio.configure({ background: true, focus: true })
    configured = true
  } catch {
    // 配置失败时退回普通播放，不影响主流程
  }
}

/** 把 16-bit 单声道 PCM 编码为 WAV（带 44 字节头） */
const pcmToWav = (pcm: Uint8Array, sampleRate: number): Uint8Array => {
  const header = 44
  const out = new Uint8Array(header + pcm.length)
  const view = new DataView(out.buffer)
  const writeStr = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm.length, true)
  out.set(pcm, header)
  return out
}

/** 用原生引擎播放一段 PCM（自动转 WAV）；返回是否成功 */
export const playPcmNatively = async (pcm: Uint8Array): Promise<boolean> => {
  if (!isNative() || pcm.length === 0) {
    return false
  }
  try {
    await configureBackgroundAudio()
    const wav = pcmToWav(pcm, TTS_SAMPLE_RATE)
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < wav.length; i += chunk) {
      binary += String.fromCharCode(...wav.subarray(i, i + chunk))
    }
    const path = `readaloud-${Date.now()}.wav`
    await Filesystem.writeFile({
      path,
      data: btoa(binary),
      directory: Directory.Cache,
      recursive: true,
    })
    await NativeAudio.stop({ assetId: AUDIO_ID }).catch(() => undefined)
    await NativeAudio.preload({
      assetId: AUDIO_ID,
      assetPath: path,
      audioChannelNum: 1,
      isUrl: false,
    })
    await NativeAudio.play({ assetId: AUDIO_ID })
    return true
  } catch {
    return false
  }
}

/** 停止原生朗读 */
export const stopNativeAudio = async (): Promise<void> => {
  if (!isNative()) {
    return
  }
  await NativeAudio.stop({ assetId: AUDIO_ID }).catch(() => undefined)
}
