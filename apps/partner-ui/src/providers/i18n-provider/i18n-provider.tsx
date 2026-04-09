import { I18nProvider as Provider } from "@medusajs/ui"
import { PropsWithChildren, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { languages } from "../../i18n/languages"
import { sdk } from "../../lib/client"

type I18nProviderProps = PropsWithChildren

const formatLocaleCode = (code: string) => {
  return code.replace(/([a-z])([A-Z])/g, "$1-$2")
}

export const I18nProvider = ({ children }: I18nProviderProps) => {
  const { i18n } = useTranslation()

  const currentLanguage =
    languages.find((lan) => lan.code === i18n.language) || languages[0]
  const locale = currentLanguage.code
  const formattedLocale = formatLocaleCode(locale)
  const direction = currentLanguage.ltr ? "ltr" : "rtl"

  useEffect(() => {
    document.documentElement.setAttribute("dir", direction)
  }, [direction])

  // Sync the current locale to the SDK so all API requests include the x-medusa-locale header
  useEffect(() => {
    ;(sdk.client as any).config.globalHeaders = {
      ...(sdk.client as any).config.globalHeaders,
      "x-medusa-locale": formattedLocale,
    }
  }, [formattedLocale])

  return <Provider locale={formattedLocale}>{children}</Provider>
}
