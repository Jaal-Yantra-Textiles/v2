import { Alert, Button, Input, Text } from "@medusajs/ui"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useSignInWithPhonePin } from "../../../hooks/api"
import { isFetchError } from "../../../lib/is-fetch-error"

type Props = {
  onSignedIn: () => void
}

/**
 * Phone number + 6-digit PIN login (#2320). The backend reads the number in
 * any format ("98765 43210", "+91 98765 43210"), so it is sent as typed.
 */
export const PhoneLogin = ({ onSignedIn }: Props) => {
  const { t } = useTranslation()
  const [phone, setPhone] = useState("")
  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)

  const { mutateAsync, isPending } = useSignInWithPhonePin()

  const submit = async () => {
    setError(null)
    try {
      await mutateAsync({ phone: phone.trim(), pin })
      onSignedIn()
    } catch (e) {
      const message = isFetchError(e) ? e.message : null
      setError(
        message && /Too many wrong PINs/.test(message)
          ? t("login.phone.errors.locked")
          : t("login.phone.errors.invalid")
      )
      setPin("")
    }
  }

  return (
    <form
      className="flex w-full flex-col gap-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex flex-col gap-y-3">
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="bg-ui-bg-field-component"
          placeholder={t("login.phone.numberPlaceholder")}
          aria-label={t("fields.phone")}
        />
        <Input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="bg-ui-bg-field-component tracking-[0.3em]"
          placeholder={t("login.phone.pinPlaceholder")}
          aria-label={t("login.phone.pinLabel")}
        />
      </div>
      {error && (
        <Alert className="bg-ui-bg-base items-center p-2" variant="error">
          {error}
        </Alert>
      )}
      <Button
        className="w-full"
        type="submit"
        isLoading={isPending}
        disabled={!phone.trim() || pin.length !== 6}
      >
        {t("login.phone.submit")}
      </Button>
      <Text size="xsmall" className="text-ui-fg-muted text-center">
        {t("login.phone.hint")}
      </Text>
    </form>
  )
}
