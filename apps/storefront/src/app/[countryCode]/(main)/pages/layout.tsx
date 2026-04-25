import { ReactNode } from "react"

export default function PagesLayout({ children }: { children: ReactNode }) {
  return (
    <section className="content-container py-10">
      {children}
    </section>
  )
}
