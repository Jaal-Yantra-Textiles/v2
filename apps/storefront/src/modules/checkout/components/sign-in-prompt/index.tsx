import { Button } from "@medusajs/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"

const SignInPrompt = () => {
  return (
    <>
      <div className="bg-white flex items-center justify-between">
        <div>
          <h2 className="h2-docs">Already have an account?</h2>
          <p className="txt-medium text-ui-fg-muted">
            Sign in for a better experience.
          </p>
        </div>
        <div>
          <LocalizedClientLink href="/account">
            <Button variant="secondary" size="large" data-testid="sign-in-button">
              Sign in
            </Button>
          </LocalizedClientLink>
        </div>
      </div>
      <div className="h-px bg-ui-border-base w-full" />
    </>
  )
}

export default SignInPrompt