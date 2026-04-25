import LoginTemplate from "@modules/account/templates/login-template"

// Default fallback for @login slot on all /account/* subroutes.
// Without this, Next.js parallel routes 404 when @login has no matching page.
export default function LoginDefault() {
  return <LoginTemplate />
}
