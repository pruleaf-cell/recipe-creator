import type { Recipe } from '../types'

const toBase64Url = (input: string): string =>
  btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const fromBase64Url = (input: string): string => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
  return atob(`${normalized}${padding}`)
}

export const encodeRecipeForUrl = (recipe: Recipe): string => {
  const json = JSON.stringify(recipe)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return toBase64Url(binary)
}

export const decodeRecipeFromUrl = (encoded: string): Recipe | null => {
  try {
    const binary = fromBase64Url(encoded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json) as Recipe
  } catch {
    return null
  }
}

export const buildShareUrl = (recipe: Recipe): string => {
  const url = new URL(window.location.href)
  url.searchParams.set('recipe', encodeRecipeForUrl(recipe))
  return url.toString()
}
