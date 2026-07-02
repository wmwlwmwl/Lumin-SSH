import { t } from '../../i18n.js'

const COMPRESSION_QUALITY_MAP = new Map([
  ['image/jpeg', 0.7],
  ['image/jpg', 0.7],
  ['image/webp', 0.7],
  ['image/png', 1.0],
  ['png-to-jpeg', 0.7],
])

const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024
const SCALE_DOWN_RATIO = 0.8

export function calculateBase64Size(base64) {
  const source = typeof base64 === 'string' ? base64 : ''
  const commaIndex = source.indexOf(',')
  const base64Length = commaIndex >= 0 ? source.length - (commaIndex + 1) : source.length
  return Math.round((base64Length * 3) / 4)
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('图片加载失败')))
    image.src = src
  })
}

function detectAlpha(context, width, height) {
  const totalPixels = width * height
  const sampleSize = Math.min(100, totalPixels)
  const step = Math.max(1, Math.floor(totalPixels / sampleSize))
  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  for (let index = 3; index < data.length; index += step * 4) {
    if (data[index] < 255) {
      return true
    }
  }
  return false
}

function shouldScaleDown(fileSize) {
  return fileSize > LARGE_FILE_THRESHOLD
}

function getCompressionQuality(mimeType, hasAlpha) {
  if (mimeType.includes('png')) {
    if (hasAlpha) {
      return { format: 'image/png', quality: COMPRESSION_QUALITY_MAP.get('image/png') || 1.0 }
    }
    return { format: 'image/jpeg', quality: COMPRESSION_QUALITY_MAP.get('png-to-jpeg') || 0.8 }
  }
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
    return { format: 'image/jpeg', quality: COMPRESSION_QUALITY_MAP.get('image/jpeg') || 0.75 }
  }
  if (mimeType.includes('webp')) {
    return { format: 'image/webp', quality: COMPRESSION_QUALITY_MAP.get('image/webp') || 0.8 }
  }
  return { format: 'image/jpeg', quality: 0.8 }
}

export async function compressImage(base64Image) {
  const originalSize = calculateBase64Size(base64Image)
  const mimeType = String(base64Image || '').match(/data:([^;]+);/)?.[1] || 'image/jpeg'
  const image = await loadImage(base64Image)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error(t('无法获取 Canvas 上下文'))
  }

  let wasScaled = false
  if (shouldScaleDown(originalSize)) {
    const newWidth = Math.floor(image.width * SCALE_DOWN_RATIO)
    const newHeight = Math.floor(image.height * SCALE_DOWN_RATIO)
    canvas.width = newWidth
    canvas.height = newHeight
    context.drawImage(image, 0, 0, newWidth, newHeight)
    wasScaled = true
  } else {
    canvas.width = image.width
    canvas.height = image.height
    context.drawImage(image, 0, 0)
  }

  const hasAlpha = mimeType.includes('png') ? detectAlpha(context, canvas.width, canvas.height) : false
  const { format, quality } = getCompressionQuality(mimeType, hasAlpha)
  const compressedData = canvas.toDataURL(format, quality)
  const compressedSize = calculateBase64Size(compressedData)
  const reduction = Math.round(((originalSize - compressedSize) / originalSize) * 100)

  return {
    data: compressedData,
    originalSize,
    compressedSize,
    reduction: Math.max(0, reduction),
    wasScaled,
  }
}