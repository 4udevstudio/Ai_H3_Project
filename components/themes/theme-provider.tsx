'use client'

/**
 * ========================================
 * ThemeProvider
 * ========================================
 * Description:
 * จัดการ theme ของแอปแบบ custom
 * - ตั้ง data-theme บน <html>
 * - ตั้ง class dark/light ตาม mode ของ theme
 * - บันทึก theme ใน localStorage
 * - ใช้ร่วมกับ CSS ใน app/globals.css
 *
 * Note:
 * ไฟล์นี้ไม่ต้องพึ่ง next-themes แล้ว
 * เพราะ CSS ของโปรเจกต์ผูกกับ :root[data-theme='...'] โดยตรง
 */

import * as React from 'react'

import {
  DEFAULT_THEME,
  THEMES,
  getThemeInfo,
  type ThemeInfo,
} from '@/lib/theme-config'

type ThemeName = ThemeInfo['id']

interface ThemeContextValue {
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  themes: ThemeInfo[]
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined
)

const STORAGE_KEY = 'h3-studio-theme'

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && Boolean(getThemeInfo(value))
}

function applyThemeToDocument(theme: ThemeName) {
  const info = getThemeInfo(theme) ?? getThemeInfo(DEFAULT_THEME)

  if (!info) return

  const root = document.documentElement

  root.setAttribute('data-theme', info.id)
  root.classList.toggle('dark', info.mode === 'dark')
  root.style.colorScheme = info.mode

  try {
    localStorage.setItem(STORAGE_KEY, info.id)
  } catch {
    // ignore storage error เช่น private mode
  }
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [theme, setThemeState] = React.useState<ThemeName>(() => {
    if (typeof document === 'undefined') {
      return DEFAULT_THEME
    }

    const current = document.documentElement.getAttribute('data-theme')

    if (isThemeName(current)) {
      return current
    }

    return DEFAULT_THEME
  })

  React.useEffect(() => {
    applyThemeToDocument(theme)
  }, [theme])

  const setTheme = React.useCallback((nextTheme: ThemeName) => {
    setThemeState(nextTheme)
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      themes: THEMES,
    }),
    [theme, setTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme ต้องอยู่ภายใน ThemeProvider')
  }

  return context
}