import { ReactNode, Ref, RefAttributes, forwardRef } from "react"

// Mirrors the partner-ui utility so admin components can forward refs to
// generic (typed) components without losing the type parameters.
export function genericForwardRef<T, P = {}>(
  render: (props: P, ref: Ref<T>) => ReactNode
): (props: P & RefAttributes<T>) => ReactNode {
  return forwardRef(render) as any
}
